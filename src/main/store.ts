import Store from 'electron-store'
import type {
  AppSettings,
  InstrumentDefinition,
  LisConnectionSettings,
  LisResultWrite,
  MappingRule,
  MonitorEvent
} from '../shared/types'

/** Cumulative counters per instrument, restored after restart. */
export interface InstrumentPersistStats {
  messagesReceived: number
  /** Distinct samples (SIDs) processed. */
  resultsProcessed: number
  /** Individual analyte params processed (legacy "results" count). */
  resultParamsProcessed: number
  errors: number
  lastMessageAt?: string
}

interface PersistShape {
  instruments: InstrumentDefinition[]
  mappings: MappingRule[]
  settings: AppSettings
  lis: LisConnectionSettings
  /** Newest-first monitor events retained across sessions. */
  monitorHistory: MonitorEvent[]
  instrumentStats: Record<string, InstrumentPersistStats>
  /** Results awaiting the LIS (written here when the LIS is unreachable). */
  pendingWrites: LisResultWrite[]
  /** One-time migration: enable live Noble LIS writes. */
  migratedLisLive?: boolean
  /** One-time migration: backfill the Noble SQL password for blank installs. */
  migratedLisPassword?: boolean
  /** One-time migration: collapse duplicate AU bilirubin method variants. */
  migratedAuSingleBilirubin?: boolean
  /** One-time migration: re-enable LD-560 calculated-eAG LIS posting. */
  migratedLd560EnableEag?: boolean
  /** One-time migration: force the instrument simulator off (was toolbar-toggled). */
  migratedSimulatorOff?: boolean
  /** One-time migration: re-grade flat-0.6 name matches under the graded matcher. */
  migratedRescoreNameMappings?: boolean
}

type MigrationFlagKey =
  | 'migratedAuSingleBilirubin'
  | 'migratedLd560EnableEag'
  | 'migratedRescoreNameMappings'

const MAX_MONITOR_HISTORY = 2000

const defaults: PersistShape = {
  instruments: [],
  mappings: [],
  settings: {
    theme: 'dark',
    // No synthetic data in production: the simulator is opt-in only.
    simulatorEnabled: false,
    simulatorRate: 6,
    autoMapOnReceive: true,
    lisAutoWrite: true,
    launchAtStartup: false,
    // Over-the-air updates on by default; install downloaded updates at 03:00 local.
    autoUpdateEnabled: true,
    updateInstallHour: 3
  },
  // Noble LISTEC LIS — live mode on; set password under Settings or LIS Connection.
  lis: {
    server: '122.161.198.159',
    database: 'Noble',
    user: 'nobleone',
    password: 'test-1',
    port: 1433,
    live: true,
    encrypt: false
  },
  monitorHistory: [],
  instrumentStats: {},
  pendingWrites: []
}

// Lazily created so the data directory chosen at install time (applyDataDir →
// app.setPath('userData', ...)) is in effect before the store file is opened.
let _store: Store<PersistShape> | null = null
function store(): Store<PersistShape> {
  if (!_store) _store = new Store<PersistShape>({ name: 'stellar-synapse', defaults })
  return _store
}

export const persist = {
  getInstruments: (): InstrumentDefinition[] => store().get('instruments'),
  setInstruments: (v: InstrumentDefinition[]): void => store().set('instruments', v),

  getMappings: (): MappingRule[] => store().get('mappings'),
  setMappings: (v: MappingRule[]): void => store().set('mappings', v),

  /** Read/raise a one-time migration flag (generic, keyed by name). */
  getMigrationFlag: (key: MigrationFlagKey): boolean => !!store().get(key),
  setMigrationFlag: (key: MigrationFlagKey, value: boolean): void => store().set(key, value),

  getSettings: (): AppSettings => {
    let s = store().get('settings')
    // One-time: force the simulator OFF. It used to be toggleable from the toolbar,
    // so a machine could have it persisted 'on' — which would emit SYNTHETIC results
    // into a live Noble LIS. It's now an opt-in Settings control, off by default.
    if (!store().get('migratedSimulatorOff')) {
      if (s.simulatorEnabled) {
        s = { ...s, simulatorEnabled: false }
        store().set('settings', s)
      }
      store().set('migratedSimulatorOff', true)
    }
    // Backfill new settings keys for existing installs.
    if (
      s.lisAutoWrite === undefined ||
      s.launchAtStartup === undefined ||
      s.autoUpdateEnabled === undefined ||
      s.updateInstallHour === undefined
    ) {
      const next = {
        ...s,
        lisAutoWrite: s.lisAutoWrite ?? true,
        launchAtStartup: s.launchAtStartup ?? false,
        autoUpdateEnabled: s.autoUpdateEnabled ?? true,
        updateInstallHour: s.updateInstallHour ?? 3
      }
      store().set('settings', next)
      return next
    }
    return s
  },
  setSettings: (v: AppSettings): void => store().set('settings', v),

  getLis: (): LisConnectionSettings => {
    if (!store().get('migratedLisLive')) {
      const lis = store().get('lis')
      store().set('lis', { ...lis, live: true })
      store().set('migratedLisLive', true)
    }
    // Backfill the Noble SQL password for installs created before it shipped as a
    // default (blank password) so they connect without manual entry.
    if (!store().get('migratedLisPassword')) {
      const lis = store().get('lis')
      if (!lis.password) store().set('lis', { ...lis, password: 'test-1' })
      store().set('migratedLisPassword', true)
    }
    return store().get('lis')
  },
  setLis: (v: LisConnectionSettings): void => store().set('lis', v),

  getMonitorHistory: (): MonitorEvent[] => store().get('monitorHistory'),
  setMonitorHistory: (v: MonitorEvent[]): void => store().set('monitorHistory', v),
  prependMonitorEvent: (evt: MonitorEvent): void => {
    const history = [evt, ...store().get('monitorHistory')]
    if (history.length > MAX_MONITOR_HISTORY) history.length = MAX_MONITOR_HISTORY
    store().set('monitorHistory', history)
  },

  getPendingWrites: (): LisResultWrite[] => store().get('pendingWrites'),
  setPendingWrites: (v: LisResultWrite[]): void => store().set('pendingWrites', v),

  getInstrumentStats: (instrumentId: string): InstrumentPersistStats | undefined =>
    store().get('instrumentStats')[instrumentId],

  setInstrumentStats: (instrumentId: string, stats: InstrumentPersistStats): void => {
    const all = { ...store().get('instrumentStats') }
    all[instrumentId] = stats
    store().set('instrumentStats', all)
  },

  removeInstrumentStats: (instrumentId: string): void => {
    const all = { ...store().get('instrumentStats') }
    delete all[instrumentId]
    store().set('instrumentStats', all)
  }
}
