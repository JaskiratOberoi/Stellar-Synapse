import { BrowserWindow, ipcMain } from 'electron'
import { IPC, IPC_EVENT } from '../../shared/ipc'
import type {
  AppSettings,
  DashboardStats,
  InstrumentDefinition,
  LisConnectionResult,
  LisConnectionSettings,
  MappingRule,
  SerialPortInfo,
  SerialLoopbackResult
} from '../../shared/types'
import { listDriverInfos } from '../core/drivers/registry'
import { listPresets } from '../core/presets/registry'
import type { Orchestrator } from '../core/engine/Orchestrator'
import type { Simulator } from '../core/simulator/Simulator'
import type { ILisRepository } from '../core/lis/ILisRepository'
import type { LisRouter } from '../core/lis/LisRouter'
import { SqlLisRepository } from '../core/lis/SqlLisRepository'
import { NetworkScanner } from '../core/discovery/NetworkScanner'
import { persist } from '../store'
import { logger } from '../core/logger'
import { applyLoginItem } from '../autostart'
import type { AutoUpdater } from '../core/update/AutoUpdater'

interface Services {
  orchestrator: Orchestrator
  simulator: Simulator
  lis: ILisRepository & Partial<Pick<LisRouter, 'configure'>>
  updater: AutoUpdater
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
  const { orchestrator, simulator, lis, updater } = services

  // Forward backend events to the renderer.
  orchestrator.on('instruments', (list) => win.webContents.send(IPC_EVENT.instrumentsChanged, list))
  orchestrator.on('monitor', (evt) => win.webContents.send(IPC_EVENT.monitorEvent, evt))
  orchestrator.on('mappings', (rules) => win.webContents.send(IPC_EVENT.mappingsChanged, rules))
  logger.on('log', (entry) => win.webContents.send(IPC_EVENT.log, entry))
  updater.on('status', (status) => win.webContents.send(IPC_EVENT.updateStatus, status))

  // Drivers
  ipcMain.handle(IPC.driversList, () => listDriverInfos())

  // Location presets
  ipcMain.handle(IPC.presetsList, () => listPresets())

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
  ipcMain.handle(IPC.instrumentClearErrors, (_e, id: string) => orchestrator.resetErrors(id))

