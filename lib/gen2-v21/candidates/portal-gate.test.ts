import { describe, it, expect } from "vitest";
import { portalIsWalkable, findSharedPortal } from "./portal-gate.js";
import type { PhotoSceneFacts, VisiblePortal } from "../types.js";

function makePortal(overrides: Partial<VisiblePortal> = {}): VisiblePortal {
  return {
    portal_id: "p1",
    from_room_id: "room-a",
    to_room_id: "room-b",
    screen_position: { x: 0.5, y: 0.5, bbox: { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.8 } },
    depth_estimate: "mid",
    is_open_path: true,
    confidence: 0.8,
    ...overrides,
  };
}

function makePhoto(id: string, roomId: string, portals: VisiblePortal[] = []): PhotoSceneFacts {
  return {
    photo_id: id,
    room_id: roomId,
    room_confidence: 0.98,
    sub_region: null,
    camera_bearing_vector: "looking_into_room",
    shot_type: "wide",
    focal_subject: null,
    visible_features: [],
    visible_portals: portals,
  };
}

describe("portalIsWalkable", () => {
  it("returns true for open path with confidence >= 0.6", () => {
    expect(portalIsWalkable(makePortal({ is_open_path: true, confidence: 0.7 }))).toBe(true);
  });

  it("returns false when is_open_path = false (mirror)", () => {
    expect(portalIsWalkable(makePortal({ is_open_path: false, confidence: 0.9 }))).toBe(false);
  });

  it("returns false when confidence < 0.4 (lowered threshold 2026-05-26)", () => {
    expect(portalIsWalkable(makePortal({ is_open_path: true, confidence: 0.35 }))).toBe(false);
  });

  it("returns true at exactly 0.4 confidence (lowered from 0.6 on 2026-05-26)", () => {
    expect(portalIsWalkable(makePortal({ is_open_path: true, confidence: 0.4 }))).toBe(true);
  });

  it("returns true for confidence between 0.4 and 0.6 (previously rejected)", () => {
    expect(portalIsWalkable(makePortal({ is_open_path: true, confidence: 0.55 }))).toBe(true);
  });
});

describe("findSharedPortal", () => {
  it("finds portal in photoA leading to photoB's room", () => {
    const portal = makePortal({ from_room_id: "room-a", to_room_id: "room-b", confidence: 0.75 });
    const photoA = makePhoto("a1", "room-a", [portal]);
    const photoB = makePhoto("b1", "room-b", []);
    const result = findSharedPortal(photoA, photoB);
    expect(result).not.toBeNull();
    expect(result!.portal_id).toBe("p1");
  });

  it("finds portal in photoB leading to photoA's room (reverse direction)", () => {
    const portal = makePortal({ from_room_id: "room-b", to_room_id: "room-a", confidence: 0.8 });
    const photoA = makePhoto("a1", "room-a", []);
    const photoB = makePhoto("b1", "room-b", [portal]);
    const result = findSharedPortal(photoA, photoB);
    expect(result).not.toBeNull();
    expect(result!.portal_id).toBe("p1");
  });

  it("returns null when portal is not walkable (is_open_path=false)", () => {
    const portal = makePortal({ from_room_id: "room-a", to_room_id: "room-b", is_open_path: false, confidence: 0.9 });
    const photoA = makePhoto("a1", "room-a", [portal]);
    const photoB = makePhoto("b1", "room-b", []);
    expect(findSharedPortal(photoA, photoB)).toBeNull();
  });

  it("returns null when no shared portal exists", () => {
    const portal = makePortal({ from_room_id: "room-a", to_room_id: "room-c", confidence: 0.8 });
    const photoA = makePhoto("a1", "room-a", [portal]);
    const photoB = makePhoto("b1", "room-b", []);
    expect(findSharedPortal(photoA, photoB)).toBeNull();
  });

  it("returns highest-confidence portal when multiple exist", () => {
    const p1 = makePortal({ portal_id: "p-low", from_room_id: "room-a", to_room_id: "room-b", confidence: 0.65 });
    const p2 = makePortal({ portal_id: "p-high", from_room_id: "room-a", to_room_id: "room-b", confidence: 0.9 });
    const photoA = makePhoto("a1", "room-a", [p1, p2]);
    const photoB = makePhoto("b1", "room-b", []);
    const result = findSharedPortal(photoA, photoB);
    expect(result!.portal_id).toBe("p-high");
  });
});
