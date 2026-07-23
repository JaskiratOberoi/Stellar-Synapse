import { EventEmitter } from 'node:events'
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'
import { logger } from '../logger'
import { persist } from '../../store'
import type { UpdateStatus, UpdateState } from '../../../shared/types'
import { isUpdateFeedConfigured, updateFeed } from './config'

// electron-updater is CommonJS; in the packaged ESM build a named import
// (`import { autoUpdater }`) fails to resolve. Default-import then destructure —
// the same CJS↔ESM interop pattern used for mssql/serialport elsewhere.
const { autoUpdater } = electronUpdater

/** How soon after launch the first update check runs (let the app settle first). */
const INITIAL_CHECK_DELAY_MS = 60_000
/** Recurring background check cadence. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Over-the-air updater for the unattended lab deployments.
 *
 * Flow: check on a timer -> download in the background -> once downloaded, wait
 * for the configured nightly window, then quit + install + relaunch silently.
 * The app runs as a background tray service and rarely quits on its own, so we
 * schedule the install explicitly rather than relying on install-on-quit.
 *
 * Emits 'status' (UpdateStatus) on every state change so the renderer can show
 * progress. Stays completely dormant in dev or when no feed token was baked in.
 */
export class AutoUpdater extends EventEmitter {
  private status: UpdateStatus
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private installTimer: ReturnType<typeof setTimeout> | null = null
  /** Set true before quitAndInstall so the window's close-to-tray handler yields. */
  private readonly beforeInstall: () => void
  private started = false

  constructor(beforeInstall: () => void) {
    super()
    this.beforeInstall = beforeInstall
    this.status = { currentVersion: app.getVersion(), state: 'idle' }
  }

  /** Current status snapshot (for the IPC get handler). */
  getStatus(): UpdateStatus {
    return { ...this.status }
  }

  /**
   * Begin background checks. Safe to call once at startup. No-ops (with a log
   * line) in dev, when the feed isn't configured, or when the user disabled it.
   */
  start(): void {
    if (this.started) return

    if (!app.isPackaged) {
      logger.info('update', 'Auto-update disabled in dev build')
      this.patch({ state: 'disabled' })
      return
    }
    if (!isUpdateFeedConfigured()) {
      logger.warn(
        'update',
        'Auto-update feed not configured (SYNAPSE_UPDATE_* unset at build) — updates disabled'
      )
      this.patch({ state: 'disabled' })
      return
    }

    this.configureUpdater()
    this.started = true

    if (!persist.getSettings().autoUpdateEnabled) {
      logger.info('update', 'Auto-update turned off in settings')
      this.patch({ state: 'disabled' })
      return
    }

    logger.info('update', `Auto-update armed (feed: ${updateFeed.owner}/${updateFeed.repo})`)
    setTimeout(() => this.checkNow(), INITIAL_CHECK_DELAY_MS)
    this.checkTimer = setInterval(() => {
      if (persist.getSettings().autoUpdateEnabled) this.checkNow()
    }, CHECK_INTERVAL_MS)
  }

  /** One-time wiring of electron-updater (feed URL, flags, logger, events). */
  private configureUpdater(): void {
    autoUpdater.autoDownload = true
    // We control WHEN the install happens (nightly window), not electron-updater.
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    // Bridge electron-updater's logging into our persistent file logger.
    autoUpdater.logger = {
      info: (m: unknown) => logger.info('update', String(m)),
      warn: (m: unknown) => logger.warn('update', String(m)),
      error: (m: unknown) => logger.error('update', String(m)),
      debug: (m: unknown) => logger.debug('update', String(m))
    }
    // Private GitHub repo: supply the read token at runtime rather than baking it
    // into app-update.yml. Overrides the (tokenless) publish config in the package.
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: updateFeed.owner,
      repo: updateFeed.repo,
      private: true,
      token: updateFeed.token
    })

    autoUpdater.on('checking-for-update', () => this.patch({ state: 'checking' }))
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      logger.info('update', `Update available: ${info.version} (downloading)`)
      this.patch({ state: 'available', availableVersion: info.version, error: undefined })
    })
    autoUpdater.on('update-not-available', () => {
      this.patch({ state: 'not-available', lastCheckedAt: new Date().toISOString() })
    })
    autoUpdater.on('download-progress', (p: { percent: number }) => {
      this.patch({ state: 'downloading', progressPercent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      logger.info('update', `Update ${info.version} downloaded — scheduling install`)
      this.patch({
        state: 'downloaded',
        availableVersion: info.version,
        progressPercent: 100,
        lastCheckedAt: new Date().toISOString()
      })
      this.scheduleInstall()
    })
    autoUpdater.on('error', (err: Error) => {
      logger.error('update', `Updater error: ${err?.message ?? String(err)}`)
      this.patch({ state: 'error', error: err?.message ?? String(err) })
    })
  }

  /** Trigger a check now (background timer, or the UI's "Check for updates"). */
  checkNow(): void {
    if (!this.started) return
    autoUpdater.checkForUpdates().catch((err: Error) => {
      logger.error('update', `Check failed: ${err?.message ?? String(err)}`)
      this.patch({ state: 'error', error: err?.message ?? String(err) })
    })
  }

  /**
   * Schedule the downloaded update to install at the configured local hour. If
   * that hour already passed today, it installs at the next occurrence (tomorrow).
   */
  private scheduleInstall(): void {
    if (this.installTimer) clearTimeout(this.installTimer)

    const hour = clampHour(persist.getSettings().updateInstallHour)
    const now = new Date()
    const next = new Date(now)
    next.setHours(hour, 0, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)

    const delay = next.getTime() - now.getTime()
    this.patch({ pendingInstallAt: next.toISOString() })
    logger.info('update', `Update install scheduled for ${next.toLocaleString()}`)
    this.installTimer = setTimeout(() => this.installNow(), delay)
  }

  /**
   * Quit and install the downloaded update, then relaunch. Sets the quitting
   * flag first so the main window's close-to-tray handler doesn't cancel the
   * quit. Only valid once an update has been downloaded.
   */
  installNow(): void {
    if (this.status.state !== 'downloaded') {
      logger.warn('update', 'installNow called with no update downloaded — ignored')
      return
    }
    if (this.installTimer) {
      clearTimeout(this.installTimer)
      this.installTimer = null
    }
    logger.info('update', 'Installing update and relaunching')
    try {
      this.beforeInstall()
      // isSilent=true (no NSIS UI), isForceRunAfter=true (relaunch after install).
      autoUpdater.quitAndInstall(true, true)
    } catch (err) {
      logger.error('update', `quitAndInstall failed: ${(err as Error).message}`)
      this.patch({ state: 'error', error: (err as Error).message })
    }
  }

  /**
   * React to a settings change (auto-update toggle / install hour). Called from
   * the settings IPC handler. Re-arms checks when enabled, reschedules a pending
   * install when the hour changes, and pauses checks when disabled.
   */
  onSettingsChanged(): void {
    if (!this.started) {
      // Was dormant (dev / unconfigured / disabled at boot). Attempt a fresh
      // start so toggling it on takes effect without an app restart.
      this.start()
      return
    }
    const enabled = persist.getSettings().autoUpdateEnabled
    if (enabled && this.status.state === 'disabled') this.patch({ state: 'idle' })
    if (!enabled) this.patch({ state: 'disabled' })
    // If an update is already staged, honor a changed install hour.
    if (this.status.state === 'downloaded') this.scheduleInstall()
  }

  private patch(next: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...next }
    this.emit('status', this.getStatus())
  }
}

function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 3
  return Math.min(23, Math.max(0, Math.trunc(h)))
}
