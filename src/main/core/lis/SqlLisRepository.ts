import type {
  LisConnectionResult,
  LisConnectionSettings,
  LisHplcRunWrite,
  LisHplcRunWriteResult,
  LisImageWrite,
  LisImageWriteResult,
  LisParameter,
  LisResultWrite,
  LisWriteResult,
  LisTest,
  TestOrder
} from '../../../shared/types'
import type { ILisRepository } from './ILisRepository'
import { normalizeTestNameKey } from '../mapping/MappingEngine'
import { logger } from '../logger'

/**
 * Synapse's own sidecar for analyzer pictures. Created on first use (the Noble
 * login is db_owner); nothing in Noble references it, so it can never break a
 * LIS feature. One row per (sample, instrument, analyzer file name) with the
 * PNG itself, its hash, and — when mirrored — the id of the Noble attachment
 * row it was copied into, which is what makes a retransmitted frame idempotent.
 */
const LEDGER_DDL = `
IF OBJECT_ID('dbo.syn_result_image', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.syn_result_image (
    id            int IDENTITY(1,1) NOT NULL CONSTRAINT PK_syn_result_image PRIMARY KEY,
    vailid        nvarchar(100) NOT NULL,
    testid        int NULL,
    result_id     int NULL,
    attachment_id int NULL,
    instrument_id varchar(64) NULL,
    driver_id     varchar(64) NULL,
    machine_name  nvarchar(100) NOT NULL,
    file_name     nvarchar(200) NOT NULL,
    file_type     varchar(50) NOT NULL,
    byte_size     int NOT NULL,
    sha256        char(64) NOT NULL,
    image         varbinary(max) NOT NULL,
    received_at   datetime2(0) NOT NULL,
    addeddate     datetime2(0) NOT NULL CONSTRAINT DF_syn_result_image_added DEFAULT SYSDATETIME(),
    updateddate   datetime2(0) NULL,
    CONSTRAINT UQ_syn_result_image UNIQUE (vailid, machine_name, file_name)
  );
  CREATE INDEX IX_syn_result_image_vailid ON dbo.syn_result_image (vailid);
END`

/**
 * Ledger upsert + mirror into Noble's native attachment table, in one
 * transaction. Mirrors the way Noble's own worksheet files an upload: a row in
 * tbl_med_mcc_patient_test_result_attachment hung off the result row that
 * carries the paperclip flag (for HbA1c, the test's Head row — flagged from
 * tbl_med_test_master.Has_graph at registration), keyed by vail_id, with the
 * file extension in file_type. The report procedure (GET_PATIENT_REPORT_VAIL_ID)
 * picks the sample's first .png/.jpg attachment, so the picture reaches the
 * printed report through Noble's existing path. No result-row column is ever
 * touched and nothing is inserted into the result table.
 */
const IMAGE_WRITE_SQL = `
SET XACT_ABORT ON;
DECLARE @ledgerId int, @prevSha char(64), @attId int, @targetId int, @attExists bit = 0, @status varchar(20);

SELECT @ledgerId = id, @prevSha = sha256, @attId = attachment_id
FROM dbo.syn_result_image
WHERE vailid = @vailid AND machine_name = @machine AND file_name = @fileName;

-- The row Noble shows its paperclip on: the sample's flagged row for this test,
-- else the test's own Head/Test row. Never a Param row, never another test's.
SELECT TOP 1 @targetId = id FROM tbl_med_mcc_patient_test_result
WHERE vailid = @vailid AND (@testid IS NULL OR testid = @testid) AND attachment = 1
ORDER BY CASE WHEN testtype = 'Head' THEN 0 ELSE 1 END, id;
IF @targetId IS NULL AND @testid IS NOT NULL
  SELECT TOP 1 @targetId = id FROM tbl_med_mcc_patient_test_result
  WHERE vailid = @vailid AND testid = @testid AND (testtype IS NULL OR testtype <> 'Param')
  ORDER BY CASE WHEN testtype = 'Head' THEN 0 ELSE 1 END, id;

IF @attId IS NOT NULL AND EXISTS (SELECT 1 FROM tbl_med_mcc_patient_test_result_attachment WHERE id = @attId)
  SET @attExists = 1;

BEGIN TRAN;
IF @ledgerId IS NOT NULL AND @prevSha = @sha
BEGIN
  -- Same picture again (retransmitted frame). Mirror it only if it never was
  -- (mirroring was off, or no row existed yet); one a technician removed in
  -- Noble stays removed.
  IF @mirror = 1 AND @attId IS NULL AND @targetId IS NOT NULL
  BEGIN
    INSERT INTO tbl_med_mcc_patient_test_result_attachment (result_id, attachment, vail_id, file_type)
    VALUES (@targetId, @image, @vailid, @fileType);
    SET @attId = SCOPE_IDENTITY();
    UPDATE dbo.syn_result_image
    SET attachment_id = @attId, result_id = @targetId, testid = @testid, updateddate = SYSDATETIME()
    WHERE id = @ledgerId;
    SET @status = 'written';
  END
  ELSE
    SET @status = CASE
      WHEN @attId IS NOT NULL AND @attExists = 0 THEN 'removed'
      WHEN @attId IS NULL AND @mirror = 1 THEN 'no-row'
      ELSE 'unchanged' END;
END
ELSE
BEGIN
  IF @mirror = 1
  BEGIN
    IF @attExists = 1
      UPDATE tbl_med_mcc_patient_test_result_attachment
      SET attachment = @image, file_type = @fileType
      WHERE id = @attId;
    ELSE IF @targetId IS NOT NULL
    BEGIN
      INSERT INTO tbl_med_mcc_patient_test_result_attachment (result_id, attachment, vail_id, file_type)
      VALUES (@targetId, @image, @vailid, @fileType);
      SET @attId = SCOPE_IDENTITY();
    END
    ELSE
      SET @attId = NULL;
  END
  IF @ledgerId IS NULL
  BEGIN
    INSERT INTO dbo.syn_result_image
      (vailid, testid, result_id, attachment_id, instrument_id, driver_id, machine_name,
       file_name, file_type, byte_size, sha256, image, received_at)
    VALUES
      (@vailid, @testid, @targetId, @attId, @instrument, @driver, @machine,
       @fileName, @fileType, @size, @sha, @image, @received);
    SET @ledgerId = SCOPE_IDENTITY();
  END
  ELSE
    UPDATE dbo.syn_result_image
    SET testid = @testid, result_id = @targetId, attachment_id = @attId, byte_size = @size,
        sha256 = @sha, image = @image, received_at = @received, updateddate = SYSDATETIME()
    WHERE id = @ledgerId;
  SET @status = CASE WHEN @mirror = 0 THEN 'ledger-only' WHEN @attId IS NULL THEN 'no-row' ELSE 'written' END;
END
COMMIT;
SELECT @status AS status, @ledgerId AS ledgerId, @attId AS attachmentId, @targetId AS resultId;`

