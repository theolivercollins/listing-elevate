import type { PropertySceneGraph, PairCandidate, PickerPrediction } from "../types.js";
import { routePhoto } from "./router.js";

export interface BulkRouterResult {
  v21Pairs: Array<{
    photo_a_id: string;
    photo_b_id: string;
    candidate_id: string;
    score: number;
  }>;
  v1SinglePhotos: Array<{
    photo_id: string;
    reason: "low_confidence" | "no_candidates" | "low_picker_score";
  }>;
}

/** Determine fall-through reason for a photo without re-running full routePhoto logic. */
function fallThroughReason(
  roomConfidence: number,
  hasCandidates: boolean,
  bestScore: number | null,
  gate: number,
): "low_confidence" | "no_candidates" | "low_picker_score" | null {
  if (roomConfidence < gate) return "low_confidence";
  if (!hasCandidates) return "no_candidates";
  if (bestScore !== null && bestScore < 0.5) return "low_picker_score";
  return null;
}

/**
 * Route every photo in a property's scene graph to either v21_pair or v1_single_image.
 *
 * For photos that qualify for v21_pair, the best-scoring candidate is selected.
 * A photo can appear in at most one pair (the highest-scoring one that passes the gate).
 *
 * @param graph       Full PropertySceneGraph for the property
 * @param candidates  All PairCandidates for this property
 * @param picker      Scorer function (heuristic fallback or LightGBM model), or null for no picker
 * @param opts        Optional gate override (same as routePhoto)
 */
export function routePropertyPhotos(
  graph: PropertySceneGraph,
  candidates: PairCandidate[],
  picker: { score: (c: PairCandidate) => PickerPrediction } | null,
  opts?: { roomConfidenceGate?: number },
): BulkRouterResult {
  const v21Pairs: BulkRouterResult["v21Pairs"] = [];
  const v1SinglePhotos: BulkRouterResult["v1SinglePhotos"] = [];

  // Build a map of photo_id → candidates that include this photo
  const candidatesByPhoto = new Map<string, PairCandidate[]>();
  for (const c of candidates) {
    for (const id of [c.photo_a_id, c.photo_b_id]) {
      const existing = candidatesByPhoto.get(id);
      if (existing) {
        existing.push(c);
      } else {
        candidatesByPhoto.set(id, [c]);
      }
    }
  }

  // Resolve the gate once so it's consistent across all photos
  const gateEnv = process.env.GEN2_V21_ROOM_CONFIDENCE_GATE;
  const gate =
    opts?.roomConfidenceGate !== undefined
      ? opts.roomConfidenceGate
      : gateEnv !== undefined && !isNaN(parseFloat(gateEnv))
        ? parseFloat(gateEnv)
        : 0.97;

  // Track which photos have already been committed to a v21 pair so we don't double-assign
  const usedInPair = new Set<string>();

  // Score all candidates upfront so we can pick the best per photo
  type ScoredCandidate = { candidate: PairCandidate; prediction: PickerPrediction | null };
  const scored: ScoredCandidate[] = candidates.map((c) => ({
    candidate: c,
    prediction: picker ? picker.score(c) : null,
  }));

  // Sort candidates by picker score descending (heuristic_score as tiebreaker)
  scored.sort((a, b) => {
    const sa = a.prediction?.score ?? a.candidate.heuristic_score;
    const sb = b.prediction?.score ?? b.candidate.heuristic_score;
    return sb - sa;
  });

  // Greedily assign the best candidate per photo
  for (const { candidate, prediction } of scored) {
    const { photo_a_id, photo_b_id } = candidate;
    if (usedInPair.has(photo_a_id) || usedInPair.has(photo_b_id)) continue;

    // Both photos must have their facts available to gate them
    const photoA = graph.photos.find((p) => p.photo_id === photo_a_id);
    const photoB = graph.photos.find((p) => p.photo_id === photo_b_id);
    if (!photoA || !photoB) continue;

    const routeA = routePhoto(photoA, [candidate], prediction, opts);
    const routeB = routePhoto(photoB, [candidate], prediction, opts);

    if (routeA === "v21_pair" && routeB === "v21_pair") {
      v21Pairs.push({
        photo_a_id,
        photo_b_id,
        candidate_id: candidate.candidate_id,
        score: prediction?.score ?? candidate.heuristic_score,
      });
      usedInPair.add(photo_a_id);
      usedInPair.add(photo_b_id);
    }
  }

  // Any photo not assigned to a pair falls through to v1_single_image
  for (const photo of graph.photos) {
    if (usedInPair.has(photo.photo_id)) continue;

    const photoCandidates = candidatesByPhoto.get(photo.photo_id) ?? [];
    const hasCandidates = photoCandidates.length > 0;

    // Find best picker score for this photo's candidates
    let bestScore: number | null = null;
    for (const c of photoCandidates) {
      const prediction = picker ? picker.score(c) : null;
      const s = prediction?.score ?? null;
      if (s !== null && (bestScore === null || s > bestScore)) bestScore = s;
    }

    const reason = fallThroughReason(photo.room_confidence, hasCandidates, bestScore, gate);
    v1SinglePhotos.push({
      photo_id: photo.photo_id,
      reason: reason ?? "no_candidates",
    });
  }

  return { v21Pairs, v1SinglePhotos };
}
