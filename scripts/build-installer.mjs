// Build the Windows installer into a single stable folder: <project>/installer/
//
// Why this exists: this machine's security agent memory-locks every app.asar on
// the drive right after it's written, so electron-builder can't clear/reuse a
// previous output dir (it can neither delete nor rename the locked
// win-unpacked/app.asar). Reusing one output folder therefore fails on the
// second build. To work around it we package into a FRESH temp dir each time
// (no lock to clear) and copy only the installer .exe (which is not locked) into
// the stable installer/ folder. The locked win-unpacked is left in the OS temp
// dir, which Windows cleans up later.

import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = process.cwd()
const outDir = join(root, 'installer')
const tmp = join(tmpdir(), `synapse-build-${Date.now()}`)

// `--publish` uploads the release to GitHub (needs GH_TOKEN with write access to
// the releases repo). Without it we only build locally into installer/, and the
// artifacts can be uploaded to a GitHub release manually. The auto-update feed
// coords come from electron-builder.yml / .env — see docs/auto-update.md.
const doPublish = process.argv.includes('--publish')

console.log('[installer] building app (typecheck + electron-vite)...')
execSync('npm run build', { stdio: 'inherit' })

console.log(`[installer] packaging into temp dir: ${tmp}${doPublish ? ' (will publish)' : ''}`)
// Force --x64: the build host may be an arm64 Mac, but the target lab PC is
// Intel/AMD Windows (win32-x64). serialport ships an ABI-stable N-API prebuilt
// for win32-x64, so no cross-compilation is needed — electron-builder downloads
// the win32-x64 Electron and packages the prebuilt binding as-is.
execSync(
  `npx electron-builder --win --x64 --config electron-builder.yml ` +
    `--publish ${doPublish ? 'always' : 'never'} -c.directories.output="${tmp}"`,
  { stdio: 'inherit' }
)

mkdirSync(outDir, { recursive: true })
// Copy the installer .exe (+ .blockmap for differential downloads) AND latest.yml
// — the update manifest electron-updater reads. All three must be attached to the
// GitHub release for over-the-air updates to work.
const artifacts = readdirSync(tmp).filter(
  (f) => /^Stellar-Synapse-Setup-.*\.exe(\.blockmap)?$/.test(f) || f === 'latest.yml'
)
if (!artifacts.some((f) => f.endsWith('.exe'))) {
  console.error('[installer] ERROR: no installer artifact produced in temp dir')
  process.exit(1)
}
if (!artifacts.includes('latest.yml')) {
  console.warn('[installer] WARNING: latest.yml not produced — auto-update manifest missing')
}
for (const f of artifacts) {
  copyFileSync(join(tmp, f), join(outDir, f))
  console.log(`[installer] -> installer/${f}`)
}

// Best-effort: remove the temp build dir. win-unpacked/app.asar may be locked by
// the security agent — that's fine, the OS temp dir is cleaned up eventually.
try {
  rmSync(tmp, { recursive: true, force: true })
} catch {
  console.log(`[installer] note: temp build dir left for OS cleanup (locked): ${tmp}`)
}

console.log(`[installer] done -> ${join(outDir, artifacts.find((f) => f.endsWith('.exe')) ?? '')}`)
