/**
 * V2-V21 pair candidate generator — threshold changelog
 * -------------------------------------------------------
 * 2026-05-26  LOOSENED per operator feedback ("only 2 scenes got pairs"):
 *   - walkthrough_via_portal: portal confidence gate lowered 0.6 → 0.4 (in portal-gate.ts)
 *   - same_room_different_angle: bearing_compatibility threshold lowered 0.4 → 0.2
 *   - wide_to_detail: now also matches wide+close and medium+detail; OR same-room fallback
 *     when focal_subject overlap = 0 (was: required overlap > 0)
 *   - room_confidence gate for candidate generation: 0.97 → 0.70
 *     (V1 single-image fall-through gate remains strict at 0.97)
 *   - MAX_CANDIDATES: 100 → 200
 *   - NEW: same_room_fallback (score 0.3) — emitted for same-room pairs that matched
 *     NO other candidate type; gives operator something to label for every room
 *   - Pairs can now appear in MULTIPLE categories (removed early `continue`s);
 *     all matching candidates are emitted and sorted by score.
 *
 * IMPORTANT: future threshold tightening must reference labeled operator data,
 * not gut feel. Do not revert these changes without a data justification.
 */

import { randomUUID } from "node:crypto";
import type {
  PairCandidate,
  PhotoSceneFacts,
  PropertySceneGraph,
} from "../types.js";
import { bearingCompatible } from "./bearing-compat.js";
import { findSharedPortal } from "./portal-gate.js";

const DEFAULT_ROOM_CONFIDENCE_GATE =
  parseFloat(process.env["GEN2_V21_ROOM_CONFIDENCE_GATE"] ?? "0.70");

const MAX_CANDIDATES = 200;

// Ordered shot_type zoom levels (lower index = wider)
const SHOT_TYPE_RANK: Record<string, number> = {
  aerial: 0,
  wide: 1,
  medium: 2,
  close: 3,
  detail: 4,
};

function shotTypeDelta(a: PhotoSceneFacts, b: PhotoSceneFacts): number {
  const ra = SHOT_TYPE_RANK[a.shot_type] ?? 2;
  const rb = SHOT_TYPE_RANK[b.shot_type] ?? 2;
  return Math.abs(ra - rb);
}

