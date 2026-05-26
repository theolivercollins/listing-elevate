import type { BearingVector } from "../types.js";

// Compatibility table: score for each pair (symmetric).
// Rows = bearingA, Cols = bearingB (same order as BEARINGS).
const BEARINGS: BearingVector[] = [
  "looking_into_room",
  "looking_out_of_room",
  "parallel_to_wall_N",
  "parallel_to_wall_E",
  "parallel_to_wall_S",
  "parallel_to_wall_W",
  "unknown",
];

// Index lookup
const IDX: Record<BearingVector, number> = Object.fromEntries(
  BEARINGS.map((b, i) => [b, i]),
) as Record<BearingVector, number>;

// Upper-triangular scores (diagonal omitted; same bearing → same angle, not used for pairing)
// [a_idx][b_idx] where a_idx <= b_idx. For a_idx > b_idx swap them.
const TABLE: number[][] = [
  // into   out    N      E      S      W      unk
  [0.0,  0.2,   0.5,   0.5,   0.5,   0.5,   0.5],  // looking_into_room
  [0.0,  0.0,   0.5,   0.5,   0.5,   0.5,   0.5],  // looking_out_of_room
  [0.0,  0.0,   0.0,   0.6,   0.1,   0.6,   0.5],  // parallel_to_wall_N
  [0.0,  0.0,   0.0,   0.0,   0.6,   0.1,   0.5],  // parallel_to_wall_E
  [0.0,  0.0,   0.0,   0.0,   0.0,   0.6,   0.5],  // parallel_to_wall_S
  [0.0,  0.0,   0.0,   0.0,   0.0,   0.0,   0.5],  // parallel_to_wall_W
  [0.0,  0.0,   0.0,   0.0,   0.0,   0.0,   0.5],  // unknown
];

// Special cases for same-room looking_into + looking_into
// Two photos both "looking_into_room" from the same room = good (different angles of entry)
const SAME_TYPE_OVERRIDES: Partial<Record<BearingVector, number>> = {
  looking_into_room: 0.9,
};

/**
 * Returns a 0..1 compatibility score for two bearing vectors.
 * Higher = more cinematically interesting pair (different angles, not opposing).
 */
export function bearingCompatible(a: BearingVector, b: BearingVector): number {
  if (a === b) {
    return SAME_TYPE_OVERRIDES[a] ?? 0.5;
  }

  const ai = IDX[a];
  const bi = IDX[b];

  // looking_into + looking_out = opposing = 0.2
  if (
    (a === "looking_into_room" && b === "looking_out_of_room") ||
    (a === "looking_out_of_room" && b === "looking_into_room")
  ) {
    return 0.2;
  }

  // Use upper-triangular table
  const row = Math.min(ai, bi);
  const col = Math.max(ai, bi);
  return TABLE[row][col];
}
