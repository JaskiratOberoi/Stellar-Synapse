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
  private writes: LisResultWrite[] = []
  private readonly maxWrites = 200

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

  private async getPool(): Promise<MssqlPool> {
    if (this.pool) return this.pool
    const mssql = await this.getMssql()
    this.pool = await mssql.connect({
      server: this.settings.server,
      port: this.settings.port,
      database: this.settings.database,
      user: this.settings.user,
      password: this.settings.password,
      options: { encrypt: this.settings.encrypt, trustServerCertificate: true }
    })
    return this.pool
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
    const { codes, names } = await this.expandProfiles(
      splitCsv(String(row.testcodes ?? '')),
      splitCsv(String(row.testnames ?? ''))
    )

    return {
      vailid: String(row.vailid),
      patientId: row.patientId != null ? Number(row.patientId) : undefined,
      testCodes: codes,
      testNames: names,
      sampleStatus: row.sampleStatus != null ? Number(row.sampleStatus) : undefined
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
    const exactWhere = write.paramId
      ? 'vailid = @vailid AND testid = @testid AND paramid = @paramid'
      : 'vailid = @vailid AND testid = @testid AND (paramid IS NULL OR paramid = 0)'
    // Value-only drivers (e.g. Agappe Mispa Maestro HbA1c) write just the value
    // plus bookkeeping — never the abnormal flag — so Noble keeps its own
    // reference-range determination instead of having it overwritten.
    const setCols = write.valueOnly
      ? 'SET value = @value, machine_name = @machine, UploadFlag = @upload, addeddate = @addeddate'
      : 'SET value = @value, abnormal = @abnormal, machine_name = @machine, UploadFlag = @upload, addeddate = @addeddate'

    const result = await req.query(`
      DECLARE @matched int = 0;

      -- Tier 1: the exact ordered row (testid + paramid) — a direct order.
      UPDATE tbl_med_mcc_patient_test_result ${setCols} WHERE ${exactWhere};
      SET @matched = @@ROWCOUNT;

      -- Tier 2: same parameter, regardless of grouping. A parameter_master row is
      -- shared whether the analyte is ordered directly or inside a profile, so this
      -- catches profile-ordered results the fixed testid misses. Measurable rows
      -- only (never the Head/Profile container).
      IF @matched = 0 AND @paramid IS NOT NULL
      BEGIN
        UPDATE tbl_med_mcc_patient_test_result ${setCols}
        WHERE vailid = @vailid AND paramid = @paramid AND testtype NOT IN ('Head', 'Profile');
        SET @matched = @@ROWCOUNT;
      END

      -- Tier 3: same test by code (profile members keep the member test's code).
      -- Only for test-level mappings (no paramid) so a panel can't be overwritten.
      IF @matched = 0 AND @testcode <> '' AND @paramid IS NULL
      BEGIN
        UPDATE tbl_med_mcc_patient_test_result ${setCols}
        WHERE vailid = @vailid AND testcode = @testcode AND testtype NOT IN ('Head', 'Profile');
        SET @matched = @@ROWCOUNT;
      END

      -- Tier 4: same test/parameter by name. Last resort; the name is specific to
      -- the analyte so it cannot bleed into a different test's row.
      IF @matched = 0 AND @testname <> ''
      BEGIN
        UPDATE tbl_med_mcc_patient_test_result ${setCols}
        WHERE vailid = @vailid AND testname = @testname AND testtype NOT IN ('Head', 'Profile');
        SET @matched = @@ROWCOUNT;
      END

      IF @matched > 0
      BEGIN
        -- Recompute sample_status exactly like Noble's UpdateSampleResult: count
        -- measurable rows (testtype not Head/Profile) vs. those now holding a
        -- value. Advance only 2 (Registered) -> 4 (Partially Tested) -> 5 (Tested).
        -- The IN (2,4) guard means Synapse never downgrades or touches Rejected
        -- (3), Authorized (6/7), Printed (8/9) or Pending (10), nor auto-authorizes.
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
      END

      SELECT @matched AS matched;
    `)

    const matched = Number(result.recordset?.[0]?.matched ?? 0)
    if (matched === 0) {
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
        `No matching result row for ${write.vailid} ${write.testCode} ` +
          `(mapped testid ${write.testId}, paramid ${write.paramId ?? 'null'}, name "${write.testName}") — ` +
          `sample rows: ${rowsDump || '(none registered)'}`
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

  async recentWrites(): Promise<LisResultWrite[]> {
    return [...this.writes]
  }

  async testConnection(settings: LisConnectionSettings): Promise<LisConnectionResult> {
    try {
      const mssql = await this.getMssql()
      const pool = await mssql.connect({
        server: settings.server,
        port: settings.port,
        database: settings.database,
        user: settings.user,
        password: settings.password,
        options: { encrypt: settings.encrypt, trustServerCertificate: true }
      })
      await pool.request().query('SELECT 1 AS ok')
      await pool.close()
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
    }
  }

  async close(): Promise<void> {
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
