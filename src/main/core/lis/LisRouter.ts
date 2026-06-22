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
import { MockLisRepository } from './MockLisRepository'
import { SqlLisRepository } from './SqlLisRepository'
import { ReadOnlyLisRepository } from './ReadOnlyLisRepository'
import { persist } from '../../store'
import { logger } from '../logger'

/**
 * Routes LIS operations to mock or live SQL based on persisted settings.
 */
export class LisRouter implements ILisRepository {
  private backend: ILisRepository

  constructor() {
    const settings = persist.getLis()
    this.backend = this.createBackend(settings)
    logger.info('lis', `Startup mode: ${this.modeLabel(settings)}`)
  }

  get mode(): 'mock' | 'sql' {
    return this.backend.mode
  }

  /** Switch live/mock mode (called when LIS settings are saved). */
  configure(settings: LisConnectionSettings): void {
    persist.setLis(settings)
    void this.close()
    this.backend = this.createBackend(settings)
    logger.info('lis', this.modeLabel(settings))
  }

  private modeLabel(settings: LisConnectionSettings): string {
    if (settings.live && settings.readOnly) return 'Read-only Noble SQL (reads live, writes BLOCKED)'
    if (settings.live) return 'Live Noble SQL enabled'
    return 'Mock LIS mode'
  }

  private createBackend(settings: LisConnectionSettings): ILisRepository {
    if (settings.live && settings.readOnly) {
      return new ReadOnlyLisRepository(new SqlLisRepository(settings))
    }
    if (settings.live) return new SqlLisRepository(settings)
    return new MockLisRepository()
  }

  getTests(): Promise<LisTest[]> {
    return this.backend.getTests()
  }

  getParameters(testId?: number): Promise<LisParameter[]> {
    return this.backend.getParameters(testId)
  }

  getOrder(vailid: string): Promise<TestOrder | null> {
    return this.backend.getOrder(vailid)
  }

  writeResult(write: LisResultWrite): Promise<LisWriteOutcome> {
    return this.backend.writeResult(write)
  }

  recentWrites(): Promise<LisResultWrite[]> {
    return this.backend.recentWrites()
  }

  testConnection(settings: LisConnectionSettings): Promise<LisConnectionResult> {
    if (settings.live) return new SqlLisRepository(settings).testConnection(settings)
    return this.backend.testConnection(settings)
  }

  async close(): Promise<void> {
    if (this.backend instanceof SqlLisRepository || this.backend instanceof ReadOnlyLisRepository) {
      await this.backend.close()
    }
  }
}
