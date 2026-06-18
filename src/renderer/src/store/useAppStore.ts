import { create } from 'zustand'
import type {
  AppSettings,
  DashboardStats,
  InstrumentDriverInfo,
  InstrumentRuntime,
  LisConnectionSettings,
  LisParameter,
  LisTest,
  LogEntry,
  MappingRule,
  MonitorEvent
} from '@shared/types'

interface AppState {
  ready: boolean
  error: string | null
  drivers: InstrumentDriverInfo[]
  instruments: InstrumentRuntime[]
  mappings: MappingRule[]
  monitor: MonitorEvent[]
  logs: LogEntry[]
  tests: LisTest[]
  parameters: LisParameter[]
  settings: AppSettings | null
  lisSettings: LisConnectionSettings | null
  stats: DashboardStats | null

  init: () => Promise<void>
  refreshInstruments: () => Promise<void>
  refreshMappings: () => Promise<void>
  refreshStats: () => Promise<void>
  setSettings: (s: AppSettings) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  error: null,
  drivers: [],
  instruments: [],
  mappings: [],
  monitor: [],
  logs: [],
  tests: [],
  parameters: [],
  settings: null,
  lisSettings: null,
  stats: null,

  init: async () => {
    const api = window.api
    if (!api) {
      set({
        error:
          'Backend bridge (window.api) is unavailable. The preload script failed to load.',
        ready: true
      })
      return
    }
    try {
      const [drivers, instruments, mappings, monitor, logs, tests, parameters, settings, lisSettings, stats] =
        await Promise.all([
          api.drivers.list(),
          api.instruments.list(),
          api.mappings.list(),
          api.monitor.recent(),
          api.logs.recent(),
          api.lis.tests(),
          api.lis.parameters(),
          api.settings.get(),
          api.lis.getSettings(),
          api.dashboard.stats()
        ])
      set({
        drivers,
        instruments,
        mappings,
        monitor,
        logs,
        tests,
        parameters,
        settings,
        lisSettings,
        stats,
        ready: true,
        error: null
      })

      // Live subscriptions.
      api.instruments.onChanged((list) => set({ instruments: list }))
      api.mappings.onChanged((rules) => set({ mappings: rules }))
      api.monitor.onEvent((evt) =>
        set((st) => {
          if (st.monitor.some((m) => m.id === evt.id)) return st
          return { monitor: [evt, ...st.monitor].slice(0, 2000) }
        })
      )
      api.logs.onLog((entry) => set((st) => ({ logs: [entry, ...st.logs].slice(0, 500) })))

      // Periodic dashboard refresh.
      setInterval(() => get().refreshStats(), 4000)
    } catch (err) {
      set({ error: (err as Error).message, ready: true })
    }
  },

  refreshInstruments: async () => set({ instruments: await window.api.instruments.list() }),
  refreshMappings: async () => set({ mappings: await window.api.mappings.list() }),
  refreshStats: async () => set({ stats: await window.api.dashboard.stats() }),
  setSettings: (s) => set({ settings: s })
}))
