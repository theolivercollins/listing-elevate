import type { PickerFeatures, PickerPrediction } from "../types.js";

/**
 * Cold-start heuristic scorer.
 * Used when label count < 10 (before the ML model has enough data to train).
 *
 * Rule:
 *   score = 0.5 * same_room
 *         + 0.3 * is_open_path_flag
 *         + 0.2 * bearing_compatibility_score
 *
 * Confidence is always 0.5 — heuristic is never confident.
 */
export function heuristicScore(features: PickerFeatures): PickerPrediction {
  const w_same_room = 0.5;
  const w_is_open_path = 0.3;
  const w_bearing = 0.2;

  const contrib_same_room = w_same_room * features.same_room;
  const contrib_open_path = w_is_open_path * features.is_open_path_flag;
  const contrib_bearing = w_bearing * features.bearing_compatibility_score;

  const score = contrib_same_room + contrib_open_path + contrib_bearing;

  return {
    score: Math.min(1, Math.max(0, score)),
    confidence: 0.5,
    top_3_features: [
      { name: "same_room", weight: contrib_same_room },
      { name: "is_open_path_flag", weight: contrib_open_path },
      { name: "bearing_compatibility_score", weight: contrib_bearing },
    ],
    model_version: "heuristic-v1",
    used_fallback_heuristic: true,
  };
}
