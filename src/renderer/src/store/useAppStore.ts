import { create } from 'zustand'
import type {
  AppSettings,
  CloudSyncStatus,
  DashboardStats,
  InstrumentDriverInfo,
  InstrumentRuntime,
  LisConnectionSettings,
  LisParameter,
  LisTest,
  LocationPreset,
  LogEntry,
  MappingRule,
  MonitorEvent
} from '@shared/types'

/** Renderer-side retention for the live streams (the main process keeps the same). */
const MAX_MONITOR = 2000
const MAX_LOGS = 500

interface AppState {
  ready: boolean
  error: string | null
  drivers: InstrumentDriverInfo[]
  presets: LocationPreset[]
  instruments: InstrumentRuntime[]
  mappings: MappingRule[]
  monitor: MonitorEvent[]
  logs: LogEntry[]
  tests: LisTest[]
  parameters: LisParameter[]
  /**
   * Why the Noble test/parameter catalog is missing, if it is. The catalog is
   * fetched best-effort: an unreachable DB at launch must not block the app
   * (the engine keeps queueing results regardless), so the lists stay empty,
   * this holds the reason, and the store retries in the background.
   */
  lisCatalogError: string | null
  settings: AppSettings | null
  lisSettings: LisConnectionSettings | null
  stats: DashboardStats | null
  cloudStatus: CloudSyncStatus | null

  init: () => Promise<void>
  /**
   * Pull fresh snapshots of everything the main process streams live. Used when
   * the window becomes visible again: while it was hidden the main process
   * withheld the monitor / log / instrument pushes (see registerIpc), so the
   * store catches up from the authoritative buffers in one round trip.
   */
  resync: () => Promise<void>
  /** Re-fetch the Noble catalog; clears or updates `lisCatalogError`. Never throws. */
  refreshLisCatalog: () => Promise<void>
  refreshInstruments: () => Promise<void>
  refreshMappings: () => Promise<void>
  refreshStats: () => Promise<void>
  setSettings: (s: AppSettings) => void
}

/**
 * `init` wires IPC subscriptions and a polling interval, none of which React
 * can clean up (the store outlives every component). Guard it so a remount of
 * <App> — the app-level ErrorBoundary's "Try again", or StrictMode's double
 * effect in dev — can't stack a second set of listeners and a second interval.
 */
let initStarted = false

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  error: null,
  drivers: [],
  presets: [],
  instruments: [],
  mappings: [],
  monitor: [],
  logs: [],
  tests: [],
  parameters: [],
  lisCatalogError: null,
  settings: null,
  lisSettings: null,
  stats: null,
  cloudStatus: null,

  init: async () => {
    if (initStarted) return
    initStarted = true
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
      // Everything here is local to the machine except the two Noble catalog
      // calls, which cross the WAN. Those degrade to empty lists plus a reason
      // instead of failing startup; everything else failing is a real fault.
      let lisCatalogError: string | null = null
      const catalog = <T>(p: Promise<T[]>): Promise<T[]> =>
        p.catch((err: Error) => {
          lisCatalogError = err.message
          return []
        })
      const [drivers, presets, instruments, mappings, monitor, logs, tests, parameters, settings, lisSettings, stats] =
        await Promise.all([
          api.drivers.list(),
          api.presets.list(),
          api.instruments.list(),
          api.mappings.list(),
          api.monitor.recent(),
          api.logs.recent(),
          catalog(api.lis.tests()),
          catalog(api.lis.parameters()),
          api.settings.get(),
          api.lis.getSettings(),
          api.dashboard.stats()
        ])
      set({
        drivers,
        presets,
        instruments,
        mappings,
        monitor: monitor.slice(0, MAX_MONITOR),
        logs: logs.slice(0, MAX_LOGS),
        tests,
        parameters,
        lisCatalogError,
        settings,
        lisSettings,
        stats,
        ready: true,
        error: null
      })

      // Live subscriptions. Both streams de-duplicate by id: a resync snapshot
      // and a push can carry the same event around the moment the window is
      // shown, and neither list may ever grow past its cap.
      api.instruments.onChanged((list) => set({ instruments: list }))
      api.mappings.onChanged((rules) => set({ mappings: rules }))
      api.monitor.onEvent((evt) =>
        set((st) => {
          if (st.monitor.some((m) => m.id === evt.id)) return st
          return { monitor: [evt, ...st.monitor].slice(0, MAX_MONITOR) }
        })
      )
      api.logs.onLog((entry) =>
        set((st) => {
          if (st.logs.some((l) => l.id === entry.id)) return st
          return { logs: [entry, ...st.logs].slice(0, MAX_LOGS) }
        })
      )
      api.cloud.status().then((cloudStatus) => set({ cloudStatus })).catch(() => undefined)
      api.cloud.onStatus((cloudStatus) => set({ cloudStatus }))

      // Visibility: while the document is hidden (tray, minimised, covered) the
      // main process stops streaming to us; when it is shown again we re-sync
      // from snapshots. Report the initial state too — a login-time `--hidden`
      // launch starts life in the tray.
      const reportVisibility = (): void => {
        const visible = document.visibilityState === 'visible'
        try {
          api.system.setVisible?.(visible)
        } catch {
          /* older preload without the channel — streaming stays on */
        }
        if (visible) void get().resync()
      }
      document.addEventListener('visibilitychange', reportVisibility)
      try {
        api.system.setVisible?.(document.visibilityState === 'visible')
      } catch {
        /* see above */
      }

      // Periodic dashboard refresh — idle while hidden; resync covers the catch-up.
      // Every ~30 s of that cadence, retry the Noble catalog if it is still missing.
      let ticks = 0
      setInterval(() => {
        if (document.visibilityState !== 'visible') return
        void get().refreshStats().catch(() => undefined)
        ticks++
        if (ticks % 8 === 0 && get().lisCatalogError) void get().refreshLisCatalog()
      }, 4000)
    } catch (err) {
      set({ error: (err as Error).message, ready: true })
    }
  },

  resync: async () => {
    const api = window.api
    if (!api || !get().ready) return
    try {
      const [instruments, mappings, monitor, logs, stats, cloudStatus] = await Promise.all([
        api.instruments.list(),
        api.mappings.list(),
        api.monitor.recent(),
        api.logs.recent(),
        api.dashboard.stats(),
        api.cloud.status()
      ])
      set({
        instruments,
        mappings,
        monitor: monitor.slice(0, MAX_MONITOR),
        logs: logs.slice(0, MAX_LOGS),
        stats,
        cloudStatus
      })
    } catch {
      /* best-effort; the next push or poll fills in */
    }
    if (get().lisCatalogError) void get().refreshLisCatalog()
  },

  refreshLisCatalog: async () => {
    const api = window.api
    if (!api) return
    try {
      const [tests, parameters] = await Promise.all([api.lis.tests(), api.lis.parameters()])
      set({ tests, parameters, lisCatalogError: null })
    } catch (err) {
      set({ lisCatalogError: (err as Error).message })
    }
  },

  refreshInstruments: async () => set({ instruments: await window.api.instruments.list() }),
  refreshMappings: async () => set({ mappings: await window.api.mappings.list() }),
  refreshStats: async () => set({ stats: await window.api.dashboard.stats() }),
  setSettings: (s) => set({ settings: s })
}))
