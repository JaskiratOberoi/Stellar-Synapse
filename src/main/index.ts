import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { Orchestrator } from './core/engine/Orchestrator'
import { Simulator } from './core/simulator/Simulator'
import { LisRouter } from './core/lis/LisRouter'
import { registerIpc } from './ipc'
import { persist } from './store'
import { logger } from './core/logger'
import { applyDataDir } from './dataDir'
import { LD560_POLL } from './core/connection/InstrumentPollScheduler'
import { LD560_LIS_ANALYTES } from '../shared/ld560Transmit'

const isDev = !app.isPackaged

// Point all Synapse files (config, offline queue, logs) at the data directory
// chosen at install time (possibly a non-C: drive) BEFORE the store is opened,
// and turn on persistent file logging there.
logger.initFile(applyDataDir())

/** Display label for the HPLC HbA1c analyzer (Landwind LD-560 OEM, branded Zeus D-20). */
const LD560_NAME = 'Zeus D-20 HPLC'

/** Default LD-560 connection — analyzer is "Server TCP" on its LAN IP. Synapse dials in. */
const LD560_CONNECTION = {
  transport: 'tcp-client' as const,
  host: '192.168.1.109',
  port: 8081,
  hostQuery: false,
  ...LD560_POLL
}

/** Idempotently ensure the LD-560 instrument exists and uses client transport. */
function ensureLd560(): void {
  const existing = persist.getInstruments()
  const idx = existing.findIndex((i) => i.driverId === 'landwind-ld-560')

  if (idx >= 0) {
    const current = existing[idx]!
    const hasPollCommands = (current.connection.pollCommands?.length ?? 0) > 0
    const hasOldPoll =
      current.connection.pollCommands?.some((c) => /TRANSMIT|SEND|REQ|GET/.test(c)) ?? false
    const pollOutOfSync =
      current.connection.pollIntervalMs !== LD560_POLL.pollIntervalMs ||
      JSON.stringify(current.connection.pollCommands ?? []) !==
        JSON.stringify(LD560_POLL.pollCommands)
    const needsRename = current.name !== LD560_NAME && /landwind|ld-560|hematology/i.test(current.name)
    const needsUpdate =
      needsRename ||
      current.connection.transport === 'tcp-server' ||
      hasOldPoll ||
      pollOutOfSync
    if (needsUpdate) {
      const next = [...existing]
      next[idx] = {
        ...current,
        name: needsRename ? LD560_NAME : current.name,
        connection: {
          ...current.connection,
          ...LD560_CONNECTION,
          host: current.connection.host ?? LD560_CONNECTION.host,
          port: current.connection.port ?? LD560_CONNECTION.port
        }
      }
      persist.setInstruments(next)
      logger.info('app', 'Updated Landwind LD-560: ENQ poll on 192.168.1.109:8081')
    }
    return
  }

  const now = new Date().toISOString()
  persist.setInstruments([
    ...existing,
    {
      id: 'seed-ld-560',
      name: LD560_NAME,
      driverId: 'landwind-ld-560',
      protocol: 'simple',
      connection: { ...LD560_CONNECTION },
      enabled: true,
      createdAt: now
    }
  ])
  logger.info('app', 'Added Landwind LD-560 instrument (tcp-client -> 192.168.1.109:8081)')
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#0b1020',
    title: 'Stellar Synapse',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  ensureLd560()

  const lis = new LisRouter()
  const orchestrator = new Orchestrator(lis)
  const simulator = new Simulator(orchestrator)

  // Open the window and wire IPC FIRST so the UI always loads — even if the
  // Noble LIS is unreachable. Instrument data is still received and queued, then
  // flushed to the LIS automatically when it comes back online.
  const win = createWindow()
  registerIpc(win, { orchestrator, simulator, lis })

  orchestrator
    .init()
    .then(() => {
      // Only HbA1c is propagated to the Noble LIS; keep all other LD-560 analytes
      // (eAG, S-A1c, ...) in Synapse but never write them to the LIS.
      orchestrator.mapping.restrictLisScope('landwind-ld-560', LD560_LIS_ANALYTES)
      if (persist.getLis().live) {
        return orchestrator.mapping.autoMap('landwind-ld-560').then(() => undefined)
      }
      return undefined
    })
    .catch((err) =>
      logger.error('app', `Startup init error (UI still available): ${(err as Error).message}`)
    )

  // Synthetic data only when explicitly enabled in Settings (off by default).
  if (persist.getSettings().simulatorEnabled) {
    simulator.start(persist.getSettings().simulatorRate)
  }

  logger.info('app', 'Stellar Synapse middleware started')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
