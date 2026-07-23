import type {
  LisConnectionResult,
  LisConnectionSettings,
  LisParameter,
  LisResultWrite,
  LisWriteOutcome,
  LisTest,
  TestOrder
} from '../../../shared/types'
import type { ILisRepository } from './ILisRepository'
import { normalizeTestNameKey } from '../mapping/MappingEngine'
import { logger } from '../logger'

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
  async writeResult(write: LisResultWrite): Promise<LisWriteOutcome> {
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
    const blankOnly =
      'AND (value IS NULL OR LEN(LTRIM(RTRIM(CONVERT(varchar(50), value)))) = 0)'
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
      -- Only for test-level mappings (no paramid) so a panel can't be overwritten.
      IF @matched = 0 AND @testcode <> '' AND @paramid IS NULL
      BEGIN
        UPDATE tbl_med_mcc_patient_test_result ${setCols}
        WHERE vailid = @vailid AND testcode = @testcode AND testtype NOT IN ('Head', 'Profile') ${blankOnly};
        SET @matched = @@ROWCOUNT;
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
          AND ( (@paramid IS NOT NULL AND paramid = @paramid)
                OR (@paramid IS NULL AND @testcode <> '' AND testcode = @testcode
                    AND (paramid IS NULL OR paramid = 0)) );

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
      // Warn, not info: a blocked write means the LIS and the analyzer disagree,
      // and the operator needs the existing value to judge which one is right.
      logger.warn(
        'lis-sql',
        `Skipped ${write.vailid} ${write.testCode}${write.paramId ? `[${write.paramId}]` : ''}` +
          `=${write.value}${write.unit ? ` ${write.unit}` : ''} — target cell already holds ` +
          `"${existing || '(non-empty)'}"` +
          (label ? ` for "${label}"` : '') +
          (rowRef ? ` (${rowRef})` : '') +
          (machine ? `, written by ${machine}` : '') +
          (when ? ` at ${when}` : '') +
          '. Fill-blanks-only: left unchanged. Clear the cell in Noble to let this value in.'
      )
      return 'skipped'
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
        return 'written'
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
      logger.warn(
        'lis-sql',
        `Skipped ${write.vailid} ${write.testCode}${write.paramId ? `[${write.paramId}]` : ''}` +
          `=${write.value} — test not ordered for this sample: no result row matches the mapped ` +
          `target (testid ${write.testId}, paramid ${write.paramId ?? 'null'}, name "${write.testName}") ` +
          `by id, code, name or name-key. Sample's registered rows: ${rowsDump || '(none registered)'}`
      )
      return 'skipped'
    }

    this.writes.unshift(write)
    if (this.writes.length > this.maxWrites) this.writes.pop()
    logger.info(
      'lis-sql',
      `Wrote ${write.vailid} ${write.testCode}${write.paramId ? `[${write.paramId}]` : ''}=${write.value} ${write.unit ?? ''}`
    )
    return 'written'
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
