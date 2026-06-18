import { BrowserWindow, ipcMain } from 'electron'
import { IPC, IPC_EVENT } from '../../shared/ipc'
import type {
  AppSettings,
  DashboardStats,
  InstrumentDefinition,
  LisConnectionResult,
  LisConnectionSettings,
  MappingRule
} from '../../shared/types'
import { listDriverInfos } from '../core/drivers/registry'
import type { Orchestrator } from '../core/engine/Orchestrator'
import type { Simulator } from '../core/simulator/Simulator'
import type { ILisRepository } from '../core/lis/ILisRepository'
import type { LisRouter } from '../core/lis/LisRouter'
import { SqlLisRepository } from '../core/lis/SqlLisRepository'
import { NetworkScanner } from '../core/discovery/NetworkScanner'
import { persist } from '../store'
import { logger } from '../core/logger'

interface Services {
  orchestrator: Orchestrator
  simulator: Simulator
  lis: ILisRepository & Partial<Pick<LisRouter, 'configure'>>
}

function buildDashboard(orchestrator: Orchestrator, lis: ILisRepository): DashboardStats {
  const instruments = orchestrator.listInstruments()
  const online = instruments.filter((i) => i.status === 'online' || i.status === 'listening').length
  const monitor = orchestrator.recentMonitor()
  const today = new Date().toDateString()
  const written = monitor.filter(
    (m) => m.stage === 'written' && new Date(m.timestamp).toDateString() === today
  )
  const errors = monitor.filter(
    (m) => m.stage === 'error' && new Date(m.timestamp).toDateString() === today
  ).length

  // Build a 12-hour rolling histogram of written results.
  const buckets: { hour: string; count: number }[] = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600_000)
    const label = `${String(d.getHours()).padStart(2, '0')}:00`
    const count = written.filter((m) => new Date(m.timestamp).getHours() === d.getHours()).length
    buckets.push({ hour: label, count })
  }

  const counts = orchestrator.mapping.counts()

  return {
    instrumentsOnline: online,
    instrumentsTotal: instruments.length,
    resultsToday: written.length,
    resultsPerHour: buckets,
    errorsToday: errors,
    mappedAnalytes: counts.mapped,
    unmappedAnalytes: counts.unmapped,
    lisState: lis.mode === 'mock' ? 'mock' : 'connected'
  }
}

