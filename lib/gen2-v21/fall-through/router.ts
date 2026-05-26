import type { PhotoSceneFacts, PairCandidate, PickerPrediction } from "../types.js";

const DEFAULT_ROOM_CONFIDENCE_GATE = 0.97;

function resolveGate(opts?: { roomConfidenceGate?: number }): number {
  if (opts?.roomConfidenceGate !== undefined) return opts.roomConfidenceGate;
  const envVal = process.env.GEN2_V21_ROOM_CONFIDENCE_GATE;
  if (envVal !== undefined) {
    const parsed = parseFloat(envVal);
    if (!isNaN(parsed)) return parsed;
  }
  return DEFAULT_ROOM_CONFIDENCE_GATE;
}

export function routePhoto(
  photo: PhotoSceneFacts,
  candidates: PairCandidate[],
  pickerScore: PickerPrediction | null,
  opts?: { roomConfidenceGate?: number },
): "v21_pair" | "v1_single_image" {
  const gate = resolveGate(opts);
  if (photo.room_confidence < gate) return "v1_single_image";
  if (candidates.length === 0) return "v1_single_image";
  if (pickerScore && pickerScore.score < 0.5) return "v1_single_image";
  return "v21_pair";
}
