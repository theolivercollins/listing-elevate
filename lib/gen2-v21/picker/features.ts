import type {
  PairCandidate,
  PhotoSceneFacts,
  PickerFeatures,
  ShotType,
} from "../types.js";

// Shot type numeric order for delta calculation (wider = lower index)
const SHOT_ORDER: Record<ShotType, number> = {
  aerial: 0,
  wide: 1,
  medium: 2,
  close: 3,
  detail: 4,
};

/**
 * Computes portal_distance:
 * - 0 if same_room_different_angle / wide_to_detail (same physical space)
 * - 1 if walkthrough_via_portal (one portal hop)
 * - 2 if reachable via two portals (aerial_to_entry as a proxy heuristic)
 * - 999 otherwise (unreachable / exterior_walkaround)
 *
 * For walkthrough_via_portal we verify the shared portal exists in photoA's
 * visible_portals; if not found we still return 1 (the candidate type asserts it).
 */
function computePortalDistance(
  candidate: PairCandidate,
  photoA: PhotoSceneFacts,
  photoB: PhotoSceneFacts,
): number {
  const { candidate_type, portal_id } = candidate;

  switch (candidate_type) {
    case "same_room_different_angle":
    case "wide_to_detail":
      return 0;

    case "walkthrough_via_portal": {
      // Confirm the portal actually appears in one of the photos
      const hasPortal =
        photoA.visible_portals.some((p) => p.portal_id === portal_id) ||
        photoB.visible_portals.some((p) => p.portal_id === portal_id);
      return hasPortal ? 1 : 1; // still 1 even if not confirmed — type asserts it
    }

    case "aerial_to_entry":
      // Aerial shot → front door → interior: two logical hops
      return 2;

    case "exterior_walkaround":
      return 999;

    default:
      return 999;
  }
}

/**
 * Computes portal_centeredness: how centered the linking portal is in photoA.
 * Returns 0..1 where 1.0 = portal centered at (0.5, 0.5) of the frame.
 * If no portal or not a walkthrough type, returns 0.5 (neutral).
 */
function computePortalCenteredness(
  candidate: PairCandidate,
  photoA: PhotoSceneFacts,
): number {
  if (
    candidate.candidate_type !== "walkthrough_via_portal" ||
    !candidate.portal_id
  ) {
    return 0.5;
  }

  const portal = photoA.visible_portals.find(
    (p) => p.portal_id === candidate.portal_id,
  );
  if (!portal) return 0.5;

  const cx = portal.screen_position.x;
  const cy = portal.screen_position.y;
  // Distance from center (0.5, 0.5); max possible ~0.707
  const dist = Math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2);
  // Normalize so 0 dist = 1.0, max dist (0.707) = 0.0
  return Math.max(0, 1 - dist / 0.707);
}

/**
 * Checks if there is an open-path portal connecting the two photos' rooms.
 * Returns 1 if any open-path portal from photoA leads to photoB's room, else 0.
 */
function computeIsOpenPathFlag(
  photoA: PhotoSceneFacts,
  photoB: PhotoSceneFacts,
): 0 | 1 {
  const hasOpenPath = photoA.visible_portals.some(
    (p) =>
      p.is_open_path &&
      (p.to_room_id === photoB.room_id || p.to_room_id === null),
  );
  return hasOpenPath ? 1 : 0;
}

/**
 * Computes focal_subject_overlap: 1 if both photos share the same focal subject,
 * 0 if one or both are null, partial match based on string similarity otherwise.
 */
function computeFocalSubjectOverlap(
  photoA: PhotoSceneFacts,
  photoB: PhotoSceneFacts,
): number {
  const a = photoA.focal_subject;
  const b = photoB.focal_subject;
  if (!a || !b) return 0;
  if (a === b) return 1.0;
  // Partial: check if one contains the other
  if (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase())) {
    return 0.6;
  }
  return 0;
}

/**
 * Main feature extractor.
 *
 * @param candidate   The pair candidate being scored
 * @param photoA      Scene facts for photo A
 * @param photoB      Scene facts for photo B
 * @param embeddingSim  Pre-computed cosine similarity (null → default 0.5)
 */
