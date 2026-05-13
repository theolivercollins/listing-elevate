/**
 * Duration enforcement for video assembly.
 *
 * The order form sells 15s / 30s / 60s tiers (persisted on
 * `properties.selected_duration` via migration 054). Today's pipeline
 * generates ~12 scenes × ~5s each = ~60s; 30s and 15s tiers were
 * silently rendered at 60s before this module landed.
 *
 * Strategy:
 *   • If sum(source) ≤ target — return as-is (the natural case for 60s).
 *   • Else — allocate target evenly across N scenes, capped per-clip at
 *     [MIN_CLIP_SECONDS, MAX_CLIP_SECONDS].
 *   • If even allocation drops below MIN (too many scenes for the budget),
 *     drop the lowest-priority scenes by highlight tier (see below) until
 *     allocation ≥ MIN. Walkthrough order is preserved within the surviving
 *     set so the home still flows correctly.
 *
 * Highlight tiers (used only when we must drop scenes for short durations):
 *   T1 always-keep:    aerial, exterior_front, living_room, kitchen,
 *                      master_bedroom, exterior_back
 *   T2 keep-if-room:   dining, bedroom, bathroom, pool, deck
 *   T3 filler:         foyer, powder_room, office, hallway, stairs, etc.
 *   T4 last-to-keep:   _uncategorized
 *
 * 15s tier with 12 scenes -> typically T1 set (6 scenes × 2.5s).
 * 30s tier with 12 scenes -> T1 + a few T2 (8–10 × 3.0–3.5s).
 * 60s tier with 12 scenes -> all 12 × 5s (no fitting).
 */

import type { RoomType } from "../types.js";

/** Minimum per-clip duration in the assembled video. Below this clips
 *  feel jarring and the audience can't register the room. */
export const MIN_CLIP_SECONDS = 2.5;

/** Maximum per-clip duration. Source clips above this are trimmed. */
export const MAX_CLIP_SECONDS = 5.0;

export interface FittableScene {
  scene_number: number;
  room_type: RoomType | null;
  /** Source video duration in seconds (clip as generated). */
  durationSeconds: number;
  /** Anything else the caller wants preserved through fitting. */
  [key: string]: unknown;
}

export interface FittedScene<T extends FittableScene> {
  scene: T;
  /** Allocated playback duration in the assembled video. */
  durationSeconds: number;
}

const TIER_1 = new Set<RoomType>([
  "aerial",
  "exterior_front",
  "living_room",
  "kitchen",
  "master_bedroom",
  "exterior_back",
]);
const TIER_2 = new Set<RoomType>([
  "dining",
  "bedroom",
  "bathroom",
  "pool",
  "deck",
]);
// Everything else falls into T3. _uncategorized (null / 'other') is T4.

function highlightTier(roomType: RoomType | null): 1 | 2 | 3 | 4 {
  if (roomType === null || roomType === "other") return 4;
  if (TIER_1.has(roomType)) return 1;
  if (TIER_2.has(roomType)) return 2;
  return 3;
}

/**
 * Fit a set of ordered scenes into a target duration.
 *
 * @param scenes  Walkthrough-ordered scenes (output of orderScenesForAssembly).
 * @param targetSeconds  Target final video duration. Pass null to skip fitting
 *                       (use natural sum of source durations).
 * @returns The kept scenes (walkthrough order preserved) with allocated
 *          per-clip durations. Total may be <= targetSeconds when source
 *          clips are too short to fill the budget.
 */
export function fitScenesToDuration<T extends FittableScene>(
  scenes: T[],
  targetSeconds: number | null,
): FittedScene<T>[] {
  if (scenes.length === 0) return [];

  // No target -> use natural source durations (legacy path).
  if (targetSeconds === null) {
    return scenes.map((s) => ({ scene: s, durationSeconds: s.durationSeconds }));
  }

  const naturalSum = scenes.reduce((s, x) => s + x.durationSeconds, 0);

  // Budget already fits within natural lengths -> keep everything, allocate
  // proportionally only if we need to TRIM. Otherwise return as-is.
  if (naturalSum <= targetSeconds) {
    return scenes.map((s) => ({ scene: s, durationSeconds: s.durationSeconds }));
  }

  // Drop scenes until even allocation across the surviving set is >= MIN.
  // Priority of dropping: highest tier number first; within a tier, drop
  // from the END of walkthrough order (so we preserve the opening arc).
  const surviving = [...scenes];
  const maxSceneCount = Math.floor(targetSeconds / MIN_CLIP_SECONDS);

  while (surviving.length > maxSceneCount) {
    // Find the lowest-priority surviving scene and drop it.
    let dropIdx = -1;
    let dropTier: 1 | 2 | 3 | 4 = 1;
    for (let i = surviving.length - 1; i >= 0; i--) {
      const t = highlightTier(surviving[i].room_type);
      if (t > dropTier) {
        dropTier = t;
        dropIdx = i;
      } else if (t === dropTier && dropIdx < 0) {
        dropIdx = i;
      }
    }
    if (dropIdx < 0) break; // Defensive — shouldn't happen.
    surviving.splice(dropIdx, 1);
  }

  // Allocate evenly. Cap each clip at min(MAX_CLIP_SECONDS, sourceDuration).
  const evenAllocation = targetSeconds / surviving.length;
  return surviving.map((scene) => ({
    scene,
    durationSeconds: Math.min(
      evenAllocation,
      MAX_CLIP_SECONDS,
      scene.durationSeconds,
    ),
  }));
}
