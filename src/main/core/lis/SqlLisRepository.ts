import type {
  LisConnectionResult,
  LisConnectionSettings,
  LisParameter,
  LisResultWrite,
  LisTest,
  TestOrder
} from '../../../shared/types'
import type { ILisRepository } from './ILisRepository'
import { logger } from '../logger'

/**
 * SQL Server repository for the Noble LIS (DISABLED in the scaffold phase).
 *
 * The Noble connection used by LISTEC is:
 *   Data Source=<server>,1433; Initial Catalog=Noble; User ID=nobleone
 *
 * Reference SQL for the next phase (kept as documentation, not executed):
 *   - Tests:      SELECT id, TestCode, Testname, Has_Parameters FROM tbl_med_test_master WHERE IsActive = 1
 *   - Parameters: SELECT id, TestCode AS testId, Code, Name, Method FROM tbl_med_parameter_master WHERE IsActive = 1
 *   - Order:      SELECT vailid, patient_id, testcodes, testnames FROM tbl_med_mcc_patient_samples WHERE vailid = @vailid
 *   - Write:      INSERT INTO tbl_med_mcc_patient_test_result
 *                   (patientid, vailid, testid, value, testcode, testname, testunit,
 *                    abnormal, machine_name, UploadFlag, addedby, addeddate)
 *                 VALUES (...)
 *
 * Implementation will lazy-load `mssql` (an optional dependency) so the app runs
 * even where the driver is not installed.
 */
export class SqlLisRepository implements ILisRepository {
  readonly mode = 'sql' as const

  constructor(private readonly settings: LisConnectionSettings) {}

  private notImplemented(): never {
    throw new Error('SqlLisRepository is not enabled in the scaffold phase. Use MockLisRepository.')
  }

  async getTests(): Promise<LisTest[]> {
    this.notImplemented()
  }

  async getParameters(_testId?: number): Promise<LisParameter[]> {
    this.notImplemented()
  }

  async getOrder(_vailid: string): Promise<TestOrder | null> {
    this.notImplemented()
  }

  async writeResult(_write: LisResultWrite): Promise<void> {
    this.notImplemented()
  }

  async recentWrites(): Promise<LisResultWrite[]> {
    return []
  }

  async testConnection(settings: LisConnectionSettings): Promise<LisConnectionResult> {
    // Guarded live connectivity check, ready for when live mode is enabled.
    try {
      // @ts-ignore - optional dependency, types not bundled in scaffold phase
      const mssql = await import('mssql').catch(() => null)
      if (!mssql) {
        return {
          state: 'error',
          message: 'The "mssql" driver is not installed. Run: npm install mssql',
          testedAt: new Date().toISOString()
        }
      }
      logger.info('lis-sql', `Connecting to ${settings.database}@${settings.server}...`)
      const pool = await (mssql as any).connect({
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
}
