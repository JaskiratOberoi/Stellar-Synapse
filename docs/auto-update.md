# Over-the-air updates

Stellar Synapse updates itself over the air so the instances running across the
different lab sites stay current without anyone reinstalling them by hand.

## How it works

- Each installed client periodically checks a **private GitHub releases repo** for a
  newer version (first check ~1 min after launch, then every 6 hours).
- A newer version downloads **in the background** (`electron-updater`, differential
  where possible via the `.blockmap`).
- Once downloaded, the update is **installed + relaunched automatically** during the
  nightly window configured in **Settings → Software Updates** (default **03:00 local**).
  The app runs as a background tray service and rarely quits on its own, so the install
  is scheduled explicitly rather than waiting for a manual quit.
- A lab tech can also **Check now** / **Restart & install** immediately from
  Settings → Software Updates.

Implementation: [`src/main/core/update/`](../src/main/core/update) (`AutoUpdater.ts`,
`config.ts`), wired in [`src/main/index.ts`](../src/main/index.ts).

## One-time setup

1. **Create a dedicated releases repo** (e.g. `your-org/stellar-synapse-releases`).
   Keep it separate from the source repo. It can be private.
2. **Create a fine-grained personal access token** scoped to **only that repo**, with
   **read-only "Contents"** permission. This token is embedded in the shipped client so
   every lab PC can pull releases — keep its scope minimal.
   > ⚠️ The token is extractable from the installed app. Never grant it more than
   > read access to the single releases repo, and rotate it (edit `.env`, rebuild,
   > ship) if it is ever exposed.
3. **Configure the build.** Copy `.env.example` to `.env` (gitignored) and fill in:
   ```
   SYNAPSE_UPDATE_OWNER=your-org
   SYNAPSE_UPDATE_REPO=stellar-synapse-releases
   SYNAPSE_UPDATE_TOKEN=github_pat_...   # read-only Contents on the releases repo
   ```
4. **Match `electron-builder.yml`.** Set `publish.owner` / `publish.repo` to the same
   `owner` / `repo`.

If `.env` is absent (or values are blank), the updater stays **dormant** — the app runs
normally and simply never checks for updates. This is the case for dev builds.

## Cutting a release

1. Bump the version (must be **higher** than what clients run — SemVer):
   ```
   npm version patch   # or edit "version" in package.json
   ```
2. Build the installer **and its update manifest**:
   ```
   npm run build:win
   ```
   This produces, in `installer/`:
   - `Stellar-Synapse-Setup-<version>.exe`
   - `Stellar-Synapse-Setup-<version>.exe.blockmap`
   - `latest.yml`  ← the update manifest clients read
3. **Publish to the releases repo.** Either:
   - **Automatic:** set a write-scoped `GH_TOKEN` and run
     `node scripts/build-installer.mjs --publish` (uploads all three artifacts to a
     GitHub release for the tag), **or**
   - **Manual:** create a GitHub release in the releases repo tagged `v<version>` and
     upload **all three** files above (the `.exe`, its `.blockmap`, and `latest.yml`).

   > All three artifacts must be on the release. Missing `latest.yml` or the
   > `.blockmap` breaks the update check / differential download.

Within a few hours (or on next launch) every client sees the new `latest.yml`,
downloads in the background, and installs overnight.

## Notes & caveats

- **Unsigned installer.** The build is currently unsigned, so Windows signature
  verification is effectively off; the private-repo token + HTTPS feed are the
  safeguards against a tampered update. When an Authenticode certificate is available,
  add `win.certificateFile` / signing to `electron-builder.yml` — no updater code
  changes are needed, and updates become signature-verified end-to-end.
- **Per-user install / no elevation** (`perMachine: false`, `allowElevation: false`)
  means the silent install runs without a UAC prompt — exactly what unattended lab PCs
  need.
- **Data is safe across updates.** Config, offline queue, and logs live in the user
  data dir (outside the install folder), so updates never reset instruments or settings.
- **Security-agent asar lock.** On the lab machine a security agent memory-locks
  `app.asar`. The install runs *after* the app has quit, so the running process holds no
  lock — but verify the first over-the-air update end-to-end on one site before rolling
  it out everywhere.
