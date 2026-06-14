import type {
  LisConnectionResult,
  LisConnectionSettings,
  LisParameter,
  LisResultWrite,
  LisTest,
  TestOrder
} from '../../../shared/types'

/**
 * Abstraction over the LIS database. The mock implementation backs the
 * scaffold; the SQL implementation (against the Noble SQL Server) plugs in
 * later without touching the rest of the pipeline.
 */
export interface ILisRepository {
  readonly mode: 'mock' | 'sql'
  /** Read the test catalog (tbl_med_test_master). */
  getTests(): Promise<LisTest[]>
  /** Read parameters (tbl_med_parameter_master), optionally for one test. */
  getParameters(testId?: number): Promise<LisParameter[]>
  /** Look up a pending order by sample barcode (tbl_med_mcc_patient_samples). */
  getOrder(vailid: string): Promise<TestOrder | null>
  /** Persist a result (tbl_med_mcc_patient_test_result). */
  writeResult(write: LisResultWrite): Promise<void>
  /** Recently written results (for the UI). */
  recentWrites(): Promise<LisResultWrite[]>
  /** Validate connectivity for the given settings. */
  testConnection(settings: LisConnectionSettings): Promise<LisConnectionResult>
}
