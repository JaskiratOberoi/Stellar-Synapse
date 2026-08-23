/**
 * Auto-update feed configuration.
 *
 * The feed is served by the Stellar Infinity platform (a generic electron-updater
 * feed: latest.yml + installer + blockmap behind one URL), gated by a shared
 * fleet key sent as a request header. Both values are baked in at build time
 * from the environment / a gitignored .env (SYNAPSE_UPDATE_URL /
 * SYNAPSE_UPDATE_KEY, see electron.vite.config.ts and docs/auto-update.md).
 *
 * The key is embedded in the shipped app so unattended lab PCs update with zero
 * per-machine setup — it only grants download access to installers, and is
 * rotated by editing both .env files (Synapse + Infinity) and rebuilding.
 */

export interface UpdateFeedConfig {
  /** Base URL of the feed, e.g. https://infinity-staging.genomicslab.in/api/updates/synapse */
  url: string
  /** Shared fleet key, sent as X-Update-Key on every feed request. */
  key: string
}

export const updateFeed: UpdateFeedConfig = {
  url: __UPDATE_URL__,
  key: __UPDATE_KEY__
}

/**
 * True only when a real feed was baked in. Dev builds and installers built
 * without a configured .env leave these blank, and the updater stays dormant
 * rather than spamming errors against a non-existent endpoint.
 */
export function isUpdateFeedConfigured(): boolean {
  return updateFeed.url.length > 0 && updateFeed.key.length > 0
}
