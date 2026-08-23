// Publish the current installer build to the Infinity-hosted OTA feed.
//
// The feed is just three files behind /api/updates/synapse (see
// docs/auto-update.md). Publishing is a copy into the directory the Infinity
// api container serves; nothing restarts. Older versions' exe/blockmap are
// deliberately left in place — differential updates fetch the PREVIOUS
// blockmap from the feed, and removing it silently degrades every lab to a
// full 80 MB download.
//
// Usage: node scripts/publish-release.mjs
// Env:   SYNAPSE_PUBLISH_DIR overrides the target directory.

import { copyFileSync, existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

const target = process.env.SYNAPSE_PUBLISH_DIR ?? 'X:/Stellar-Infinity/updates/synapse'
const installerDir = resolve('installer')

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
const files = [
  `Stellar-Synapse-Setup-${pkg.version}.exe`,
  `Stellar-Synapse-Setup-${pkg.version}.exe.blockmap`,
  'latest.yml'
]

if (!existsSync(target)) {
  console.error(`[publish] target directory not found: ${target}`)
  process.exit(1)
}

for (const f of files) {
  const src = join(installerDir, f)
  if (!existsSync(src)) {
    console.error(`[publish] missing artifact: ${src} — run the installer build first`)
    process.exit(1)
  }
}

// latest.yml last: a client that polls mid-publish must never see a manifest
// pointing at files that are not fully there yet.
for (const f of files) {
  copyFileSync(join(installerDir, f), join(target, f))
  console.log(`[publish] -> ${join(target, f)}`)
}
console.log(`[publish] v${pkg.version} live on the feed.`)
