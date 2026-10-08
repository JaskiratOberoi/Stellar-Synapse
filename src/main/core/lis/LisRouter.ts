import type {
  LisConnectionResult,
  LisConnectionSettings,
  LisParameter,
  LisResultWrite,
  LisWriteResult,
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

  /**
   * The Noble test/parameter catalog, with the last live copy cached on disk.
   * The renderer needs it to open the Mapping editor, and MappingEngine.autoMap
   * needs it when settings are saved — neither should fail outright because the
   * DB is unreachable at that moment (a WAN drop at a remote site was bricking
   * the whole UI at startup). A live fetch refreshes the cache; a failed one
   * serves the cache with a warning, and only throws when there is nothing
   * cached yet (first run, never connected).
   */
  async getTests(): Promise<LisTest[]> {
    try {
      const tests = await this.backend.getTests()
      if (this.backend.mode === 'sql') this.updateCatalogCache({ tests })
      return tests
    } catch (err) {
      const cached = persist.getLisCatalog()
      if (!cached || cached.tests.length === 0) throw err
      logger.warn(
        'lis',
        `Noble test catalog unavailable (${(err as Error).message}); serving ${cached.tests.length} tests cached ${cached.fetchedAt}`
      )
      return cached.tests
    }
  }

  async getParameters(testId?: number): Promise<LisParameter[]> {
    try {
      const parameters = await this.backend.getParameters(testId)
      if (this.backend.mode === 'sql' && testId == null) this.updateCatalogCache({ parameters })
      return parameters
    } catch (err) {
      const cached = persist.getLisCatalog()
      if (!cached || cached.parameters.length === 0) throw err
      logger.warn(
        'lis',
        `Noble parameter catalog unavailable (${(err as Error).message}); serving ${cached.parameters.length} parameters cached ${cached.fetchedAt}`
      )
      return testId == null
        ? cached.parameters
        : cached.parameters.filter((p) => p.testId === testId)
    }
  }

  private updateCatalogCache(part: { tests?: LisTest[]; parameters?: LisParameter[] }): void {
    const prev = persist.getLisCatalog()
    persist.setLisCatalog({
      tests: part.tests ?? prev?.tests ?? [],
      parameters: part.parameters ?? prev?.parameters ?? [],
      fetchedAt: new Date().toISOString()
    })
  }

  getOrder(vailid: string): Promise<TestOrder | null> {
    return this.backend.getOrder(vailid)
  }

  getFilledResultKeys(vailid: string): Promise<Set<string>> {
    return this.backend.getFilledResultKeys(vailid)
  }

  writeResult(write: LisResultWrite): Promise<LisWriteResult> {
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
