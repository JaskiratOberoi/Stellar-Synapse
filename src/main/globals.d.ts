/**
 * Build-time constants injected by electron.vite.config.ts (`define`).
 *
 * The auto-update feed points at a PRIVATE GitHub releases repo, so the client
 * needs a read token baked in. It is injected from the environment / a
 * gitignored .env at build time and never committed — see docs/auto-update.md.
 * All three are empty strings in dev / unconfigured builds, in which case the
 * auto-updater stays dormant.
 */
declare const __APP_VERSION__: string
declare const __UPDATE_OWNER__: string
declare const __UPDATE_REPO__: string
declare const __UPDATE_TOKEN__: string
