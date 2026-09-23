# Over-the-air updates

## How it works

- Each installed client periodically checks a **generic electron-updater feed
  served by the Stellar Infinity platform** for a newer version, downloads it in
  the background (differentially, via blockmaps), and installs it silently in
  the configured nightly window.
- The feed is three static files behind one base URL:
  `latest.yml`, `Stellar-Synapse-Setup-<version>.exe`, and its `.blockmap`,
  served by `GET /api/updates/synapse/{file}` on Infinity from a host directory
  mounted into the api container (`./updates/synapse`).
- Access is gated by a **shared fleet key** sent as the `X-Update-Key` header.
  The key is baked into every shipped build (`SYNAPSE_UPDATE_KEY` at build time)
  and verified by Infinity (`Updates__SynapseKey` in `api/.env`, constant-time
  compare). It grants nothing except installer downloads.

## One-time setup (done 2026-08-23)

1. Infinity serves the feed (`UpdateEndpoints.cs`); compose mounts
   `./updates:/updates:ro` into the api container; `Updates__SynapseKey` lives
   in Infinity's `api/.env`.
2. Synapse `.env` (gitignored, this repo) holds:

   ```
   SYNAPSE_UPDATE_URL=https://infinity-staging.genomicslab.in/api/updates/synapse
   SYNAPSE_UPDATE_KEY=<same value as Infinity's Updates__SynapseKey>
   ```

   Blank values build a dormant updater (dev builds never check).

## Cutting a release

1. Bump `version` in `package.json` — clients only ever move to a HIGHER version.
2. `npm run build:win` — bakes the feed URL + key from `.env` and emits
   `installer/latest.yml`, the exe, and the blockmap.
3. `node scripts/publish-release.mjs` — copies the three artifacts into
   `X:\Stellar-Infinity\updates\synapse`. That IS the deploy: no restart, no
   upload step. Keep older versions' files in place (differential updates fetch
   the previous blockmap; without it labs fall back to a full download).
4. Watch the fleet converge on the new version in Infinity's Interfacing tab
   (each site reports `agentVersion` with every heartbeat).

## Permanent download link (first installs)

The current installer is always at

```
https://infinity.genomicslab.in/api/downloads/synapse/latest
```

The browser asks for a password (any user name; the password is
`Updates__DownloadPassword` in Infinity's gitignored `api/.env`, shared by the
live and staging stacks — ask the admin, it is not written down here). Infinity
reads `path:` out of the published `latest.yml` on every request and streams
that exe under its real name (`Stellar-Synapse-Setup-<version>.exe`), so the
link never changes and follows every `publish-release.mjs` run with no further
step. Only the installer is reachable this way; `latest.yml` and the blockmaps
stay behind the fleet key, so the updater's own path is untouched. Served by
`UpdateEndpoints.cs` in Stellar-Infinity (added 2026-09-23; the staging
hostname serves the same link).

## Rotating the key

Change `Updates__SynapseKey` in Infinity's `api/.env`, redeploy the api
container, change `SYNAPSE_UPDATE_KEY` in this repo's `.env`, rebuild, publish.
Old installs keep their old key and will fail feed checks until they are
updated manually once — rotate only if the key is believed leaked.

## Notes

- The updater stays dormant when: dev build, `.env` unset at build time, or the
  operator turned auto-update off in Settings.
- Install window: downloaded updates install at the configured nightly hour
  (Settings), quitting and relaunching the tray app silently.
- Before quitting into the installer (0.6.5+), the app terminates every other
  `Stellar Synapse.exe` process, own children included. The NSIS installer
  swaps the install folder by renaming it, so a single leftover process — a
  renderer stuck in a JS loop outlives `app.quit()` and its dead parent — makes
  the uninstall step abort with "Failed to uninstall old application files: 2"
  and leaves the app down. electron-builder's own kill-the-running-app check
  did not clear such a process on a lab machine, hence the in-app sweep
  (`src/main/core/update/processSweep.ts`). The same sweep runs at startup for
  orphans of a previous instance, and a detached watchdog relaunches the app
  if the silent install fails instead of relaunching it.
- Clients on 0.2.x (built against the never-configured GitHub feed) cannot
  self-update; each lab needs one manual install of 0.3.0+, after which OTA is
  automatic.