/**
 * Synapse's own ledger of HPLC runs: the WHOLE fraction table the LD-560
 * reports for a sample (HbA1a … HbA1c … v_win, HbA2, HbE, HbD, HbS, HbC), one
 * row per run, created on first use like the picture ledger. Nothing in Noble
 * references it and nothing here is reported: HbA1c and the calculated eAG
 * reach the result rows by the usual path, and the report prints only those.
 * The columns exist so a variant can be asked for directly
 * (`WHERE v_win > 0`); `fractions` keeps the table verbatim, whatever the
 * firmware adds. A retransmitted frame has the same hash and is not re-added.
 */
const RUN_LEDGER_DDL = `
IF OBJECT_ID('dbo.syn_hplc_run', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.syn_hplc_run (
    id             int IDENTITY(1,1) NOT NULL CONSTRAINT PK_syn_hplc_run PRIMARY KEY,
    vailid         nvarchar(100) NOT NULL,
    instrument_id  varchar(64) NULL,
    driver_id      varchar(64) NULL,
    machine_name   nvarchar(100) NOT NULL,
    internal_seq   nvarchar(50) NULL,
    received_at    datetime2(0) NOT NULL,
    frame_sha256   char(64) NOT NULL,
    hba1a          decimal(9,3) NULL,
    hba1b          decimal(9,3) NULL,
    hbf            decimal(9,3) NULL,
    la1c           decimal(9,3) NULL,
    sa1c           decimal(9,3) NULL,
    hba1c          decimal(9,3) NULL,
    hba0           decimal(9,3) NULL,
    eag_instrument decimal(9,3) NULL,
    p3             decimal(9,3) NULL,
    v_win          decimal(9,3) NULL,
    hba2           decimal(9,3) NULL,
    hbe            decimal(9,3) NULL,
    hbd            decimal(9,3) NULL,
    hbs            decimal(9,3) NULL,
    hbc            decimal(9,3) NULL,
    fractions      nvarchar(max) NOT NULL,
    addeddate      datetime2(0) NOT NULL CONSTRAINT DF_syn_hplc_run_added DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_syn_hplc_run UNIQUE (vailid, machine_name, frame_sha256)
  );
  CREATE INDEX IX_syn_hplc_run_vailid ON dbo.syn_hplc_run (vailid);
  CREATE INDEX IX_syn_hplc_run_received ON dbo.syn_hplc_run (received_at);
END
-- 0.7.3: the frame itself, so a missing fraction can be told from a dropped one.
IF COL_LENGTH('dbo.syn_hplc_run', 'frame_text') IS NULL
  ALTER TABLE dbo.syn_hplc_run ADD frame_text nvarchar(max) NULL;`

const RUN_WRITE_SQL = `
DECLARE @id int = (SELECT TOP 1 id FROM dbo.syn_hplc_run
                   WHERE vailid = @vailid AND machine_name = @machine AND frame_sha256 = @sha);
IF @id IS NULL
BEGIN
  INSERT INTO dbo.syn_hplc_run
    (vailid, instrument_id, driver_id, machine_name, internal_seq, received_at, frame_sha256,
     hba1a, hba1b, hbf, la1c, sa1c, hba1c, hba0, eag_instrument, p3, v_win, hba2, hbe, hbd, hbs, hbc, fractions, frame_text)
  VALUES
    (@vailid, @instrument, @driver, @machine, @seq, @received, @sha,
     @hba1a, @hba1b, @hbf, @la1c, @sa1c, @hba1c, @hba0, @eag, @p3, @vwin, @hba2, @hbe, @hbd, @hbs, @hbc, @fractions, @frameText);
  SET @id = SCOPE_IDENTITY();
  SELECT 'written' AS status, @id AS id;
END
ELSE
  SELECT 'unchanged' AS status, @id AS id;`

/** Ledger column for each fraction code the analyzer reports. */
const RUN_COLUMNS: Record<string, string> = {
  HbA1a: 'hba1a',
  HbA1b: 'hba1b',
  HbF: 'hbf',
  'L-A1c': 'la1c',
  'S-A1c': 'sa1c',
  HbA1c: 'hba1c',
  HbA0: 'hba0',
  eAG: 'eag',
  p3: 'p3',
  v_win: 'vwin',
  HbA2: 'hba2',
  HbE: 'hbe',
  HbD: 'hbd',
  HbS: 'hbs',
  HbC: 'hbc'
}

type MssqlModule = typeof import('mssql')
type MssqlPool = import('mssql').ConnectionPool

/**
 * SQL Server repository for the Noble LISTEC LIS.
 *
 * Results are keyed by sample barcode (`vailid` in tbl_med_mcc_patient_samples /
 * tbl_med_mcc_patient_test_result). The instrument barcode must match an existing
 * registered sample before values are written.
 */
export class SqlLisRepository implements ILisRepository {
  readonly mode = 'sql' as const
  private pool: MssqlPool | null = null
  // In-flight connect, cached so concurrent callers await ONE connection instead
  // of racing to open several global sockets (the previous bug).
  private poolPromise: Promise<MssqlPool> | null = null
  private writes: LisResultWrite[] = []
  private readonly maxWrites = 200

  /**
   * Advance the sample's worksheet status exactly like Noble's UpdateSampleResult:
   * count measurable rows (testtype not Head/Profile) vs. those now holding a
   * value, and move only 2 (Registered) -> 4 (Partially Tested) -> 5 (Tested).
   * The IN (2,4) guard means Synapse never downgrades or touches Rejected (3),
   * Authorized (6/7), Printed (8/9) or Pending (10), nor auto-authorizes. Shared
   * verbatim by every write path; expects @matched and @vailid in scope.
   */
  private readonly statusRecomputeSql = `
      IF @matched > 0
      BEGIN
        DECLARE @total int, @filled int;
        SELECT
          @total  = COUNT(*),
          @filled = SUM(CASE WHEN LEN(LTRIM(RTRIM(CONVERT(varchar(50), value)))) > 0
                             THEN 1 ELSE 0 END)
        FROM tbl_med_mcc_patient_test_result
        WHERE vailid = @vailid AND testtype NOT IN ('Head', 'Profile');

        IF @filled > 0
          UPDATE tbl_med_mcc_patient_samples
          SET sample_status = CASE WHEN @filled >= @total THEN 5 ELSE 4 END,
              lastmodified_date = GETDATE()
          WHERE vailid = @vailid AND sample_status IN (2, 4);
      END`

