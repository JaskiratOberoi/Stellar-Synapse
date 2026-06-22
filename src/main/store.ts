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
  resultsProcessed: number
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
}

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
    launchAtStartup: false
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

  getSettings: (): AppSettings => {
    const s = store().get('settings')
    // Backfill new settings keys for existing installs.
    if (s.lisAutoWrite === undefined || s.launchAtStartup === undefined) {
      const next = {
        ...s,
        lisAutoWrite: s.lisAutoWrite ?? true,
        launchAtStartup: s.launchAtStartup ?? false
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
