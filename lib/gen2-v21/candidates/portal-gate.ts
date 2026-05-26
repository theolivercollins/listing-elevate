import type { PhotoSceneFacts, VisiblePortal } from "../types.js";

/**
 * Returns true if the portal represents a physically walkable path.
 * Mirrors and windows have is_open_path = false and are excluded.
 *
 * Threshold lowered from >= 0.6 to >= 0.4 on 2026-05-26 per operator feedback
 * ("only 2 scenes got pairs"). Future tightening should reference labeled data.
 */
export function portalIsWalkable(p: VisiblePortal): boolean {
  return p.is_open_path && p.confidence >= 0.4;
}

/**
 * Returns a portal in photoA that leads to photoB's room, or vice versa.
 * Checks both directions (a→b and b→a).
 * Returns the highest-confidence walkable portal found, or null if none.
 */
export function findSharedPortal(
  photoA: PhotoSceneFacts,
  photoB: PhotoSceneFacts,
): VisiblePortal | null {
  const candidates: VisiblePortal[] = [];

  // A's portals leading to B's room
  for (const p of photoA.visible_portals) {
    if (
      p.to_room_id === photoB.room_id &&
      p.from_room_id === photoA.room_id &&
      portalIsWalkable(p)
    ) {
      candidates.push(p);
    }
  }

  // B's portals leading to A's room (reverse direction)
  for (const p of photoB.visible_portals) {
    if (
      p.to_room_id === photoA.room_id &&
      p.from_room_id === photoB.room_id &&
      portalIsWalkable(p)
    ) {
      candidates.push(p);
    }
  }

  if (candidates.length === 0) return null;

  // Return highest-confidence portal
  return candidates.reduce((best, p) =>
    p.confidence > best.confidence ? p : best,
  );
}
