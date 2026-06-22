import { app } from 'electron'
import { logger } from './core/logger'

/**
 * Sync the OS "run at user login" item with the desired state.
 *
 * Registers the packaged executable to start at login with a `--hidden` flag so
 * Stellar Synapse boots straight to the system tray (interfacing resumes) without
 * popping the UI in the user's face. No-op in dev, where `process.execPath` is
 * electron.exe and registering it would just litter the user's startup list.
 */
export function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged) {
    logger.info('app', `Launch-at-startup ${enabled ? 'enabled' : 'disabled'} (skipped in dev)`)
    return
  }
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: ['--hidden']
  })
  logger.info('app', `Launch-at-startup ${enabled ? 'enabled' : 'disabled'}`)
}

/** True when this process was launched by the login item (start hidden to tray). */
export function startedHidden(): boolean {
  return process.argv.includes('--hidden')
}
