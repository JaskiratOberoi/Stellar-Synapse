/**
 * Stellar Synapse - IPC contract.
 *
 * Channel names (invoke/handle) and event names (push from main -> renderer)
 * plus the typed `StellarApi` surface exposed on `window.api` via the preload
 * contextBridge.
 */

import type {
  AppSettings,
  DashboardStats,
  DiscoveredHost,
  DiscoverySubnet,
  InstrumentDefinition,
  InstrumentDriverInfo,
  InstrumentRuntime,
  LisConnectionResult,
  LisConnectionSettings,
  LisParameter,
  LisResultWrite,
  LisTest,
  LogEntry,
  MappingRule,
  MonitorEvent,
  ScanProgress,
  SerialPortInfo
} from './types'

/** Request/response channels (renderer -> main, via ipcRenderer.invoke). */
export const IPC = {
  // Driver catalog
  driversList: 'drivers:list',

  // Instruments
  instrumentsList: 'instruments:list',
  instrumentAdd: 'instruments:add',
  instrumentUpdate: 'instruments:update',
  instrumentRemove: 'instruments:remove',
  instrumentStart: 'instruments:start',
  instrumentStop: 'instruments:stop',

  // Serial
  serialListPorts: 'serial:list-ports',

  // Mapping
  mappingsList: 'mappings:list',
  mappingUpsert: 'mappings:upsert',
  mappingRemove: 'mappings:remove',
  mappingAutoMap: 'mappings:auto-map',

  // LIS catalog + connection
  lisTests: 'lis:tests',
  lisParameters: 'lis:parameters',
  lisGetSettings: 'lis:get-settings',
  lisSaveSettings: 'lis:save-settings',
  lisTestConnection: 'lis:test-connection',
  lisRecentWrites: 'lis:recent-writes',
  lisWriteBarcode: 'lis:write-barcode',
  lisParseFrame: 'lis:parse-frame',
  lisParseAllUnwritten: 'lis:parse-all-unwritten',

  // Monitor + logs
  monitorRecent: 'monitor:recent',
  logsRecent: 'logs:recent',

  // Dashboard + settings
  dashboardStats: 'dashboard:stats',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',

  // Simulator
  simulatorStart: 'simulator:start',
  simulatorStop: 'simulator:stop',
  simulatorEmit: 'simulator:emit-one',

  // Network discovery
  discoverySubnets: 'discovery:subnets',
  discoveryScan: 'discovery:scan',
  discoveryStop: 'discovery:stop'
} as const

/** Push events (main -> renderer, via webContents.send). */
export const IPC_EVENT = {
  instrumentsChanged: 'evt:instruments-changed',
  monitorEvent: 'evt:monitor-event',
  log: 'evt:log',
  mappingsChanged: 'evt:mappings-changed',
  lisStateChanged: 'evt:lis-state-changed',
  discoveryProgress: 'evt:discovery-progress',
  discoveryHost: 'evt:discovery-host'
} as const

/** The API surface available to the renderer as `window.api`. */
export interface StellarApi {
  drivers: {
    list(): Promise<InstrumentDriverInfo[]>
  }
  instruments: {
    list(): Promise<InstrumentRuntime[]>
    add(def: Omit<InstrumentDefinition, 'id' | 'createdAt'>): Promise<InstrumentRuntime>
    update(id: string, patch: Partial<InstrumentDefinition>): Promise<InstrumentRuntime>
    remove(id: string): Promise<void>
    start(id: string): Promise<InstrumentRuntime>
    stop(id: string): Promise<InstrumentRuntime>
    onChanged(cb: (instruments: InstrumentRuntime[]) => void): () => void
  }
  serial: {
    /** Enumerate serial ports on the host. Empty if serialport can't load. */
    listPorts(): Promise<SerialPortInfo[]>
  }
  mappings: {
    list(driverId?: string): Promise<MappingRule[]>
    upsert(rule: MappingRule): Promise<MappingRule>
    remove(id: string): Promise<void>
    autoMap(driverId: string): Promise<MappingRule[]>
    onChanged(cb: (rules: MappingRule[]) => void): () => void
  }
  lis: {
    tests(): Promise<LisTest[]>
    parameters(testId?: number): Promise<LisParameter[]>
    getSettings(): Promise<LisConnectionSettings>
    saveSettings(settings: LisConnectionSettings): Promise<LisConnectionSettings>
    testConnection(settings: LisConnectionSettings): Promise<LisConnectionResult>
    recentWrites(): Promise<LisResultWrite[]>
    writeBarcode(
      instrumentId: string,
      barcode: string
    ): Promise<{ written: number; skipped: number; errors: number }>
    parseFrame(
      instrumentId: string,
      raw: string
    ): Promise<{ written: number; skipped: number; errors: number; barcode: string }>
    parseAllUnwritten(
      instrumentId: string
    ): Promise<{ frames: number; written: number; skipped: number; errors: number }>
  }
  monitor: {
    recent(): Promise<MonitorEvent[]>
    onEvent(cb: (evt: MonitorEvent) => void): () => void
  }
  logs: {
    recent(): Promise<LogEntry[]>
    onLog(cb: (entry: LogEntry) => void): () => void
  }
  dashboard: {
    stats(): Promise<DashboardStats>
  }
  settings: {
    get(): Promise<AppSettings>
    save(settings: Partial<AppSettings>): Promise<AppSettings>
  }
  simulator: {
    start(): Promise<void>
    stop(): Promise<void>
    emitOne(instrumentId?: string): Promise<void>
  }
  discovery: {
    subnets(): Promise<DiscoverySubnet[]>
    scan(cidr: string): Promise<DiscoveredHost[]>
    stop(): Promise<void>
    onProgress(cb: (p: ScanProgress) => void): () => void
    onHost(cb: (host: DiscoveredHost) => void): () => void
  }
}
