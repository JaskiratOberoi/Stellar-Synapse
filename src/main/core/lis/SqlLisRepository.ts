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
    const mssql = await import('mssql').catch(() => null)
    if (!mssql) {
      throw new Error('The "mssql" driver is not installed. Run: npm install mssql')
    }
    return mssql as MssqlModule
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

    return {
      vailid: String(row.vailid),
      patientId: row.patientId != null ? Number(row.patientId) : undefined,
      testCodes: splitCsv(String(row.testcodes ?? '')),
      testNames: splitCsv(String(row.testnames ?? '')),
      sampleStatus: row.sampleStatus != null ? Number(row.sampleStatus) : undefined
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

    const whereParam = write.paramId
      ? 'vailid = @vailid AND testid = @testid AND paramid = @paramid'
      : 'vailid = @vailid AND testid = @testid AND (paramid IS NULL OR paramid = 0)'

    const result = await req.query(`
      -- 1) Fill the value into the pre-created result row. Never touch
      --    testcode/testname/testunit (Noble owns those labels) and never INSERT:
      --    if no ordered row matches, the test was not ordered for this sample.
      UPDATE tbl_med_mcc_patient_test_result
      SET value = @value,
          abnormal = @abnormal,
          machine_name = @machine,
          UploadFlag = @upload,
          addeddate = @addeddate
      WHERE ${whereParam};

      DECLARE @matched int = @@ROWCOUNT;

      IF @matched > 0
      BEGIN
        -- 2) Recompute sample_status exactly like Noble's UpdateSampleResult:
        --    count measurable rows (testtype not Head/Profile) vs. those now
        --    holding a value. Advance only 2 (Registered) -> 4 (Partially Tested)
        --    -> 5 (Tested). The IN (2,4) guard means Synapse never downgrades or
        --    touches Rejected (3), Authorized (6/7), Printed (8/9) or Pending (10),
        --    and never auto-authorizes.
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
      logger.warn(
        'lis-sql',
        `No ordered row for ${write.vailid} ${write.testCode}${write.paramId ? `[param ${write.paramId}]` : ''} — test not ordered for this sample; skipped (no row inserted)`
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
