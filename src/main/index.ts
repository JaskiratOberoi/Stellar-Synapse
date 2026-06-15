import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { Orchestrator } from './core/engine/Orchestrator'
import { Simulator } from './core/simulator/Simulator'
import { MockLisRepository } from './core/lis/MockLisRepository'
import { registerIpc } from './ipc'
import { persist } from './store'
import { logger } from './core/logger'
import type { InstrumentDefinition } from '../shared/types'

const isDev = !app.isPackaged

/** Idempotently ensure the LD-560 instrument exists in the store. */
function ensureLd560(): void {
  const existing = persist.getInstruments()
  if (existing.some((i) => i.driverId === 'landwind-ld-560')) return
  const now = new Date().toISOString()
  persist.setInstruments([
    ...existing,
    {
      id: 'seed-ld-560',
      name: 'Landwind LD-560 - Hematology',
      driverId: 'landwind-ld-560',
      protocol: 'simple',
      connection: { transport: 'tcp-server', host: '0.0.0.0', port: 8081, hostQuery: false },
      enabled: true,
      createdAt: now
    }
  ])
  logger.info('app', 'Added Landwind LD-560 instrument (port 8081, Simple protocol)')
}

/** On first run, seed a couple of instruments so the UI is immediately alive. */
function seedDefaultInstruments(): void {
  if (persist.getInstruments().length > 0) return
  const now = new Date().toISOString()
  const seed: InstrumentDefinition[] = [
    {
      id: 'seed-maglumi-x3',
      name: 'Maglumi X3 - Immunoassay',
      driverId: 'maglumi-x3',
      protocol: 'astm',
      connection: { transport: 'tcp-server', host: '0.0.0.0', port: 9100, hostQuery: true },
      enabled: true,
      createdAt: now
    },
    {
      id: 'seed-dxh-500',
      name: 'Beckman DxH 500 - Hematology',
      driverId: 'beckman-coulter',
      protocol: 'astm',
      connection: { transport: 'tcp-server', host: '0.0.0.0', port: 9102, hostQuery: false },
      enabled: true,
      createdAt: now
    },
    {
      id: 'seed-magicl-6000',
      name: 'MAGICL 6000 - Cardiac',
      driverId: 'magicl-6000',
      protocol: 'astm',
      connection: { transport: 'tcp-server', host: '0.0.0.0', port: 9101, hostQuery: false },
      enabled: false,
      createdAt: now
    }
  ]
  persist.setInstruments(seed)
  logger.info('app', 'Seeded default instruments for first run')
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

app.whenReady().then(async () => {
  seedDefaultInstruments()
  ensureLd560()

  const lis = new MockLisRepository()
  const orchestrator = new Orchestrator(lis)
  const simulator = new Simulator(orchestrator)

  await orchestrator.init()

  const win = createWindow()
  registerIpc(win, { orchestrator, simulator, lis })

  // Kick off the simulator if enabled in settings.
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
