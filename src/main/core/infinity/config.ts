/**
 * Stellar Infinity cloud configuration, baked at build time.
 *
 * Every install reports to the same Infinity, and every install proves it is
 * a Synapse we shipped with the same fleet key the auto-updater already
 * carries (SYNAPSE_UPDATE_KEY). That key is what lets an install ENROL
 * itself — ask Infinity for its own per-site credential on first launch —
 * instead of an operator minting a key in the Interfacing tab and pasting it
 * into the lab PC. The per-site key Infinity hands back is what the reports
 * are then signed with; the fleet key never carries a report.
 *
 * SYNAPSE_INFINITY_URL names the platform (defaults to the origin of the
 * update feed, so a build with only the feed configured still enrols). See
 * electron.vite.config.ts and docs/auto-update.md.
 */
import { updateFeed } from '../update/config'

export interface InfinityCloudConfig {
  /** Base URL of the platform, e.g. https://infinity.genomicslab.in */
  baseUrl: string
  /** Shared fleet key, sent as X-Update-Key when enrolling. */
  fleetKey: string
}

export const infinityCloud: InfinityCloudConfig = {
  baseUrl: __INFINITY_URL__.trim().replace(/\/+$/, ''),
  fleetKey: updateFeed.key
}

/**
 * True only when a real platform was baked in. Dev builds and installers built
 * without a configured .env leave these blank, and enrolment stays dormant —
 * a manually configured site code and key still work either way.
 */
export function isCloudConfigured(): boolean {
  return infinityCloud.baseUrl.length > 0 && infinityCloud.fleetKey.length > 0
}
