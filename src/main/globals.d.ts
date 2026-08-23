/**
 * Build-time constants injected by electron.vite.config.ts (`define`).
 *
 * The auto-update feed is served by the Stellar Infinity platform behind a
 * shared fleet key. Both values are injected from the environment / a
 * gitignored .env at build time and never committed — see docs/auto-update.md.
 * Both are empty strings in dev / unconfigured builds, in which case the
 * auto-updater stays dormant.
 */
declare const __APP_VERSION__: string
declare const __UPDATE_URL__: string
declare const __UPDATE_KEY__: string
