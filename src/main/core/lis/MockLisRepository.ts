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
import { MOCK_ORDERS, MOCK_PARAMETERS, MOCK_TESTS } from './mockData'
import { logger } from '../logger'

/**
 * In-memory LIS repository used during scaffolding. Reads from the mock catalog
 * and records "writes" to an in-memory buffer instead of touching the
 * production Noble database.
 */
export class MockLisRepository implements ILisRepository {
  readonly mode = 'mock' as const
  private writes: LisResultWrite[] = []
  private readonly maxWrites = 200

  async getTests(): Promise<LisTest[]> {
    return MOCK_TESTS
  }

  async getParameters(testId?: number): Promise<LisParameter[]> {
    return testId ? MOCK_PARAMETERS.filter((p) => p.testId === testId) : MOCK_PARAMETERS
  }

  async getOrder(vailid: string): Promise<TestOrder | null> {
    return MOCK_ORDERS.find((o) => o.vailid === vailid) ?? null
  }

  async writeResult(write: LisResultWrite): Promise<LisWriteOutcome> {
    this.writes.unshift(write)
    if (this.writes.length > this.maxWrites) this.writes.pop()
    logger.debug(
      'lis-mock',
      `(mock write) ${write.vailid} ${write.testCode}=${write.value} ${write.unit ?? ''}`
    )
    return 'written'
  }

  async recentWrites(): Promise<LisResultWrite[]> {
    return [...this.writes]
  }

  async testConnection(settings: LisConnectionSettings): Promise<LisConnectionResult> {
    return {
      state: 'mock',
      message: `Mock mode active. Live writes to ${settings.database}@${settings.server} are disabled in this scaffold phase.`,
      testedAt: new Date().toISOString()
    }
  }
}