  constructor(private readonly settings: LisConnectionSettings) {}

  private async getMssql(): Promise<MssqlModule> {
    // @ts-ignore - optional dependency
    const mod = await import('mssql').catch(() => null)
    if (!mod) {
      throw new Error('The "mssql" driver is not installed. Run: npm install mssql')
    }
    // `mssql` is CommonJS. In the packaged ESM main process, Node's CJS↔ESM
    // interop wraps the real module under `.default`, so `mssql.connect` is
    // undefined while `mssql.default.connect` is the function. (In dev the
    // electron-vite loader hoists named exports, which is why it only fails in
    // the installed build.) Unwrap whichever shape actually carries connect().
    const candidate = mod as unknown as { default?: MssqlModule } & MssqlModule
    const mssql = (
      typeof candidate.connect === 'function' ? candidate : candidate.default
    ) as MssqlModule | undefined
    if (!mssql || typeof mssql.connect !== 'function') {
      throw new Error('The "mssql" driver loaded but is missing connect() (bad module interop).')
    }
    return mssql
  }

  private connectionConfig(): Record<string, unknown> {
    return {
      server: this.settings.server,
      port: this.settings.port,
      database: this.settings.database,
      user: this.settings.user,
      password: this.settings.password,
      options: { encrypt: this.settings.encrypt, trustServerCertificate: true }
    }
  }

  /**
   * Return this repository's OWN connection pool. We deliberately use a dedicated
   * `new ConnectionPool` rather than the module-global `mssql.connect()`: the
   * global API shares a single process-wide connection between every
   * SqlLisRepository instance, so one instance's `pool.close()` (e.g. a
   * Test-Connection probe) would tear down the socket another instance is
   * mid-query on — desyncing the TDS stream into "Unknown type: N" crashes.
   *
   * The in-flight connect is cached as a promise so concurrent callers share one
   * connection attempt, and a pool-level `error` (socket reset / TDS desync) is
   * logged and the pool dropped so the next call reconnects — it must never
   * bubble up as an uncaughtException and crash the main process.
   */
  private async getPool(): Promise<MssqlPool> {
    if (this.pool && this.pool.connected) return this.pool
    if (!this.poolPromise) {
      this.poolPromise = (async () => {
        const mssql = await this.getMssql()
        const pool = new mssql.ConnectionPool(this.connectionConfig() as never)
        pool.on('error', (err: Error) => {
          logger.warn('lis-sql', `SQL pool error (dropping pool): ${err.message}`)
          if (this.pool === pool) this.pool = null
          this.poolPromise = null
        })
        await pool.connect()
        this.pool = pool
        return pool
      })().catch((err) => {
        // Reset so a transient failure (server briefly down) can be retried.
        this.poolPromise = null
        throw err
      })
    }
    return this.poolPromise
  }

