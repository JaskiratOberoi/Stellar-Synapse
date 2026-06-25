import { app, shell, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import { join } from 'node:path'
import { Orchestrator } from './core/engine/Orchestrator'
import { Simulator } from './core/simulator/Simulator'
import { LisRouter } from './core/lis/LisRouter'
import { registerIpc } from './ipc'
import { persist } from './store'
import { logger } from './core/logger'
import { applyDataDir } from './dataDir'
import { applyLoginItem, startedHidden } from './autostart'
import { LD560_POLL } from './core/connection/InstrumentPollScheduler'
import { LD560_LIS_ANALYTES } from '../shared/ld560Transmit'

const isDev = !app.isPackaged

// Tray + window lifecycle state. The app runs as a background service: closing
// the window hides it to the tray (interfacing keeps running); it only truly
// exits via the tray's "Quit" item (which sets `isQuitting`).
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
/** First close-to-tray shows a one-time hint so the user knows it's still alive. */
let trayHintShown = false

/** Resolve the tray icon path (packaged: extraResources; dev: build/ source). */
function trayIconImage(): Electron.NativeImage {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')
  const img = nativeImage.createFromPath(iconPath)
  // Tray glyphs are tiny; downscale so the 512px app icon isn't rendered huge.
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16 })
}

/** Bring the main window back from the tray (restore + focus). */
function showMainWindow(): void {
  if (!mainWindow) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Create the tray icon + right-click menu (Open / Quit). */
function createTray(): void {
  if (tray) return
  tray = new Tray(trayIconImage())
  tray.setToolTip('Stellar Synapse — interfacing running')
  const menu = Menu.buildFromTemplate([
    { label: 'Open Stellar Synapse', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: 'Quit Stellar Synapse',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  // Left-click / double-click restores the UI (Windows convention).
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

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

  // When launched at login (--hidden), stay in the tray and don't show the UI.
  win.on('ready-to-show', () => {
    if (!startedHidden()) win.show()
  })
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Close-to-tray: the 'X' button hides the window instead of quitting, so
  // instrument interfacing keeps running. A real exit goes through the tray's
  // "Quit" (or app.quit()), which sets `isQuitting` first.
  win.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    win.hide()
    if (!trayHintShown && tray) {
      trayHintShown = true
      tray.displayBalloon?.({
        title: 'Stellar Synapse is still running',
        content:
          'Interfacing continues in the background. Right-click the tray icon and choose Quit to stop it.'
      })
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Single-instance lock: as a background service the app must not run twice (two
// processes would fight over serial ports / the LIS). A second launch hands off
// to the primary (its 'second-instance' handler surfaces the existing window)
// and exits — WITHOUT ever creating a window of its own.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => showMainWindow())
app.on('before-quit', () => {
  isQuitting = true
})

app.whenReady().then(() => {
  // Losing instance: app.quit() was already called above, but whenReady can still
  // fire before the async quit completes. Bail BEFORE createWindow — otherwise the
  // dying second instance pops a blank, half-loaded window (and the close-to-tray
  // close handler then snags its teardown), which is exactly the blank-screen bug.
  if (!gotSingleInstanceLock) return

  ensureLd560()

  // Reconcile the OS login item with the saved preference each launch.
  applyLoginItem(persist.getSettings().launchAtStartup)

  const lis = new LisRouter()
  const orchestrator = new Orchestrator(lis)
  const simulator = new Simulator(orchestrator)

  // Open the window and wire IPC FIRST so the UI always loads — even if the
  // Noble LIS is unreachable. Instrument data is still received and queued, then
  // flushed to the LIS automatically when it comes back online.
  const win = createWindow()
  mainWindow = win
  createTray()
  registerIpc(win, { orchestrator, simulator, lis })

  orchestrator
    .init()
    .then(() => {
      // HbA1c (measured) and the Synapse-calculated eAG are propagated to Noble;
      // every other LD-560 analyte (including the instrument's own eAG) stays in
      // Synapse only. migrate… re-enables the eAG rule on installs that had it
      // locked to HbA1c-only before restrictLisScope re-applies the scope.
      orchestrator.mapping.migrateLd560EnableEag()
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

  app.on('activate', () => showMainWindow())
})

app.on('window-all-closed', () => {
  // Close-to-tray hides the window rather than destroying it, so this normally
  // never fires. It only fires during a real quit (tray → Quit), where exiting
  // is exactly what we want. macOS apps conventionally stay alive.
  if (isQuitting && process.platform !== 'darwin') app.quit()
})
