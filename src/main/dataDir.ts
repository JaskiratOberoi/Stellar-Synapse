import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const STORE_FILE = 'stellar-synapse.json'

/**
 * Read a custom data directory from HKCU\Software\Stellar Synapse\DataDir.
 * Returns null in dev or when unset.
 */
function readConfiguredDataDir(): string | null {
  if (process.platform !== 'win32') return null
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Stellar Synapse', '/v', 'DataDir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const m = out.match(/DataDir\s+REG_SZ\s+(.+)/i)
    const dir = m?.[1]?.trim()
    return dir && dir.length > 0 ? dir : null
  } catch {
    return null
  }
}

/** True if `dir` is inside the app's install folder (which upgrades wipe). */
function isUnderInstallDir(dir: string): boolean {
  try {
    const installDir = resolve(dirname(process.execPath)).toLowerCase()
    return resolve(dir).toLowerCase().startsWith(installDir)
  } catch {
    return false
  }
}

/**
 * Decide where all Synapse files (electron-store config, offline queue, logs)
 * live, and point Electron's userData there before the store is opened.
 *
 * IMPORTANT: data must NOT live inside the install directory — electron-builder
 * wipes the install folder on every upgrade, which would reset all instruments
 * and settings. So:
 *   - A custom DataDir is honored ONLY if it's a stable folder OUTSIDE the
 *     install dir (e.g. D:\StellarSynapse). That survives upgrades/downgrades.
 *   - Otherwise we use Electron's default userData (%APPDATA%\stellar-synapse),
 *     which installers never touch — the stable default.
 *
 * Earlier builds wrongly pointed DataDir at <install>\Data. If we detect that,
 * we ignore it and (best-effort) salvage the old store file into the stable
 * location so the upgrade doesn't look like a fresh install.
 *
 * Returns the resolved log directory.
 */
export function applyDataDir(): string {
  const configured = readConfiguredDataDir()

  if (configured && !isUnderInstallDir(configured)) {
    // Deliberate, stable custom location (e.g. a non-C: data drive).
    try {
      if (!existsSync(configured)) mkdirSync(configured, { recursive: true })
      app.setPath('userData', configured)
    } catch {
      // fall through to default userData
    }
  } else if (configured && isUnderInstallDir(configured)) {
    // Legacy/broken: data was kept inside the install dir. Use the stable
    // default instead, and rescue the old config if it's still around.
    const oldFile = join(configured, STORE_FILE)
    const newFile = join(app.getPath('userData'), STORE_FILE)
    if (existsSync(oldFile) && !existsSync(newFile)) {
      try {
        mkdirSync(dirname(newFile), { recursive: true })
        copyFileSync(oldFile, newFile)
      } catch {
        // best effort — if it fails the app just starts with defaults
      }
    }
  }

  const logDir = join(app.getPath('userData'), 'logs')
  try {
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  } catch {
    // ignore — logger simply skips file output if the dir is unavailable
  }
  return logDir
}
