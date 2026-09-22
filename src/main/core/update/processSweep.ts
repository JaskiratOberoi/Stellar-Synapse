import { execFile, spawn } from 'node:child_process'
import { basename } from 'node:path'
import { app } from 'electron'
import { logger } from '../logger'

/**
 * Stray-process handling around the silent NSIS update.
 *
 * Why this exists: the installer replaces the app by renaming the install
 * folder, so EVERY `Stellar Synapse.exe` process must be gone first — not just
 * the main process that `quitAndInstall` exits. A renderer that is stuck in a
 * JavaScript loop never notices its parent died (renderers are unsandboxed
 * here, so nothing ties their lifetime to the main process), keeps its handles
 * on the install folder open, and the uninstall step aborts with
 * "Failed to uninstall old application files: 2". electron-builder's own
 * kill-the-running-app step did not clear such a process on a lab machine
 * across three attempts, so the app takes care of it before handing over.
 *
 * Everything here is Windows + packaged only; in dev the executable is
 * electron.exe and sweeping by image name would kill unrelated tools.
 */

interface ProcInfo {
  pid: number
  ppid: number
}

/** Image name to sweep, e.g. "Stellar Synapse.exe". */
function ownImageName(): string {
  return basename(process.execPath)
}

function sweepEnabled(): boolean {
  return process.platform === 'win32' && app.isPackaged
}

/**
 * List every process with our image name (pid + parent pid). Uses PowerShell
 * because Node has no parent-pid API and `wmic` is gone on current Windows 11.
 */
function listOwnImageProcesses(timeoutMs: number): Promise<ProcInfo[]> {
  const name = ownImageName().replace(/'/g, "''")
  const script =
    `Get-CimInstance Win32_Process -Filter "Name='${name}'" | ` +
    `ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }`
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          reject(err)
          return
        }
        const out: ProcInfo[] = []
        for (const line of stdout.split(/\r?\n/)) {
          const m = line.trim().match(/^(\d+)\s+(\d+)$/)
          if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]) })
        }
        resolve(out)
      }
    )
  })
}

/** PIDs in `procs` that descend from `root` (transitively), root excluded. */
function descendantsOf(root: number, procs: ProcInfo[]): Set<number> {
  const tree = new Set<number>([root])
  let grew = true
  while (grew) {
    grew = false
    for (const p of procs) {
      if (!tree.has(p.pid) && tree.has(p.ppid)) {
        tree.add(p.pid)
        grew = true
      }
    }
  }
  tree.delete(root)
  return tree
}

function terminate(pid: number): boolean {
  try {
    process.kill(pid, 'SIGKILL')
    return true
  } catch (err) {
    logger.warn('update', `Could not terminate stray process ${pid}: ${(err as Error).message}`)
    return false
  }
}

/**
 * Kill stray copies of our own executable.
 *
 * - `'orphans'`: processes that are NOT this process or one of its descendants
 *   — leftovers of a previous instance (typically a runaway renderer). Run at
 *   startup: such a process wastes RAM/CPU for days and blocks the next update.
 * - `'all-others'`: every process with our image name except this one, own
 *   children included. Run right before quit-to-install, because a hung child
 *   of THIS instance survives app.quit() just the same.
 *
 * Resolves with the number of processes terminated. Never throws; a failure to
 * enumerate is logged and, for `'all-others'`, falls back to `taskkill` by
 * image name so the install still gets its clean slate.
 */
export async function killStrayProcesses(scope: 'orphans' | 'all-others'): Promise<number> {
  if (!sweepEnabled()) return 0
  const self = process.pid
  let procs: ProcInfo[]
  try {
    procs = await listOwnImageProcesses(15_000)
  } catch (err) {
    logger.warn('update', `Stray-process enumeration failed: ${(err as Error).message}`)
    if (scope === 'all-others') return taskkillOthers()
    return 0
  }

  const keep = new Set<number>([self])
  if (scope === 'orphans') for (const pid of descendantsOf(self, procs)) keep.add(pid)

  let killed = 0
  for (const p of procs) {
    if (keep.has(p.pid)) continue
    logger.warn(
      'update',
      `Terminating stray ${ownImageName()} process ${p.pid} (parent ${p.ppid}, scope ${scope})`
    )
    if (terminate(p.pid)) killed += 1
  }
  if (killed > 0) logger.info('update', `Stray-process sweep (${scope}): terminated ${killed}`)
  return killed
}

/** Fallback for the pre-install sweep when PowerShell enumeration is unavailable. */
function taskkillOthers(): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'taskkill',
      ['/F', '/IM', ownImageName(), '/FI', `PID ne ${process.pid}`],
      { windowsHide: true, timeout: 15_000, encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          logger.warn('update', `taskkill fallback failed: ${(err as Error).message}`)
          resolve(0)
          return
        }
        const n = (stdout.match(/SUCCESS/g) ?? []).length
        logger.info('update', `Stray-process sweep (taskkill fallback): terminated ${n}`)
        resolve(n)
      }
    )
  })
}

/**
 * Bring the app back if the silent install does not.
 *
 * The installer relaunches the app itself on success (`--force-run`), but on
 * failure it parks on a modal error box and nothing restarts the tray service —
 * a failed 03:00 install left a lab without interfacing until someone noticed.
 * This detaches a hidden PowerShell that waits for this process to exit, then
 * for the installer to finish (bounded by `maxWaitMinutes`, so a modal box the
 * night shift never dismisses doesn't stall it), and starts the executable if
 * no copy is running by then. The single-instance lock makes a double start
 * harmless.
 */
export function armRelaunchWatchdog(maxWaitMinutes = 10): void {
  if (!sweepEnabled()) return
  const exe = process.execPath.replace(/'/g, "''")
  const appName = ownImageName()
    .replace(/\.exe$/i, '')
    .replace(/'/g, "''")
  const script = [
    `$deadline = (Get-Date).AddMinutes(${maxWaitMinutes})`,
    `while ((Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Seconds 1 }`,
    'Start-Sleep -Seconds 10',
    'while ((Get-Date) -lt $deadline) {',
    `  if (Get-Process -Name '${appName}' -ErrorAction SilentlyContinue) { exit 0 }`,
    `  if (-not (Get-Process | Where-Object { $_.Name -like 'Stellar-Synapse-Setup*' })) { break }`,
    '  Start-Sleep -Seconds 3',
    '}',
    'Start-Sleep -Seconds 5',
    `if (-not (Get-Process -Name '${appName}' -ErrorAction SilentlyContinue)) { Start-Process -FilePath '${exe}' }`
  ].join('; ')
  try {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-Command',
        script
      ],
      { detached: true, stdio: 'ignore', windowsHide: true }
    )
    child.unref()
    logger.info('update', `Relaunch watchdog armed (pid ${child.pid}, up to ${maxWaitMinutes} min)`)
  } catch (err) {
    logger.warn('update', `Could not arm relaunch watchdog: ${(err as Error).message}`)
  }
}