function focalSubjectOverlap(a: PhotoSceneFacts, b: PhotoSceneFacts): number {
  if (!a.focal_subject || !b.focal_subject) return 0;
  const tokA = new Set(a.focal_subject.toLowerCase().split(/\W+/).filter(Boolean));
  const tokB = new Set(b.focal_subject.toLowerCase().split(/\W+/).filter(Boolean));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let shared = 0;
  for (const t of tokA) {
    if (tokB.has(t)) shared++;
  }
  return shared / Math.max(tokA.size, tokB.size);
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function isWide(photo: PhotoSceneFacts): boolean {
  return photo.shot_type === "wide";
}

function isMedium(photo: PhotoSceneFacts): boolean {
  return photo.shot_type === "medium";
}

function isDetailOrClose(photo: PhotoSceneFacts): boolean {
  return photo.shot_type === "detail" || photo.shot_type === "close";
}

/**
 * Returns true if the pair qualifies as wide_to_detail:
 *   - (wide + detail), (wide + close), or (medium + detail)
 *   - AND: focal_subject overlap > 0 OR same room (new: same-room fallback)
 */
function isWideToDetailPair(
  pa: PhotoSceneFacts,
  pb: PhotoSceneFacts,
): boolean {
  const aWideDetail =
    (isWide(pa) && isDetailOrClose(pb)) ||
    (isDetailOrClose(pa) && isWide(pb));
  const aMediumDetail =
    (isMedium(pa) && pb.shot_type === "detail") ||
    (pa.shot_type === "detail" && isMedium(pb));
  return aWideDetail || aMediumDetail;
}

export interface GenerateCandidatesOptions {
  roomConfidenceGate?: number;
}

export function generateCandidates(
  graph: PropertySceneGraph,
  opts: GenerateCandidatesOptions = {},
): PairCandidate[] {
  const gate = opts.roomConfidenceGate ?? DEFAULT_ROOM_CONFIDENCE_GATE;

  // Filter photos below confidence gate — photos below 0.70 route to single-image fall-through.
  // NOTE: single-image fall-through retains its own strict gate (0.97); this gate is
  // intentionally lower to surface more operator-labelable candidates.
  const eligible = graph.photos.filter((p) => p.room_confidence >= gate);

  const exteriorPhotoIds = new Set(graph.exterior_shots.map((e) => e.photo_id));
  const exteriorTypeMap = new Map(
    graph.exterior_shots.map((e) => [e.photo_id, e.type]),
  );

  const candidates: PairCandidate[] = [];

  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];

      // Enforce a.id < b.id ordering by photo_id string comparison
      const [pa, pb] = a.photo_id < b.photo_id ? [a, b] : [b, a];

      const bCompat = bearingCompatible(pa.camera_bearing_vector, pb.camera_bearing_vector);

      // Track whether this pair matched any typed candidate
      let matchedTyped = false;

      // ---- aerial_to_entry ----
      const paIsAerial =
        pa.shot_type === "aerial" &&
        exteriorPhotoIds.has(pa.photo_id) &&
        exteriorPhotoIds.has(pb.photo_id) &&
        exteriorTypeMap.get(pb.photo_id) === "front";
      const pbIsAerial =
        pb.shot_type === "aerial" &&
        exteriorPhotoIds.has(pb.photo_id) &&
        exteriorPhotoIds.has(pa.photo_id) &&
        exteriorTypeMap.get(pa.photo_id) === "front";

      if (paIsAerial) {
        matchedTyped = true;
        candidates.push({
          candidate_id: randomUUID(),
          listing_id: graph.listing_id,
          photo_a_id: pa.photo_id,
          photo_b_id: pb.photo_id,
          candidate_type: "aerial_to_entry",
          heuristic_score: 0.85,
          reasoning:
            `Aerial shot (${pa.photo_id}) paired with front-entry exterior shot (${pb.photo_id}); ` +
            `high prior for cinematic descent-to-entry transition.`,
          portal_id: null,
        });
      } else if (pbIsAerial) {
        matchedTyped = true;
        candidates.push({
          candidate_id: randomUUID(),
          listing_id: graph.listing_id,
          photo_a_id: pa.photo_id,
          photo_b_id: pb.photo_id,
          candidate_type: "aerial_to_entry",
          heuristic_score: 0.85,
          reasoning:
            `Aerial shot (${pb.photo_id}) paired with front-entry exterior shot (${pa.photo_id}); ` +
            `high prior for cinematic descent-to-entry transition.`,
          portal_id: null,
        });
      }

      // ---- exterior_walkaround ----
      if (
        exteriorPhotoIds.has(pa.photo_id) &&
        exteriorPhotoIds.has(pb.photo_id) &&
        exteriorTypeMap.get(pa.photo_id) !== exteriorTypeMap.get(pb.photo_id) &&
        !paIsAerial && !pbIsAerial
      ) {
        matchedTyped = true;
        const typeA = exteriorTypeMap.get(pa.photo_id) ?? "unknown";
        const typeB = exteriorTypeMap.get(pb.photo_id) ?? "unknown";
        candidates.push({
          candidate_id: randomUUID(),
          listing_id: graph.listing_id,
          photo_a_id: pa.photo_id,
          photo_b_id: pb.photo_id,
          candidate_type: "exterior_walkaround",
          heuristic_score: 0.7,
          reasoning:
            `Both exterior shots with different types (${typeA} vs ${typeB}); ` +
            `walkaround pair following front_orientation rotation.`,
          portal_id: null,
        });
      }

      // ---- walkthrough_via_portal ----
      // (portal confidence gate is now 0.4 in portal-gate.ts)
      const sharedPortal = findSharedPortal(pa, pb);
      if (sharedPortal !== null && pa.room_id !== pb.room_id) {
        matchedTyped = true;
        const score = clamp(sharedPortal.confidence * 0.7 + bCompat * 0.3);
        candidates.push({
          candidate_id: randomUUID(),
          listing_id: graph.listing_id,
          photo_a_id: pa.photo_id,
          photo_b_id: pb.photo_id,
          candidate_type: "walkthrough_via_portal",
          heuristic_score: score,
          reasoning:
            `Portal ${sharedPortal.portal_id} connects ${pa.room_id} ↔ ${pb.room_id} ` +
            `(confidence=${sharedPortal.confidence.toFixed(2)}, is_open_path=true). ` +
            `Bearing compat=${bCompat.toFixed(2)}. Score=${score.toFixed(3)}.`,
          portal_id: sharedPortal.portal_id,
        });
      }

      // Interior-only rules below: skip if either photo is an exterior shot
      if (exteriorPhotoIds.has(pa.photo_id) || exteriorPhotoIds.has(pb.photo_id)) {
        continue;
      }

      // ---- wide_to_detail ----
      // Shot-type pairs: wide+detail, wide+close, medium+detail.
      // Qualifies when focal_subject overlap > 0 OR same room.
      if (isWideToDetailPair(pa, pb)) {
        const overlap = focalSubjectOverlap(pa, pb);
        const sameRoom = pa.room_id === pb.room_id;
        if (overlap > 0 || sameRoom) {
          matchedTyped = true;
          const raA = SHOT_TYPE_RANK[pa.shot_type] ?? 2;
          const raB = SHOT_TYPE_RANK[pb.shot_type] ?? 2;
          const zoomDeltaNorm = clamp(Math.abs(raA - raB) / 4);
          // If no focal overlap, score anchored to zoom delta alone
          const score = overlap > 0
            ? clamp(overlap * 0.5 + zoomDeltaNorm * 0.5)
            : clamp(zoomDeltaNorm * 0.5);
          candidates.push({
            candidate_id: randomUUID(),
            listing_id: graph.listing_id,
            photo_a_id: pa.photo_id,
            photo_b_id: pb.photo_id,
            candidate_type: "wide_to_detail",
            heuristic_score: score,
            reasoning:
              `Wide/medium + detail/close (${pa.shot_type} + ${pb.shot_type}). ` +
              `focal_subject_overlap=${overlap.toFixed(2)}, same_room=${sameRoom}, ` +
              `zoom_delta_norm=${zoomDeltaNorm.toFixed(2)}. Score=${score.toFixed(3)}.`,
            portal_id: null,
          });
        }
      }

      // ---- same_room_different_angle ----
      // Threshold lowered from > 0.4 to > 0.2 to surface mildly compatible pairs.
      if (pa.room_id === pb.room_id && bCompat > 0.2) {
        matchedTyped = true;
        const stDelta = shotTypeDelta(pa, pb);
        const stScore = 1 - stDelta / 4;
        const score = clamp(bCompat * 0.6 + stScore * 0.4);
        candidates.push({
          candidate_id: randomUUID(),
          listing_id: graph.listing_id,
          photo_a_id: pa.photo_id,
          photo_b_id: pb.photo_id,
          candidate_type: "same_room_different_angle",
          heuristic_score: score,
          reasoning:
            `Same room (${pa.room_id}), bearing compat=${bCompat.toFixed(2)} > 0.2. ` +
            `Shot types: ${pa.shot_type} + ${pb.shot_type} (delta=${stDelta}). Score=${score.toFixed(3)}.`,
          portal_id: null,
        });
      }

      // ---- same_room_fallback ----
      // Safety net: if two same-room photos passed the confidence gate but matched
      // no typed candidate, emit a low-score candidate so the operator has something
      // to label for every room. "Let the operator decide."
      if (pa.room_id === pb.room_id && !matchedTyped) {
        candidates.push({
          candidate_id: randomUUID(),
          listing_id: graph.listing_id,
          photo_a_id: pa.photo_id,
          photo_b_id: pb.photo_id,
          candidate_type: "same_room_fallback",
          heuristic_score: 0.3,
          reasoning:
            `Same room (${pa.room_id}) but no typed rule matched ` +
            `(bearing_compat=${bCompat.toFixed(2)}, shot_types=${pa.shot_type}+${pb.shot_type}). ` +
            `Emitted as fallback for operator labeling.`,
          portal_id: null,
        });
      }
    }
  }

  // Sort descending by heuristic_score, cap at MAX_CANDIDATES
  candidates.sort((a, b) => b.heuristic_score - a.heuristic_score);
  return candidates.slice(0, MAX_CANDIDATES);
}