  async getTests(): Promise<LisTest[]> {
    const pool = await this.getPool()
    const result = await pool.request().query(`
      SELECT id, TestCode AS testCode, Testname AS testName, Has_Parameters AS hasParameters
      FROM tbl_med_test_master
      WHERE IsActive = 1
      ORDER BY Testname
    `)
    return result.recordset.map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      testCode: String(row.testCode ?? ''),
      testName: String(row.testName ?? ''),
      hasParameters: !!row.hasParameters
    }))
  }

  async getParameters(testId?: number): Promise<LisParameter[]> {
    const pool = await this.getPool()
    const request = pool.request()
    let sql = `
      SELECT id, TestCode AS testId, Code AS code, Name AS name, Method AS method
      FROM tbl_med_parameter_master
      WHERE IsActive = 1
    `
    if (testId != null) {
      request.input('testId', testId)
      sql += ' AND TestCode = @testId'
    }
    sql += ' ORDER BY Name'
    const result = await request.query(sql)
    return result.recordset.map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      testId: Number(row.testId),
      code: String(row.code ?? ''),
      name: String(row.name ?? ''),
      method: row.method ? String(row.method) : undefined
    }))
  }

  /** Look up a registered sample by barcode (vailid). */
  async getOrder(vailid: string): Promise<TestOrder | null> {
    const pool = await this.getPool()
    const mssql = await this.getMssql()
    const result = await pool
      .request()
      .input('vailid', mssql.VarChar, vailid)
      .query(`
        SELECT TOP 1 vailid, patient_id AS patientId, testcodes, testnames, sample_status AS sampleStatus
        FROM tbl_med_mcc_patient_samples
        WHERE vailid = @vailid
        ORDER BY id DESC
      `)

    const row = result.recordset[0] as Record<string, unknown> | undefined
    if (!row) return null

    // Noble stores ordered items as a mix of individual test codes (BI221) and
    // profile/panel codes (CP114 = "Thyroid Profile I"). An analyzer can only run
    // individual assays, so expand any profile codes to their member tests before
    // returning — this is what lets the host-query order TSH/T3/T4 when a doctor
    // ordered the thyroid profile.
    const expanded = await this.expandProfiles(
      splitCsv(String(row.testcodes ?? '')),
      splitCsv(String(row.testnames ?? ''))
    )
    // Many panels resolve to a COMPOSITE parent test that itself holds the real
    // measurable analytes as parameters (e.g. "Bilirubin (Total Direct &
    // Indirect)" -> params "Bilirubin Total", "Bilirubin Conjugated"; "Total
    // protein (with albumin and globulin)" -> "Protein Total Serum", "Albumin").
    // An analyzer's online menu maps to those individual analytes, not the parent
    // container, so descend parameter-bearing tests into their parameters too —
    // otherwise host-query reverse-mapping never sees the orderable analytes.
    const { codes, names } = await this.expandParameters(expanded.codes, expanded.names)

    return {
      vailid: String(row.vailid),
      patientId: row.patientId != null ? Number(row.patientId) : undefined,
      patientName: await this.lookupPatientName(vailid, row),
      testCodes: codes,
      testNames: names,
      sampleStatus: row.sampleStatus != null ? Number(row.sampleStatus) : undefined
    }
  }

  /**
   * Normalized keys of the sample's already-filled result cells (see
   * ILisRepository). testname for every filled row (matches param-level orders);
   * testcode only for test-level rows (paramid null) since a composite's params
   * share the parent code and keying on it would drop still-pending siblings.
   */
  async getFilledResultKeys(vailid: string): Promise<Set<string>> {
    const pool = await this.getPool()
    const mssql = await this.getMssql()
    const res = await pool
      .request()
      .input('v', mssql.VarChar, vailid)
      .query(`
        SELECT testcode, testname, paramid FROM tbl_med_mcc_patient_test_result
        WHERE vailid = @v AND testtype NOT IN ('Head', 'Profile')
          AND value IS NOT NULL AND LEN(LTRIM(RTRIM(CONVERT(varchar(50), value)))) > 0
      `)
    const norm = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
    const set = new Set<string>()
    for (const r of res.recordset as Array<Record<string, unknown>>) {
      const name = norm(r.testname)
      if (name) set.add(name)
      if (r.paramid == null || Number(r.paramid) === 0) {
        const code = norm(r.testcode)
        if (code) set.add(code)
      }
    }
    return set
  }

  // Whether the live schema exposes a patient-name column we can read (probed once).
  private patientNameUnavailable = false

  /**
   * Best-effort patient display name for the AU480 S-frame (display only).
   *
   * The Beckman host-query response carries the patient name in a fixed-width
   * field; the live ElabAssistLite interface fills it from the LIS. We mirror
   * that here, but DEFENSIVELY: any failure (column/table absent on this Noble
   * build) is swallowed and we fall back to a blank field. This must never break
   * order lookup or result writes, which share `getOrder`.
   */
  private async lookupPatientName(
    vailid: string,
    sampleRow: Record<string, unknown>
  ): Promise<string | undefined> {
    // If Noble already returned a name on the samples row, use it directly.
    const inline = sampleRow.patient_name ?? sampleRow.patientName ?? sampleRow.pname
    if (inline != null && String(inline).trim()) return String(inline).trim()
    if (this.patientNameUnavailable) return undefined
    try {
      const pool = await this.getPool()
      const mssql = await this.getMssql()
      const res = await pool
        .request()
        .input('vailid', mssql.VarChar, vailid)
        .query(
          'SELECT TOP 1 patient_name FROM tbl_med_mcc_patient_samples WHERE vailid = @vailid'
        )
      const name = (res.recordset?.[0] as Record<string, unknown> | undefined)?.patient_name
      return name != null && String(name).trim() ? String(name).trim() : undefined
    } catch {
      // Column/table not present on this build — stop probing to avoid log noise.
      this.patientNameUnavailable = true
      return undefined
    }
  }

  /**
   * Replace any profile/panel codes (tbl_med_test_profile_master.Profile_Code)
   * with their member test codes (tbl_med_test_profile_param -> test_master).
   * Non-profile codes pass through unchanged. De-duplicated by test code.
   */
  private async expandProfiles(
    codes: string[],
    names: string[]
  ): Promise<{ codes: string[]; names: string[] }> {
    if (codes.length === 0) return { codes, names }
    const pool = await this.getPool()
    const mssql = await this.getMssql()
    const req = pool.request()
    const placeholders = codes.map((c, i) => {
      req.input(`p${i}`, mssql.VarChar, c)
      return `@p${i}`
    })
    const res = await req.query(`
      SELECT pm.Profile_Code AS profileCode, t.TestCode AS testCode, t.Testname AS testName
      FROM tbl_med_test_profile_master pm
      JOIN tbl_med_test_profile_param pp ON pp.profileid = pm.id
      JOIN tbl_med_test_master t ON t.id = pp.testid
      WHERE pm.Profile_Code IN (${placeholders.join(',')})
    `)

    const members = new Map<string, { code: string; name: string }[]>()
    for (const r of res.recordset as Array<Record<string, unknown>>) {
      const pc = String(r.profileCode)
      const arr = members.get(pc) ?? []
      arr.push({ code: String(r.testCode).trim(), name: String(r.testName).trim() })
      members.set(pc, arr)
    }
    if (members.size === 0) return { codes, names }

    const outCodes: string[] = []
    const outNames: string[] = []
    const seen = new Set<string>()
    const add = (c: string, n: string): void => {
      const key = c.trim().toUpperCase()
      if (!key || seen.has(key)) return
      seen.add(key)
      outCodes.push(c.trim())
      outNames.push(n)
    }
    codes.forEach((c, i) => {
      const mem = members.get(c)
      if (mem) mem.forEach((m) => add(m.code, m.name))
      else add(c, names[i] ?? '')
    })
    logger.info(
      'lis',
      `Expanded ${members.size} profile(s) [${[...members.keys()].join(', ')}] -> ${outCodes.length} tests`
    )
    return { codes: outCodes, names: outNames }
  }

  /**
   * For any ordered test that is a parameter-bearing container (Has_Parameters),
   * append its measurable parameters (parameter Code + Name) to the order. The
   * parent test rows are kept (Noble may still file results against them), but
   * adding the parameter codes/names is what lets host-query reverse-mapping find
   * the analyzer's per-analyte channels (an instrument orders "Bilirubin Total",
   * never the "Bilirubin (Total Direct & Indirect)" container). Non-parameter
   * tests pass through unchanged. Best-effort: any failure leaves the order as-is.
   */
  private async expandParameters(
    codes: string[],
    names: string[]
  ): Promise<{ codes: string[]; names: string[] }> {
    if (codes.length === 0) return { codes, names }
    try {
      const pool = await this.getPool()
      const mssql = await this.getMssql()
      const req = pool.request()
      const placeholders = codes.map((c, i) => {
        req.input(`t${i}`, mssql.VarChar, c)
        return `@t${i}`
      })
      const res = await req.query(`
        SELECT t.TestCode AS parentCode, p.Code AS paramCode, p.Name AS paramName
        FROM tbl_med_test_master t
        JOIN tbl_med_parameter_master p ON p.TestCode = t.id
        WHERE t.TestCode IN (${placeholders.join(',')})
          AND t.Has_Parameters = 1
          AND p.IsActive = 1
      `)
      if (res.recordset.length === 0) return { codes, names }

      const params = new Map<string, { code: string; name: string }[]>()
      for (const r of res.recordset as Array<Record<string, unknown>>) {
        const pc = String(r.parentCode)
        const arr = params.get(pc) ?? []
        arr.push({ code: String(r.paramCode ?? '').trim(), name: String(r.paramName ?? '').trim() })
        params.set(pc, arr)
      }

      const outCodes = [...codes]
      const outNames = [...names]
      const seen = new Set(codes.map((c) => c.trim().toUpperCase()))
      let added = 0
      for (const [, members] of params) {
        for (const m of members) {
          const key = m.code.toUpperCase()
          if (m.code && !seen.has(key)) {
            seen.add(key)
            outCodes.push(m.code)
            outNames.push(m.name)
            added++
          } else if (!m.code && m.name) {
            // Parameter with no code: still surface the name so a name-based
            // reverse-map can resolve it.
            outCodes.push('')
            outNames.push(m.name)
            added++
          }
        }
      }
      if (added > 0) {
        logger.info(
          'lis',
          `Expanded ${params.size} parameter-bearing test(s) -> +${added} parameter analyte(s)`
        )
      }
      return { codes: outCodes, names: outNames }
    } catch (err) {
      logger.warn('lis', `Parameter expansion skipped: ${(err as Error).message}`)
      return { codes, names }
    }
  }

  /**
   * Fill a result value into the row Noble pre-created at registration, then
   * advance the sample's worksheet status the same way Noble's own result-entry
   * does (MedCis.Business/Pcc/WorksheetClass.cs -> UpdateSampleResult).
   *
   * Matched by barcode + testid + paramid. If no ordered row matches, the test
   * was not ordered for this sample: we SKIP it (return 'skipped') and never
   * INSERT — an orphan row gets testtype = NULL, which Noble's status count
   * excludes, so it would be invisible to the worksheet anyway.
   */
  async writeResult(write: LisResultWrite): Promise<LisWriteResult> {
    const order = await this.getOrder(write.vailid)
    if (!order) {
      throw new Error(`Barcode ${write.vailid} is not registered in Noble LIS (tbl_med_mcc_patient_samples)`)
    }
    if (!order.patientId) {
      throw new Error(`Barcode ${write.vailid} has no patient_id in LIS`)
    }

    const pool = await this.getPool()
    const mssql = await this.getMssql()
    const req = pool.request()
    req.input('vailid', mssql.VarChar, write.vailid)
    req.input('testid', mssql.Int, write.testId)
    req.input('paramid', mssql.Int, write.paramId ?? null)
    req.input('value', mssql.VarChar, write.value)
    req.input('abnormal', mssql.Bit, write.abnormal ? 1 : 0)
    req.input('machine', mssql.VarChar, write.machineName.slice(0, 50))
    req.input('upload', mssql.VarChar, write.uploadFlag)
    req.input('addeddate', mssql.DateTime, new Date(write.addedDate))

    req.input('testcode', mssql.VarChar, write.testCode || '')
    req.input('testname', mssql.VarChar, write.testName || '')

    // Match the pre-created result row. Tier 1 is the exact ordered slot; the
    // fallbacks find the SAME analyte when it was ordered via a profile/package
    // (e.g. "Thyroid Profile I") instead of directly — Noble files the member row
    // under the profile, so the fixed testid the mapping carries no longer matches.
    // Never touch testcode/testname/testunit (Noble owns those labels) and never
    // INSERT: a genuine miss means the test was not ordered for this sample.
    // Never touch a Head/Profile CONTAINER row. Noble gives a profile and its
    // first member the SAME testid (the container row carries paramid NULL), so
    // the paramid-NULL branch below would otherwise fill BOTH the real Test row
    // and the profile header — the duplicate value seen on reports. Every other
    // tier already excludes Head/Profile; Tier 1 must too.
    const exactWhere = write.paramId
      ? "vailid = @vailid AND testid = @testid AND paramid = @paramid AND testtype NOT IN ('Head', 'Profile')"
      : "vailid = @vailid AND testid = @testid AND (paramid IS NULL OR paramid = 0) AND testtype NOT IN ('Head', 'Profile')"

    // Fill-blanks-only guard (every instrument): only write into a result cell
    // that is currently EMPTY. A re-run that re-sends the whole panel must never
    // overwrite values already in the LIS — labs re-run a sample to capture ONE
    // missed analyte and expect the rest to stay exactly as reported.
    // A cell holding only asterisks counts as blank: "***" is an analyzer's
    // "no result" placeholder (the Mispa CX4 uploads it for a channel it could
    // not measure, and v0.6.13 filed it verbatim at Lucknow), never a value a
    // lab reported — so the re-run that carries the real number must get in.
    const blankOnly =
      "AND (value IS NULL OR LEN(LTRIM(RTRIM(CONVERT(varchar(50), value)))) = 0 OR CONVERT(varchar(50), value) NOT LIKE '%[^* ]%')"
    // Value-only drivers (e.g. Agappe Mispa Maestro HbA1c) write just the value
    // plus bookkeeping — never the abnormal flag — so Noble keeps its own
    // reference-range determination instead of having it overwritten.
    const setCols = write.valueOnly
      ? 'SET value = @value, machine_name = @machine, UploadFlag = @upload, addeddate = @addeddate'
      : 'SET value = @value, abnormal = @abnormal, machine_name = @machine, UploadFlag = @upload, addeddate = @addeddate'

    const result = await req.query(`
      DECLARE @matched int = 0;

      -- Tier 1: the exact ordered row (testid + paramid) — a direct order.
      UPDATE tbl_med_mcc_patient_test_result ${setCols} WHERE ${exactWhere} ${blankOnly};
      SET @matched = @@ROWCOUNT;

      -- Tier 2: same parameter, regardless of grouping. A parameter_master row is
      -- shared whether the analyte is ordered directly or inside a profile, so this
      -- catches profile-ordered results the fixed testid misses. Measurable rows
      -- only (never the Head/Profile container).
      IF @matched = 0 AND @paramid IS NOT NULL
      BEGIN
        UPDATE tbl_med_mcc_patient_test_result ${setCols}
        WHERE vailid = @vailid AND paramid = @paramid AND testtype NOT IN ('Head', 'Profile') ${blankOnly};
        SET @matched = @@ROWCOUNT;
      END

      -- Tier 2b: the mapping pins a paramid (the analyte is a panel parameter in
      -- most labs), but THIS lab registered it as a standalone test-level row
      -- (paramid NULL, testtype 'Test') keyed by the same testid + testcode —
      -- e.g. ALT/ALP ordered as individual tests instead of Liver-panel params.
      -- Fill that single row by testid + testcode. The "paramid IS NULL" guard
      -- means this can never touch a real parameter row (panel members carry
      -- their own paramid and a shared parent testcode), so sibling fractions
      -- like the three Bilirubin rows are left untouched.
      IF @matched = 0 AND @paramid IS NOT NULL AND @testcode <> ''
      BEGIN
        UPDATE tbl_med_mcc_patient_test_result ${setCols}
        WHERE vailid = @vailid AND testid = @testid AND testcode = @testcode
          AND (paramid IS NULL OR paramid = 0) AND testtype NOT IN ('Head', 'Profile') ${blankOnly};
        SET @matched = @@ROWCOUNT;
      END

      -- Tier 3: same test by code (profile members keep the member test's code).
      -- Only for test-level mappings (no paramid), and only when the code names
      -- ONE analyte slot on this sample. A panel's parameters all share the
      -- panel's testcode (Bilirubin BI046 = Conjugated 430 / Total 431 /
      -- Indirect 432), so a bare code match would write one value into every
      -- parameter: Haldwani SID 9735064 got its direct bilirubin 0.17 in all
      -- three rows, which then blocked the real total. Count distinct
      -- testid/paramid slots over filled and blank rows alike (the layout, not
      -- the fill state, decides ambiguity) and leave ambiguous codes to the
      -- name tiers.
      IF @matched = 0 AND @testcode <> '' AND @paramid IS NULL
      BEGIN
        DECLARE @codeSlots int = (
          SELECT COUNT(DISTINCT CONVERT(varchar(12), testid) + '|' + CONVERT(varchar(12), ISNULL(paramid, 0)))
          FROM tbl_med_mcc_patient_test_result
          WHERE vailid = @vailid AND testcode = @testcode AND testtype NOT IN ('Head', 'Profile'));
        IF @codeSlots = 1
        BEGIN
          UPDATE tbl_med_mcc_patient_test_result ${setCols}
          WHERE vailid = @vailid AND testcode = @testcode AND testtype NOT IN ('Head', 'Profile') ${blankOnly};
          SET @matched = @@ROWCOUNT;
        END
      END

      -- Tier 4: same test/parameter by name. Last resort; the name is specific to
      -- the analyte so it cannot bleed into a different test's row.
      IF @matched = 0 AND @testname <> ''
      BEGIN
        UPDATE tbl_med_mcc_patient_test_result ${setCols}
        WHERE vailid = @vailid AND testname = @testname AND testtype NOT IN ('Head', 'Profile') ${blankOnly};
        SET @matched = @@ROWCOUNT;
      END

      -- Distinguish "nothing matched because the cell is ALREADY FILLED" (expected
      -- skip — fill-blanks-only) from a genuine "not ordered" miss, so the former
      -- doesn't trip the not-ordered warning or the name-key fallback below.
      -- Capture WHAT is sitting in the cell as well as the fact that something is:
      -- a skip whose reason is invisible hides real corruption (a bad value written
      -- by an earlier mis-decode silently blocks the correct re-run forever).
      DECLARE @existed int = 0;
      DECLARE @exValue varchar(50) = '', @exLabel varchar(200) = '',
              @exMachine varchar(50) = '', @exWhen varchar(30) = '', @exRow varchar(60) = '';
      IF @matched = 0
        SELECT TOP 1
          @existed   = 1,
          @exValue   = LTRIM(RTRIM(CONVERT(varchar(50), value))),
          @exLabel   = CONVERT(varchar(200), COALESCE(testname, '')),
          @exMachine = CONVERT(varchar(50), COALESCE(machine_name, '')),
          @exWhen    = CONVERT(varchar(30), addeddate, 120),
          @exRow     = 't' + CONVERT(varchar(12), testid) +
                       '/p' + COALESCE(CONVERT(varchar(12), paramid), '-')
        FROM tbl_med_mcc_patient_test_result
        WHERE vailid = @vailid AND testtype NOT IN ('Head', 'Profile')
          AND value IS NOT NULL AND LEN(LTRIM(RTRIM(CONVERT(varchar(50), value)))) > 0
          AND CONVERT(varchar(50), value) LIKE '%[^* ]%'
          AND ( (@paramid IS NOT NULL AND paramid = @paramid)
                OR (@paramid IS NULL AND @testcode <> '' AND testcode = @testcode
                    AND (paramid IS NULL OR paramid = 0))
                -- the Tier 4 slot: a filled same-name row (e.g. panel param
                -- "Bilirubin Total" for a standalone BI048 rule) is "already
                -- filled", not "not ordered"
                OR (@testname <> '' AND testname = @testname) );

      ${this.statusRecomputeSql}

      SELECT @matched AS matched, @existed AS existed, @exValue AS exValue,
             @exLabel AS exLabel, @exMachine AS exMachine, @exWhen AS exWhen,
             @exRow AS exRow;
    `)

    const row0 = (result.recordset?.[0] ?? {}) as Record<string, unknown>
    const matched = Number(row0.matched ?? 0)
    const alreadyFilled = Number(row0.existed ?? 0) > 0
    if (matched === 0 && alreadyFilled) {
      const str = (k: string): string => String(row0[k] ?? '').trim()
      const existing = str('exValue')
      const label = str('exLabel')
      const machine = str('exMachine')
      const when = str('exWhen')
      const rowRef = str('exRow')
      const reason =
        `Cell already holds "${existing || '(non-empty)'}"` +
        (label ? ` for "${label}"` : '') +
        (rowRef ? ` (${rowRef})` : '') +
        (machine ? `, written by ${machine}` : '') +
        (when ? ` at ${when}` : '') +
        ` — fill-blanks-only kept it (this run sent ${write.value}${write.unit ? ` ${write.unit}` : ''}). ` +
        'Clear the cell in Noble to let the new value in.'
      // Warn, not info: a blocked write means the LIS and the analyzer disagree,
      // and the operator needs the existing value to judge which one is right.
      logger.warn(
        'lis-sql',
        `Skipped ${write.vailid} ${write.testCode}${write.paramId ? `[${write.paramId}]` : ''}=${write.value} — ${reason}`
      )
      return { outcome: 'skipped', reason }
    }
    if (matched === 0) {
      // Tier 5: the testid/paramid/testcode/exact-name tiers all missed because
      // the mapped LIS target is a DIFFERENT catalog entry than the one this
      // sample was ordered under (e.g. a standalone "Total Protein" test mapped,
      // but ordered as the panel parameter "Protein Total  Serum"). Fall back to
      // the same token-set name resolution the host-query order side uses.
      if (await this.writeByNameKey(write)) {
        this.writes.unshift(write)
        if (this.writes.length > this.maxWrites) this.writes.pop()
        return { outcome: 'written' }
      }
      // Dump the sample's rows so a genuine "not ordered" is debuggable, and any
      // profile layout the tiers don't yet cover is immediately visible in Logs.
      let rowsDump = ''
      try {
        const rows = await pool
          .request()
          .input('v', mssql.VarChar, write.vailid)
          .query(
            'SELECT testid, paramid, testtype, testcode, testname FROM tbl_med_mcc_patient_test_result WHERE vailid = @v'
          )
        rowsDump = (rows.recordset as Array<Record<string, unknown>>)
          .map((r) => `${r.testcode}/${r.testname}[t${r.testid},p${r.paramid ?? '-'},${r.testtype}]`)
          .join('; ')
      } catch {
        /* best-effort diagnostic */
      }
      const reason =
        `Test not ordered for this sample — no result row matches the mapped target ` +
        `(testid ${write.testId}, paramid ${write.paramId ?? 'null'}, "${write.testName}") by id, ` +
        `code, name or name-key. Registered rows: ${rowsDump || '(none registered)'}`
      logger.warn(
        'lis-sql',
        `Skipped ${write.vailid} ${write.testCode}${write.paramId ? `[${write.paramId}]` : ''}=${write.value} — ${reason}`
      )
      return { outcome: 'skipped', reason }
    }

    this.writes.unshift(write)
    if (this.writes.length > this.maxWrites) this.writes.pop()
    logger.info(
      'lis-sql',
      `Wrote ${write.vailid} ${write.testCode}${write.paramId ? `[${write.paramId}]` : ''}=${write.value} ${write.unit ?? ''}`
    )
    return { outcome: 'written' }
  }

  /**
   * Tier-5 fallback for writeResult: resolve the target result row by an
   * order-independent, specimen-suffix-tolerant token-set name key — the SAME
   * normalization the host-query reverse mapping uses to ORDER these analytes
   * (MappingEngine.normalizeTestNameKey). This bridges the common case where the
   * analyte's mapped LIS label differs cosmetically from the row the lab actually
   * registered for the sample:
   *   - "Total Protein" (mapped test) -> "Protein Total  Serum" (ordered param)
   *   - "Bilirubin Conjugated (Direct) - SERUM" -> "Bilirubin Conjugated"
   *
   * Safety: only acts when the key resolves to EXACTLY ONE measurable analyte row
   * (testtype not Head/Profile). Token-set equality (not substring) plus the
   * unique-target gate means it can never bleed a value into a sibling analyte or
   * guess between ambiguous candidates. Returns true only when a row was filled.
   */
  private async writeByNameKey(write: LisResultWrite): Promise<boolean> {
    const key = normalizeTestNameKey(write.testName || '')
    if (!key) return false

    const pool = await this.getPool()
    const mssql = await this.getMssql()

    const rows = await pool
      .request()
      .input('v', mssql.VarChar, write.vailid)
      .query(
        `SELECT testid, paramid, testname FROM tbl_med_mcc_patient_test_result
         WHERE vailid = @v AND testtype NOT IN ('Head', 'Profile')`
      )

    const targets = new Map<string, { testid: number; paramid: number | null }>()
    for (const r of rows.recordset as Array<Record<string, unknown>>) {
      if (normalizeTestNameKey(String(r.testname ?? '')) !== key) continue
      const testid = Number(r.testid)
      const paramid = r.paramid == null ? null : Number(r.paramid)
      targets.set(`${testid}|${paramid ?? '-'}`, { testid, paramid })
    }
    // Ambiguous (or no) match — never guess which analyte to fill.
    if (targets.size !== 1) return false
    const target = [...targets.values()][0]

    const setCols = write.valueOnly
      ? 'SET value = @value, machine_name = @machine, UploadFlag = @upload, addeddate = @addeddate'
      : 'SET value = @value, abnormal = @abnormal, machine_name = @machine, UploadFlag = @upload, addeddate = @addeddate'
    const where =
      target.paramid != null
        ? 'vailid = @vailid AND testid = @testid AND paramid = @paramid'
        : 'vailid = @vailid AND testid = @testid AND (paramid IS NULL OR paramid = 0)'

    const req = pool.request()
    req.input('vailid', mssql.VarChar, write.vailid)
    req.input('testid', mssql.Int, target.testid)
    req.input('paramid', mssql.Int, target.paramid)
    req.input('value', mssql.VarChar, write.value)
    req.input('abnormal', mssql.Bit, write.abnormal ? 1 : 0)
    req.input('machine', mssql.VarChar, write.machineName.slice(0, 50))
    req.input('upload', mssql.VarChar, write.uploadFlag)
    req.input('addeddate', mssql.DateTime, new Date(write.addedDate))

    const res = await req.query(`
      DECLARE @matched int = 0;
      UPDATE tbl_med_mcc_patient_test_result ${setCols}
      WHERE ${where} AND testtype NOT IN ('Head', 'Profile')
        AND (value IS NULL OR LEN(LTRIM(RTRIM(CONVERT(varchar(50), value)))) = 0);
      SET @matched = @@ROWCOUNT;
      ${this.statusRecomputeSql}
      SELECT @matched AS matched;
    `)

    if (Number(res.recordset?.[0]?.matched ?? 0) === 0) return false
    logger.info(
      'lis-sql',
      `Wrote ${write.vailid} ${write.testCode} via name-key "${key}" ` +
        `(testid ${target.testid}, paramid ${target.paramid ?? 'null'})=${write.value} ${write.unit ?? ''}`
    )
    return true
  }

  /** Sidecar table creation, once per repository instance (re-attempted after a failure). */
  private ledgerReady: Promise<void> | null = null

  private ensureLedger(pool: MssqlPool): Promise<void> {
    if (!this.ledgerReady) {
      this.ledgerReady = pool
        .request()
        .query(LEDGER_DDL)
        .then(() => undefined)
        .catch((err) => {
          this.ledgerReady = null
          throw err
        })
    }
    return this.ledgerReady
  }

  async writeImage(write: LisImageWrite, data: Buffer): Promise<LisImageWriteResult> {
    const order = await this.getOrder(write.vailid)
    if (!order) {
      throw new Error(`Barcode ${write.vailid} is not registered in Noble LIS (tbl_med_mcc_patient_samples)`)
    }
    const pool = await this.getPool()
    const mssql = await this.getMssql()
    await this.ensureLedger(pool)

    const mirror = this.settings.attachImages !== false
    const req = pool.request()
    req.input('vailid', mssql.NVarChar, write.vailid)
    req.input('testid', mssql.Int, write.testId ?? null)
    req.input('instrument', mssql.VarChar, write.instrumentId.slice(0, 64))
    req.input('driver', mssql.VarChar, write.driverId.slice(0, 64))
    req.input('machine', mssql.NVarChar, write.machineName.slice(0, 100))
    req.input('fileName', mssql.NVarChar, write.fileName.slice(0, 200))
    req.input('fileType', mssql.VarChar, write.fileType.slice(0, 50))
    req.input('size', mssql.Int, data.length)
    req.input('sha', mssql.Char(64), write.sha256)
    req.input('image', mssql.VarBinary(mssql.MAX), data)
    req.input('received', mssql.DateTime2, new Date(write.receivedAt))
    req.input('mirror', mssql.Bit, mirror ? 1 : 0)

    const result = await req.query<{
      status: string
      ledgerId: number | null
      attachmentId: number | null
      resultId: number | null
    }>(IMAGE_WRITE_SQL)
    const row = result.recordset[0]
    const status = row?.status ?? 'unknown'
    const attachmentId = row?.attachmentId ?? undefined
    const where = write.testId ? `test ${write.testId}` : 'this sample'
    logger.info(
      'lis-sql',
      `Picture ${write.fileName} (${data.length} B) for ${write.vailid}: ${status}` +
        ` — ledger #${row?.ledgerId ?? '?'}` +
        (attachmentId ? `, Noble attachment #${attachmentId} on result row ${row?.resultId}` : '')
    )
    switch (status) {
      case 'written':
        return { outcome: 'written', attachmentId, reason: `Attached in Noble (#${attachmentId})` }
      case 'ledger-only':
        return { outcome: 'written', reason: 'Saved in the Synapse ledger; Noble mirroring is off' }
      case 'no-row':
        return {
          outcome: 'written',
          reason: `Saved in the Synapse ledger only — ${write.vailid} has no result row for ${where} to attach it to`
        }
      case 'unchanged':
        return {
          outcome: 'skipped',
          attachmentId,
          reason: attachmentId
            ? `Already attached in Noble (#${attachmentId})`
            : 'Already in the Synapse ledger'
        }
      case 'removed':
        return {
          outcome: 'skipped',
          reason: 'A user removed this picture in Noble — not re-added'
        }
      default:
        return { outcome: 'skipped', reason: `Unexpected picture write status "${status}"` }
    }
  }

  async writeHplcRun(write: LisHplcRunWrite): Promise<LisHplcRunWriteResult> {
    const pool = await this.getPool()
    const mssql = await this.getMssql()
    if (!this.runLedgerReady) {
      await pool.request().batch(RUN_LEDGER_DDL)
      this.runLedgerReady = true
    }
    const req = pool.request()
    req.input('vailid', mssql.NVarChar, write.vailid.slice(0, 100))
    req.input('instrument', mssql.VarChar, write.instrumentId.slice(0, 64))
    req.input('driver', mssql.VarChar, write.driverId.slice(0, 64))
    req.input('machine', mssql.NVarChar, write.machineName.slice(0, 100))
    req.input('seq', mssql.NVarChar, write.internalSeq?.slice(0, 50) ?? null)
    req.input('received', mssql.DateTime2, new Date(write.receivedAt))
    req.input('sha', mssql.Char(64), write.frameSha256)
    req.input('fractions', mssql.NVarChar(mssql.MAX), JSON.stringify(write.fractions))
    req.input('frameText', mssql.NVarChar(mssql.MAX), write.frameText.slice(0, 20000))
    // Every column gets a parameter, NULL where the frame did not carry it.
    const num = (code: string): number | null => {
      const v = parseFloat(write.fractions[code] ?? '')
      return Number.isFinite(v) ? v : null
    }
    for (const [code, column] of Object.entries(RUN_COLUMNS)) {
      req.input(column, mssql.Decimal(9, 3), num(code))
    }
    const result = await req.query<{ status: string; id: number | null }>(RUN_WRITE_SQL)
    const row = result.recordset[0]
    const known = Object.keys(write.fractions).length
    logger.info(
      'lis-sql',
      `HPLC run for ${write.vailid} (${known} fractions, v_win ${write.fractions['v_win'] ?? '-'}): ${row?.status ?? 'unknown'} — run #${row?.id ?? '?'}`
    )
    return row?.status === 'written'
      ? { outcome: 'written', runId: row.id ?? undefined, reason: 'Fractions recorded in the Synapse run ledger' }
      : { outcome: 'skipped', runId: row?.id ?? undefined, reason: 'Already in the Synapse run ledger' }
  }

  /** The run ledger's CREATE has run on this connection (once per process). */
  private runLedgerReady = false

  async recentWrites(): Promise<LisResultWrite[]> {
    return [...this.writes]
  }

  async testConnection(settings: LisConnectionSettings): Promise<LisConnectionResult> {
    // Probe with a DEDICATED throwaway pool and close only it. Never the global
    // `mssql.connect()` — that shares (and this method's close() would tear down)
    // the live backend's connection, corrupting any query in flight.
    let pool: MssqlPool | null = null
    try {
      const mssql = await this.getMssql()
      pool = new mssql.ConnectionPool({
        server: settings.server,
        port: settings.port,
        database: settings.database,
        user: settings.user,
        password: settings.password,
        options: { encrypt: settings.encrypt, trustServerCertificate: true }
      } as never)
      // Swallow any late error on this short-lived pool so it can't crash main.
      pool.on('error', () => undefined)
      await pool.connect()
      await pool.request().query('SELECT 1 AS ok')
      return {
        state: 'connected',
        message: `Connected to ${settings.database}@${settings.server}.`,
        testedAt: new Date().toISOString()
      }
    } catch (err) {
      return {
        state: 'error',
        message: `Connection failed: ${(err as Error).message}`,
        testedAt: new Date().toISOString()
      }
    } finally {
      if (pool) await pool.close().catch(() => undefined)
    }
  }

  async close(): Promise<void> {
    this.poolPromise = null
    if (this.pool) {
      await this.pool.close().catch(() => undefined)
      this.pool = null
    }
  }
}

function splitCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
