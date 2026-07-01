/**
 * Shared assembly-completeness guard math.
 *
 * Extracted from api/cron/poll-scenes.ts so lib/pipeline.ts (rerunAssembly)
 * and the cron poller share one definition instead of drifting copies.
 * api/cron/poll-scenes.ts re-exports `passingThreshold` from here so its
 * existing import path (and the test that imports it from '../poll-scenes.js')
 * keeps working unchanged.
 */

/**
 * passingThreshold — minimum number of qc_pass scenes required for a property
 * to proceed to assembly (rather than being flagged needs_review).
 *
 * Uses ceil(totalScenes * 0.8) so short videos (e.g. 4-scene 15s clips) are
 * not wrongly penalised by a hardcoded scene count that was tuned for longer
 * videos. Examples: 4 scenes → 4, 5 scenes → 4, 6 scenes → 5, 8 scenes → 7.
 *
 * Pure; no I/O.
 */
export function passingThreshold(totalScenes: number): number {
  return Math.ceil(totalScenes * 0.8);
}
