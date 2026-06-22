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
import type { SqlLisRepository } from './SqlLisRepository'
import { logger } from '../logger'

/**
 * Read-only ("safe") wrapper over the live SQL repository.
 *
 * All READ operations (catalog, host-query order lookups) are delegated straight
 * to the real Noble SQL Server, so features like the Beckman AU host query can be
 * exercised against production data. Every WRITE is intercepted and dropped — the
 * production database is never modified. Suppressed writes are recorded in an
 * in-memory buffer so the UI can show exactly what WOULD have been written.
 *
 * `mode` is reported as 'sql' on purpose: order-lookup / sample-id reconcile paths
 * in the orchestrator are gated on a live SQL backend, and we want them active.
 */
export class ReadOnlyLisRepository implements ILisRepository {
  readonly mode = 'sql' as const
  private suppressed: LisResultWrite[] = []
  private readonly maxWrites = 200

  constructor(private readonly inner: SqlLisRepository) {}

  getTests(): Promise<LisTest[]> {
    return this.inner.getTests()
  }

  getParameters(testId?: number): Promise<LisParameter[]> {
    return this.inner.getParameters(testId)
  }

  getOrder(vailid: string): Promise<TestOrder | null> {
    return this.inner.getOrder(vailid)
  }

  async writeResult(write: LisResultWrite): Promise<LisWriteOutcome> {
    this.suppressed.unshift(write)
    if (this.suppressed.length > this.maxWrites) this.suppressed.pop()
    logger.warn(
      'lis-readonly',
      `WRITE BLOCKED (read-only mode) — would write ${write.vailid} ${write.testCode}` +
        `${write.paramId ? `[${write.paramId}]` : ''}=${write.value} ${write.unit ?? ''}`
    )
    return 'suppressed'
  }

  /** Surface the would-have-written results so the UI's "recent writes" still works. */
  async recentWrites(): Promise<LisResultWrite[]> {
    return [...this.suppressed]
  }

  testConnection(settings: LisConnectionSettings): Promise<LisConnectionResult> {
    return this.inner.testConnection(settings)
  }

  close(): Promise<void> {
    return this.inner.close()
  }
}
