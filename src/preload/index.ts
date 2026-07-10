import { contextBridge, ipcRenderer } from 'electron'
import { IPC, IPC_EVENT, type StellarApi } from '../shared/ipc'
import type {
  InstrumentRuntime,
  MappingRule,
  MonitorEvent,
  LogEntry,
  ScanProgress,
  DiscoveredHost
} from '../shared/types'

/** Helper to subscribe to a push event and return an unsubscribe function. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: StellarApi = {
  drivers: {
    list: () => ipcRenderer.invoke(IPC.driversList)
  },
  presets: {
    list: () => ipcRenderer.invoke(IPC.presetsList)
  },
  instruments: {
    list: () => ipcRenderer.invoke(IPC.instrumentsList),
    add: (def) => ipcRenderer.invoke(IPC.instrumentAdd, def),
    update: (id, patch) => ipcRenderer.invoke(IPC.instrumentUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.instrumentRemove, id),
    start: (id) => ipcRenderer.invoke(IPC.instrumentStart, id),
    stop: (id) => ipcRenderer.invoke(IPC.instrumentStop, id),
    clearErrors: (id) => ipcRenderer.invoke(IPC.instrumentClearErrors, id),
    onChanged: (cb) => on<InstrumentRuntime[]>(IPC_EVENT.instrumentsChanged, cb)
  },
  serial: {
    listPorts: () => ipcRenderer.invoke(IPC.serialListPorts)
  },
  mappings: {
    list: (driverId) => ipcRenderer.invoke(IPC.mappingsList, driverId),
    upsert: (rule) => ipcRenderer.invoke(IPC.mappingUpsert, rule),
    remove: (id) => ipcRenderer.invoke(IPC.mappingRemove, id),
    autoMap: (driverId) => ipcRenderer.invoke(IPC.mappingAutoMap, driverId),
    applyPreset: (driverId, presetKey) =>
      ipcRenderer.invoke(IPC.mappingApplyPreset, driverId, presetKey),
    onChanged: (cb) => on<MappingRule[]>(IPC_EVENT.mappingsChanged, cb)
  },
  lis: {
    tests: () => ipcRenderer.invoke(IPC.lisTests),
    parameters: (testId) => ipcRenderer.invoke(IPC.lisParameters, testId),
    getSettings: () => ipcRenderer.invoke(IPC.lisGetSettings),
    saveSettings: (settings) => ipcRenderer.invoke(IPC.lisSaveSettings, settings),
    testConnection: (settings) => ipcRenderer.invoke(IPC.lisTestConnection, settings),
    recentWrites: () => ipcRenderer.invoke(IPC.lisRecentWrites),
    writeBarcode: (instrumentId, barcode) =>
      ipcRenderer.invoke(IPC.lisWriteBarcode, instrumentId, barcode),
    parseFrame: (instrumentId, raw) => ipcRenderer.invoke(IPC.lisParseFrame, instrumentId, raw),
    parseAllUnwritten: (instrumentId) =>
      ipcRenderer.invoke(IPC.lisParseAllUnwritten, instrumentId)
  },
  monitor: {
    recent: () => ipcRenderer.invoke(IPC.monitorRecent),
    onEvent: (cb) => on<MonitorEvent>(IPC_EVENT.monitorEvent, cb)
  },
  logs: {
    recent: () => ipcRenderer.invoke(IPC.logsRecent),
    onLog: (cb) => on<LogEntry>(IPC_EVENT.log, cb)
  },
  dashboard: {
    stats: () => ipcRenderer.invoke(IPC.dashboardStats)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (settings) => ipcRenderer.invoke(IPC.settingsSave, settings)
  },
  system: {
    lanIp: () => ipcRenderer.invoke(IPC.systemLanIp)
  },
  simulator: {
    start: () => ipcRenderer.invoke(IPC.simulatorStart),
    stop: () => ipcRenderer.invoke(IPC.simulatorStop),
    emitOne: (instrumentId) => ipcRenderer.invoke(IPC.simulatorEmit, instrumentId)
  },
  discovery: {
    subnets: () => ipcRenderer.invoke(IPC.discoverySubnets),
    scan: (cidr) => ipcRenderer.invoke(IPC.discoveryScan, cidr),
    stop: () => ipcRenderer.invoke(IPC.discoveryStop),
    onProgress: (cb) => on<ScanProgress>(IPC_EVENT.discoveryProgress, cb),
    onHost: (cb) => on<DiscoveredHost>(IPC_EVENT.discoveryHost, cb)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('[preload] failed to expose api', error)
  }
} else {
  // @ts-ignore - fallback when context isolation is disabled
  window.api = api
}