export function registerIpc(win: BrowserWindow, services: Services): void {
  const { orchestrator, simulator, lis } = services

  // Forward backend events to the renderer.
  orchestrator.on('instruments', (list) => win.webContents.send(IPC_EVENT.instrumentsChanged, list))
  orchestrator.on('monitor', (evt) => win.webContents.send(IPC_EVENT.monitorEvent, evt))
  orchestrator.on('mappings', (rules) => win.webContents.send(IPC_EVENT.mappingsChanged, rules))
  logger.on('log', (entry) => win.webContents.send(IPC_EVENT.log, entry))

  // Drivers
  ipcMain.handle(IPC.driversList, () => listDriverInfos())

  // Instruments
  ipcMain.handle(IPC.instrumentsList, () => orchestrator.listInstruments())
  ipcMain.handle(IPC.instrumentAdd, (_e, def: Omit<InstrumentDefinition, 'id' | 'createdAt'>) =>
    orchestrator.addInstrument(def)
  )
  ipcMain.handle(IPC.instrumentUpdate, (_e, id: string, patch: Partial<InstrumentDefinition>) =>
    orchestrator.updateInstrument(id, patch)
  )
  ipcMain.handle(IPC.instrumentRemove, (_e, id: string) => orchestrator.removeInstrument(id))
  ipcMain.handle(IPC.instrumentStart, (_e, id: string) => orchestrator.startInstrument(id))
  ipcMain.handle(IPC.instrumentStop, (_e, id: string) => orchestrator.stopInstrument(id))

  // Mapping
  ipcMain.handle(IPC.mappingsList, (_e, driverId?: string) => orchestrator.mapping.list(driverId))
  ipcMain.handle(IPC.mappingUpsert, (_e, rule: MappingRule) => {
    const next = orchestrator.mapping.upsert(rule)
    win.webContents.send(IPC_EVENT.mappingsChanged, orchestrator.mapping.list())
    return next
  })
  ipcMain.handle(IPC.mappingRemove, (_e, id: string) => {
    orchestrator.mapping.remove(id)
    win.webContents.send(IPC_EVENT.mappingsChanged, orchestrator.mapping.list())
  })
  ipcMain.handle(IPC.mappingAutoMap, async (_e, driverId: string) => {
    const rules = await orchestrator.mapping.autoMap(driverId)
    win.webContents.send(IPC_EVENT.mappingsChanged, orchestrator.mapping.list())
    return rules
  })

  // LIS catalog + connection
  ipcMain.handle(IPC.lisTests, () => lis.getTests())
  ipcMain.handle(IPC.lisParameters, (_e, testId?: number) => lis.getParameters(testId))
  ipcMain.handle(IPC.lisGetSettings, () => persist.getLis())
  ipcMain.handle(IPC.lisSaveSettings, async (_e, settings: LisConnectionSettings) => {
    if (typeof lis.configure === 'function') {
      lis.configure(settings)
    } else {
      persist.setLis(settings)
    }
    if (settings.live) {
      await orchestrator.mapping.autoMap('landwind-ld-560')
      win.webContents.send(IPC_EVENT.mappingsChanged, orchestrator.mapping.list())
    }
    win.webContents.send(IPC_EVENT.lisStateChanged, { mode: lis.mode })
    return persist.getLis()
  })
  ipcMain.handle(
    IPC.lisTestConnection,
    async (_e, settings: LisConnectionSettings): Promise<LisConnectionResult> => {
      // In live mode, probe SQL Server; otherwise return the mock status.
      if (settings.live) {
        return new SqlLisRepository(settings).testConnection(settings)
      }
      return lis.testConnection(settings)
    }
  )
  ipcMain.handle(IPC.lisRecentWrites, () => lis.recentWrites())
  ipcMain.handle(IPC.lisWriteBarcode, async (_e, instrumentId: string, barcode: string) =>
    orchestrator.writeBarcodeToLis(instrumentId, barcode)
  )
  ipcMain.handle(IPC.lisParseFrame, async (_e, instrumentId: string, raw: string) =>
    orchestrator.parseFrameToLis(instrumentId, raw)
  )
  ipcMain.handle(IPC.lisParseAllUnwritten, async (_e, instrumentId: string) =>
    orchestrator.parseAllUnwrittenToLis(instrumentId)
  )

  // Monitor + logs
  ipcMain.handle(IPC.monitorRecent, () => orchestrator.recentMonitor())
  ipcMain.handle(IPC.logsRecent, () => logger.recent())

  // Dashboard
  ipcMain.handle(IPC.dashboardStats, () => buildDashboard(orchestrator, lis))

  // Settings
  ipcMain.handle(IPC.settingsGet, () => persist.getSettings())
  ipcMain.handle(IPC.settingsSave, (_e, patch: Partial<AppSettings>) => {
    const next = { ...persist.getSettings(), ...patch }
    persist.setSettings(next)
    if (patch.simulatorEnabled === true) simulator.start(next.simulatorRate)
    if (patch.simulatorEnabled === false) simulator.stop()
    if (patch.simulatorRate && simulator.running) simulator.start(next.simulatorRate)
    return next
  })

  // Simulator
  ipcMain.handle(IPC.simulatorStart, () => simulator.start(persist.getSettings().simulatorRate))
  ipcMain.handle(IPC.simulatorStop, () => simulator.stop())
  ipcMain.handle(IPC.simulatorEmit, (_e, instrumentId?: string) => simulator.emitOne(instrumentId))

  // Network discovery (read-only)
  const scanner = new NetworkScanner()
  scanner.on('progress', (p) => win.webContents.send(IPC_EVENT.discoveryProgress, p))
  scanner.on('host', (h) => win.webContents.send(IPC_EVENT.discoveryHost, h))
  ipcMain.handle(IPC.discoverySubnets, () => scanner.getSubnets())
  ipcMain.handle(IPC.discoveryScan, (_e, cidr: string) => scanner.scan(cidr))
  ipcMain.handle(IPC.discoveryStop, () => scanner.stop())
}
