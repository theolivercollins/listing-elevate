/**
 * Operator delivery stage machine — pure, no I/O.
 * Stage values are the migration-080 CHECK constraint, verbatim.
 * All transitions are single forward steps; retries re-run a stage's
 * side effect without moving the pointer (handled in runs.ts).
 */

export const DELIVERY_STAGES = [
  'intake', 'scraping', 'photo_selection', 'generating', 'judging', 'checkpoint_a',
  'details', 'voiceover', 'music', 'assembling', 'checkpoint_b', 'delivered',
] as const;

export type DeliveryStage = (typeof DELIVERY_STAGES)[number];

export function isDeliveryStage(s: string): s is DeliveryStage {
  return (DELIVERY_STAGES as readonly string[]).includes(s);
}

export function stageIndex(s: DeliveryStage): number {
  return DELIVERY_STAGES.indexOf(s);
}

export function nextStage(s: DeliveryStage): DeliveryStage | null {
  const i = stageIndex(s);
  return i >= 0 && i < DELIVERY_STAGES.length - 1 ? DELIVERY_STAGES[i + 1] : null;
}

/** True only for the single legal forward step from `from`. */
export function canAdvance(from: DeliveryStage, to: DeliveryStage): boolean {
  return nextStage(from) === to;
}

/** The stage immediately before `s`, or null if `s` is the first stage. */
export function prevStage(s: DeliveryStage): DeliveryStage | null {
  const i = stageIndex(s);
  return i > 0 ? DELIVERY_STAGES[i - 1] : null;
}

/**
 * True when `to` is strictly before `from` in the stage sequence.
 * This is the backward-only gate for revertRun — forward paths must keep using canAdvance.
 */
export function canRevert(from: DeliveryStage, to: DeliveryStage): boolean {
  return stageIndex(to) >= 0 && stageIndex(to) < stageIndex(from);
}
