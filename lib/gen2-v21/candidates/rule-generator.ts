import { randomUUID } from "node:crypto";
import type {
  PairCandidate,
  PhotoSceneFacts,
  PropertySceneGraph,
} from "../types.js";
import { bearingCompatible } from "./bearing-compat.js";
import { findSharedPortal } from "./portal-gate.js";

const DEFAULT_ROOM_CONFIDENCE_GATE =
  parseFloat(process.env["GEN2_V21_ROOM_CONFIDENCE_GATE"] ?? "0.97");

const MAX_CANDIDATES = 100;

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

function isWideOrMedium(photo: PhotoSceneFacts): boolean {
  return photo.shot_type === "wide" || photo.shot_type === "medium";
}

function isDetailOrClose(photo: PhotoSceneFacts): boolean {
  return photo.shot_type === "detail" || photo.shot_type === "close";
}

export interface GenerateCandidatesOptions {
  roomConfidenceGate?: number;
}

export function generateCandidates(
  graph: PropertySceneGraph,
  opts: GenerateCandidatesOptions = {},
): PairCandidate[] {
  const gate = opts.roomConfidenceGate ?? DEFAULT_ROOM_CONFIDENCE_GATE;

  // Filter photos below confidence gate — they route to single-image fall-through
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

      // ---- aerial_to_entry ----
      if (
        pa.shot_type === "aerial" &&
        exteriorPhotoIds.has(pa.photo_id) &&
        exteriorPhotoIds.has(pb.photo_id) &&
        exteriorTypeMap.get(pb.photo_id) === "front"
      ) {
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
        continue;
      }

      // Swap check: pb is aerial, pa is front entry
      if (
        pb.shot_type === "aerial" &&
        exteriorPhotoIds.has(pb.photo_id) &&
        exteriorPhotoIds.has(pa.photo_id) &&
        exteriorTypeMap.get(pa.photo_id) === "front"
      ) {
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
        continue;
      }

      // ---- exterior_walkaround ----
      if (
        exteriorPhotoIds.has(pa.photo_id) &&
        exteriorPhotoIds.has(pb.photo_id) &&
        exteriorTypeMap.get(pa.photo_id) !== exteriorTypeMap.get(pb.photo_id)
      ) {
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
        continue;
      }

      // ---- walkthrough_via_portal ----
      const sharedPortal = findSharedPortal(pa, pb);
      if (sharedPortal !== null && pa.room_id !== pb.room_id) {
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
        continue;
      }

      // Interior-only rules below: skip if either photo is an exterior shot
      if (exteriorPhotoIds.has(pa.photo_id) || exteriorPhotoIds.has(pb.photo_id)) {
        continue;
      }

      // ---- wide_to_detail ----
      // Check before same_room_different_angle so wide+detail pairs with focal overlap
      // get the more specific classification.
      if (
        pa.room_id === pb.room_id &&
        ((isWideOrMedium(pa) && isDetailOrClose(pb)) ||
          (isDetailOrClose(pa) && isWideOrMedium(pb)))
      ) {
        const overlap = focalSubjectOverlap(pa, pb);
        if (overlap > 0) {
          const raA = SHOT_TYPE_RANK[pa.shot_type] ?? 2;
          const raB = SHOT_TYPE_RANK[pb.shot_type] ?? 2;
          const zoomDeltaNorm = clamp(Math.abs(raA - raB) / 4);
          const score = clamp(overlap * 0.5 + zoomDeltaNorm * 0.5);
          candidates.push({
            candidate_id: randomUUID(),
            listing_id: graph.listing_id,
            photo_a_id: pa.photo_id,
            photo_b_id: pb.photo_id,
            candidate_type: "wide_to_detail",
            heuristic_score: score,
            reasoning:
              `Wide/medium + detail/close in same room (${pa.room_id}). ` +
              `focal_subject_overlap=${overlap.toFixed(2)}, zoom_delta_norm=${zoomDeltaNorm.toFixed(2)}. ` +
              `Score=${score.toFixed(3)}.`,
            portal_id: null,
          });
          continue;
        }
      }

      // ---- same_room_different_angle ----
      if (pa.room_id === pb.room_id && bCompat > 0.4) {
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
            `Same room (${pa.room_id}), bearing compat=${bCompat.toFixed(2)} > 0.4. ` +
            `Shot types: ${pa.shot_type} + ${pb.shot_type} (delta=${stDelta}). Score=${score.toFixed(3)}.`,
          portal_id: null,
        });
        continue;
      }
    }
  }

  // Sort descending by heuristic_score, cap at MAX_CANDIDATES
  candidates.sort((a, b) => b.heuristic_score - a.heuristic_score);
  return candidates.slice(0, MAX_CANDIDATES);
}