  // Serial — enumerate host COM ports for the picker. Lazy-loads `serialport`
  // the same way SerialTransport does, so a missing/unbuilt native module
  // degrades to an empty list (and a log line) instead of throwing.
  ipcMain.handle(IPC.serialListPorts, async (): Promise<SerialPortInfo[]> => {
    try {
      type Sp = { SerialPort: { list(): Promise<SerialPortInfo[]> } }
      const mod = (await import('serialport')) as unknown as Sp & { default?: Sp }
      // Tolerate CJS↔ESM interop: the named export may sit under `.default` in
      // the packaged ESM build (see SqlLisRepository.getMssql for the same fix).
      const SerialPort = mod.SerialPort ?? mod.default?.SerialPort
      if (!SerialPort) throw new Error('serialport: SerialPort export not found')
      const ports = await SerialPort.list()
      return ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
        friendlyName: p.friendlyName,
        pnpId: p.pnpId
      }))
    } catch (err) {
      logger.error(
        'serial',
        `Could not list serial ports: ${(err as Error).message}. ` +
          `The 'serialport' native module may be missing for this platform.`
      )
      return []
    }
  })

  // Serial TX self-test. When an analyzer behaves as if it never hears us, this
  // answers the only question that matters next: can this PC drive the TX line at
  // all? The operator unplugs the analyzer and bridges pins 2-3; bytes that come
  // back prove the port + adapter are fine and move the fault to the cable or the
  // analyzer's own port. The instrument must be stopped first — a COM port has a
  // single owner, so an in-use port reports that rather than a false negative.
  ipcMain.handle(
    IPC.serialLoopbackTest,
    async (
      _e,
      opts: { path: string; baudRate?: number; dataBits?: number; parity?: string; stopBits?: number }
    ): Promise<SerialLoopbackResult> => {
      const fail = (message: string): SerialLoopbackResult => ({
        ok: false,
        echoed: false,
        sent: 0,
        received: 0,
        message
      })
      let SerialPortCtor: new (o: Record<string, unknown>) => {
        isOpen: boolean
        open(cb?: (e: Error | null) => void): void
        close(cb?: (e: Error | null) => void): void
        write(d: Buffer, cb?: (e?: Error | null) => void): boolean
        on(ev: string, cb: (...a: unknown[]) => void): unknown
        set?(o: Record<string, boolean>, cb?: (e: Error | null) => void): void
      }
      try {
        type Sp = { SerialPort: new (o: Record<string, unknown>) => never }
        const mod = (await import('serialport')) as unknown as Sp & { default?: Sp }
        SerialPortCtor = (mod.SerialPort ?? mod.default?.SerialPort) as never
        if (!SerialPortCtor) throw new Error('SerialPort export not found')
      } catch (err) {
        return fail(`Serial support unavailable: ${(err as Error).message}`)
      }

      const pattern = Buffer.from(`SYNAPSE-TX-TEST-${Date.now()}`, 'latin1')
      return await new Promise<SerialLoopbackResult>((resolve) => {
        let port: ReturnType<typeof Object> | null = null
        let received = Buffer.alloc(0)
        let settled = false
        const finish = (r: SerialLoopbackResult): void => {
          if (settled) return
          settled = true
          try {
            const p = port as { isOpen?: boolean; close?: (cb?: unknown) => void } | null
            if (p?.isOpen) p.close?.(() => undefined)
          } catch {
            /* closing is best-effort */
          }
          resolve(r)
        }
        try {
          const p = new SerialPortCtor({
            path: opts.path,
            baudRate: opts.baudRate ?? 9600,
            dataBits: opts.dataBits ?? 8,
            parity: opts.parity ?? 'none',
            stopBits: opts.stopBits ?? 1,
            autoOpen: false
          })
          port = p as never
          p.on('data', (chunk: unknown) => {
            received = Buffer.concat([received, chunk as Buffer])
            if (received.includes(pattern.subarray(0, pattern.length - 1))) {
              finish({
                ok: true,
                echoed: true,
                sent: pattern.length,
                received: received.length,
                message:
                  `TX works. ${opts.path} sent ${pattern.length} bytes and received them back, so ` +
                  `this PC's serial port and adapter drive the line correctly. If the analyzer still ` +
                  `reports a link timeout, the fault is in the cable or the analyzer's port — not here.`
              })
            }
          })
          p.on('error', (err: unknown) => finish(fail(`${opts.path}: ${(err as Error).message}`)))
          p.open((err) => {
            if (err) {
              const busy = /access denied|resource busy|cannot open/i.test(err.message)
              return finish(
                fail(
                  busy
                    ? `${opts.path} is in use. Stop the instrument that owns it, then run the test again.`
                    : `Could not open ${opts.path}: ${err.message}`
                )
              )
            }
            p.set?.({ dtr: true, rts: true })
            p.write(pattern, (werr) => {
              if (werr) finish(fail(`${opts.path}: write failed: ${werr.message}`))
            })
            setTimeout(
              () =>
                finish({
                  ok: true,
                  echoed: false,
                  sent: pattern.length,
                  received: received.length,
                  message:
                    `No echo on ${opts.path}. With pins 2-3 bridged this means the port is NOT ` +
                    `transmitting — replace the adapter/board. Without the jumper fitted this result ` +
                    `is expected and proves nothing, so refit it and retest.`
                }),
              3000
            )
          })
        } catch (err) {
          finish(fail(`${opts.path}: ${(err as Error).message}`))
        }
      })
    }
  )

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
  ipcMain.handle(IPC.mappingApplyPreset, (_e, driverId: string, presetKey: string) => {
    const preset = listPresets().find((p) => p.preset === presetKey)
    const inst = preset?.instruments.find((i) => i.driverId === driverId)
    const applied = inst?.mappings?.length
      ? orchestrator.mapping.applyPresetMappings(driverId, inst.mappings)
      : 0
    if (applied > 0) win.webContents.send(IPC_EVENT.mappingsChanged, orchestrator.mapping.list())
    return applied
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
    if (patch.launchAtStartup !== undefined) applyLoginItem(patch.launchAtStartup)
    if (patch.autoUpdateEnabled !== undefined || patch.updateInstallHour !== undefined) {
      updater.onSettingsChanged()
    }
    return next
  })

  // Over-the-air updates
  ipcMain.handle(IPC.updateGetStatus, () => updater.getStatus())
  ipcMain.handle(IPC.updateCheck, () => {
    updater.checkNow()
    return updater.getStatus()
  })
  ipcMain.handle(IPC.updateInstall, () => updater.installNow())

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

  // System / host info — the primary LAN IPv4 shown in the sidebar. Reuse the
  // scanner's interface enumeration (non-internal IPv4, physical adapters first)
  // and take the top candidate; null when the host has no usable LAN address.
  ipcMain.handle(IPC.systemLanIp, (): string | null => {
    // getSubnets() is ranked to lead with the instrument bench LAN (192.168.x.x)
    // over the internet uplink, so the first entry is the address analyzers should
    // be pointed at on a dual-NIC lab PC.
    const subnets = scanner.getSubnets()
    return subnets[0]?.address ?? null
  })

  // Persist fatal renderer errors (React error boundary / window onerror) to the
  // log file so an intermittent UI crash can be diagnosed after the fact.
  ipcMain.on(IPC.rendererError, (_e, message: string) => {
    logger.error('renderer', String(message).slice(0, 4000))
  })
}
