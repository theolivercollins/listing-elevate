/**
 * Deterministic scene ordering for video assembly.
 *
 * Goal: every assembled listing video walks the buyer through the home
 * in the same logical sequence, regardless of what order the director
 * happened to generate scenes in. "Same flow every time" — a buyer
 * expectation, and a basis for the future post-gen reorder agent.
 *
 * Ordering policy (real-estate-walkthrough convention):
 *   1. OPENING        — aerial / exterior_front (establishing shot)
 *   2. ENTRANCE       — foyer
 *   3. LIVING SPACES  — living_room → dining → kitchen
 *   4. BEDROOMS       — master_bedroom → other bedrooms (in director order)
 *   5. BATHROOMS      — bathroom → powder_room
 *   6. SPECIALTY      — office, media_room, gym, laundry, mudroom,
 *                       basement, closet, garage, hallway, stairs
 *   7. OUTDOOR        — deck, lanai, pool
 *   8. CLOSING        — exterior_back (or unused aerial)
 *   9. UNCATEGORIZED  — room_type 'other' or null — kept at the end in
 *                       director order so we don't lose them
 *
 * Within a room-type slot, multiple scenes keep their director-assigned
 * scene_number order (so e.g. three bedrooms surface in the order the
 * director chose).
 */

import type { RoomType } from "../types.js";

export interface OrderableScene {
  scene_number: number;
  room_type: RoomType | null;
  /** Anything else the caller wants preserved through ordering. */
  [key: string]: unknown;
}

// Ordered slots. Each scene is bucketed by room_type, then concatenated in
// this order. Within a bucket, scene_number ascending.
const SLOT_ORDER: ReadonlyArray<RoomType | "_uncategorized"> = [
  "aerial",
  "exterior_front",
  "foyer",
  "living_room",
  "dining",
  "kitchen",
  "master_bedroom",
  "bedroom",
  "bathroom",
  "powder_room",
  "office",
  "media_room",
  "gym",
  "laundry",
  "mudroom",
  "basement",
  "closet",
  "garage",
  "hallway",
  "stairs",
  "deck",
  // 'lanai' (covered outdoor living) groups with the outdoor slot, after the
  // open deck and before the pool. The active analyzer
  // (lib/providers/gemini-analyzer.ts) emits this room_type; before it was
  // listed here, lanai scenes fell into '_uncategorized' and were dumped at the
  // end of the video (prod incident 2026-06-10, property 0cdb242c).
  "lanai",
  "pool",
  "exterior_back",
  // Always last — catches "other" + null room_type
  "_uncategorized",
];

/**
 * Reorder scenes for assembly. Pure function, deterministic.
 *
 * Tie-breaking within a slot is by scene_number ascending. Scenes with
 * room_type 'other' or null land in '_uncategorized' (end of video).
 */
export function orderScenesForAssembly<T extends OrderableScene>(scenes: T[]): T[] {
  if (scenes.length === 0) return [];

  // Bucket by slot. Map for O(1) lookup.
  const buckets = new Map<RoomType | "_uncategorized", T[]>();
  for (const slot of SLOT_ORDER) {
    buckets.set(slot, []);
  }

  for (const scene of scenes) {
    const slot: RoomType | "_uncategorized" =
      scene.room_type === null || scene.room_type === "other"
        ? "_uncategorized"
        : scene.room_type;
    const bucket = buckets.get(slot);
    if (bucket) {
      bucket.push(scene);
    } else {
      // Unknown room_type that's not in SLOT_ORDER. Treat as uncategorized.
      buckets.get("_uncategorized")!.push(scene);
    }
  }

  // Concatenate in slot order, scene_number ascending within each bucket.
  const ordered: T[] = [];
  for (const slot of SLOT_ORDER) {
    const bucket = buckets.get(slot);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort((a, b) => a.scene_number - b.scene_number);
    ordered.push(...bucket);
  }
  return ordered;
}

/**
 * Diagnostic: which slot does a given room_type land in? Returns
 * '_uncategorized' for 'other' / null / unknown types.
 */
export function slotForRoomType(
  roomType: RoomType | null,
): RoomType | "_uncategorized" {
  if (roomType === null || roomType === "other") return "_uncategorized";
  return SLOT_ORDER.includes(roomType) ? roomType : "_uncategorized";
}
