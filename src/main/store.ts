import Store from 'electron-store'
import type {
  AppSettings,
  InstrumentDefinition,
  LisConnectionSettings,
  MappingRule
} from '../shared/types'

interface PersistShape {
  instruments: InstrumentDefinition[]
  mappings: MappingRule[]
  settings: AppSettings
  lis: LisConnectionSettings
}

const defaults: PersistShape = {
  instruments: [],
  mappings: [],
  settings: {
    theme: 'dark',
    simulatorEnabled: true,
    simulatorRate: 6,
    autoMapOnReceive: true
  },
  // Pre-filled with the Noble connection target (live mode OFF in scaffold).
  lis: {
    server: '122.161.198.159',
    database: 'Noble',
    user: 'nobleone',
    password: '',
    port: 1433,
    live: false,
    encrypt: false
  }
}

const store = new Store<PersistShape>({ name: 'stellar-synapse', defaults })

export const persist = {
  getInstruments: (): InstrumentDefinition[] => store.get('instruments'),
  setInstruments: (v: InstrumentDefinition[]): void => store.set('instruments', v),

  getMappings: (): MappingRule[] => store.get('mappings'),
  setMappings: (v: MappingRule[]): void => store.set('mappings', v),

  getSettings: (): AppSettings => store.get('settings'),
  setSettings: (v: AppSettings): void => store.set('settings', v),

  getLis: (): LisConnectionSettings => store.get('lis'),
  setLis: (v: LisConnectionSettings): void => store.set('lis', v)
}