export function extractFeatures(
  candidate: PairCandidate,
  photoA: PhotoSceneFacts,
  photoB: PhotoSceneFacts,
  embeddingSim: number | null,
): PickerFeatures {
  const same_room: 0 | 1 = photoA.room_id === photoB.room_id ? 1 : 0;

  const portal_distance = computePortalDistance(candidate, photoA, photoB);

  // shot_type_delta: abs diff on ordinal scale, normalized 0..1 over max range of 4
  const shotA = SHOT_ORDER[photoA.shot_type] ?? 2;
  const shotB = SHOT_ORDER[photoB.shot_type] ?? 2;
  const shot_type_delta = Math.abs(shotA - shotB) / 4;

  // zoom_delta: proxy via shot type delta (same scale, kept separate for future)
  const zoom_delta = shot_type_delta;

  const focal_subject_overlap = computeFocalSubjectOverlap(photoA, photoB);

  // lighting_delta: if visible_features contain "bright" / "dark" tokens, derive;
  // otherwise default 0.5 (neutral = unknown)
  const lighting_delta = computeLightingDelta(photoA, photoB);

  const embedding_cosine_sim = embeddingSim ?? 0.5;

  // bearing_compatibility_score: imported from bearing-compat module logic
  const bearing_compatibility_score = computeBearingCompat(
    photoA.camera_bearing_vector,
    photoB.camera_bearing_vector,
  );

  const portal_centeredness = computePortalCenteredness(candidate, photoA);

  const is_open_path_flag = computeIsOpenPathFlag(photoA, photoB);

  return {
    same_room,
    portal_distance,
    shot_type_delta,
    zoom_delta,
    focal_subject_overlap,
    lighting_delta,
    embedding_cosine_sim,
    bearing_compatibility_score,
    portal_centeredness,
    is_open_path_flag,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives a lighting delta from visible_features strings.
 * Looks for "bright", "dark", "low_light", "natural_light" tokens.
 * Returns 0.0 (same) to 1.0 (opposite extremes); defaults to 0.5 when unknown.
 */
function computeLightingDelta(
  photoA: PhotoSceneFacts,
  photoB: PhotoSceneFacts,
): number {
  const lightingScore = (features: string[]): number | null => {
    const f = features.map((s) => s.toLowerCase());
    if (f.some((s) => s.includes("bright") || s.includes("natural_light"))) return 1.0;
    if (f.some((s) => s.includes("dark") || s.includes("low_light"))) return 0.0;
    return null;
  };

  const scoreA = lightingScore(photoA.visible_features);
  const scoreB = lightingScore(photoB.visible_features);
  if (scoreA === null || scoreB === null) return 0.5;
  return Math.abs(scoreA - scoreB);
}

/**
 * Inline bearing compat table (mirrors candidates/bearing-compat.ts logic
 * to avoid cross-module imports per spec constraint).
 */
type BearingVector =
  | "looking_into_room"
  | "looking_out_of_room"
  | "parallel_to_wall_N"
  | "parallel_to_wall_E"
  | "parallel_to_wall_S"
  | "parallel_to_wall_W"
  | "unknown";

const BEARINGS: BearingVector[] = [
  "looking_into_room",
  "looking_out_of_room",
  "parallel_to_wall_N",
  "parallel_to_wall_E",
  "parallel_to_wall_S",
  "parallel_to_wall_W",
  "unknown",
];

const IDX: Record<BearingVector, number> = Object.fromEntries(
  BEARINGS.map((b, i) => [b, i]),
) as Record<BearingVector, number>;

const TABLE: number[][] = [
  [0.0, 0.2, 0.5, 0.5, 0.5, 0.5, 0.5],
  [0.0, 0.0, 0.5, 0.5, 0.5, 0.5, 0.5],
  [0.0, 0.0, 0.0, 0.6, 0.1, 0.6, 0.5],
  [0.0, 0.0, 0.0, 0.0, 0.6, 0.1, 0.5],
  [0.0, 0.0, 0.0, 0.0, 0.0, 0.6, 0.5],
  [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5],
  [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5],
];

const SAME_TYPE_OVERRIDES: Partial<Record<BearingVector, number>> = {
  looking_into_room: 0.9,
};

function computeBearingCompat(a: BearingVector, b: BearingVector): number {
  if (a === b) return SAME_TYPE_OVERRIDES[a] ?? 0.5;
  if (
    (a === "looking_into_room" && b === "looking_out_of_room") ||
    (a === "looking_out_of_room" && b === "looking_into_room")
  ) {
    return 0.2;
  }
  const row = Math.min(IDX[a], IDX[b]);
  const col = Math.max(IDX[a], IDX[b]);
  return TABLE[row][col];
}
