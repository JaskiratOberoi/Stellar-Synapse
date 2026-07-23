/**
 * Auto-update feed configuration.
 *
 * Values are baked in at build time from the environment / a gitignored .env
 * (SYNAPSE_UPDATE_*, see electron.vite.config.ts and docs/auto-update.md). The
 * releases repo is PRIVATE, so the client ships a read-only token — this is a
 * deliberate trade-off so unattended lab PCs update with zero per-machine setup.
 * Keep the token fine-grained (single repo, read-only Contents) and rotate it by
 * editing .env and rebuilding.
 */

export interface UpdateFeedConfig {
  owner: string
  repo: string
  token: string
}

export const updateFeed: UpdateFeedConfig = {
  owner: __UPDATE_OWNER__,
  repo: __UPDATE_REPO__,
  token: __UPDATE_TOKEN__
}

/**
 * True only when a real feed was baked in. Dev builds and installers built
 * without a configured .env leave these blank, and the updater stays dormant
 * rather than spamming errors against a non-existent repo.
 */
export function isUpdateFeedConfigured(): boolean {
  return updateFeed.owner.length > 0 && updateFeed.repo.length > 0 && updateFeed.token.length > 0
}
