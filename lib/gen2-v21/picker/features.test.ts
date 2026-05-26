import { describe, it, expect } from "vitest";
import { extractFeatures } from "./features.js";
import type { PairCandidate, PhotoSceneFacts } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePhoto(overrides: Partial<PhotoSceneFacts> = {}): PhotoSceneFacts {
  return {
    photo_id: "p1",
    room_id: "room-a",
    room_confidence: 0.99,
    sub_region: null,
    camera_bearing_vector: "looking_into_room",
    shot_type: "wide",
    focal_subject: null,
    visible_features: [],
    visible_portals: [],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<PairCandidate> = {}): PairCandidate {
  return {
    candidate_id: "c1",
    listing_id: "l1",
    photo_a_id: "p1",
    photo_b_id: "p2",
    candidate_type: "same_room_different_angle",
    heuristic_score: 0.7,
    reasoning: "test",
    portal_id: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractFeatures", () => {
  it("same_room=1 when both photos share room_id", () => {
    const photoA = makePhoto({ room_id: "kitchen" });
    const photoB = makePhoto({ photo_id: "p2", room_id: "kitchen" });
    const candidate = makeCandidate({ candidate_type: "same_room_different_angle" });

    const features = extractFeatures(candidate, photoA, photoB, null);

    expect(features.same_room).toBe(1);
  });

  it("same_room=0 when photos are in different rooms", () => {
    const photoA = makePhoto({ room_id: "kitchen" });
    const photoB = makePhoto({ photo_id: "p2", room_id: "living_room" });
    const candidate = makeCandidate({ candidate_type: "walkthrough_via_portal" });

    const features = extractFeatures(candidate, photoA, photoB, null);

    expect(features.same_room).toBe(0);
  });

  it("portal_distance=0 for same_room_different_angle", () => {
    const photoA = makePhoto();
    const photoB = makePhoto({ photo_id: "p2" });
    const candidate = makeCandidate({ candidate_type: "same_room_different_angle" });

    const features = extractFeatures(candidate, photoA, photoB, null);

    expect(features.portal_distance).toBe(0);
  });

  it("portal_distance=1 for walkthrough_via_portal", () => {
    const photoA = makePhoto({
      visible_portals: [{
        portal_id: "portal-1",
        from_room_id: "room-a",
        to_room_id: "room-b",
        screen_position: { x: 0.5, y: 0.5, bbox: { x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.7 } },
        depth_estimate: "mid",
        is_open_path: true,
        confidence: 0.95,
      }],
    });
    const photoB = makePhoto({ photo_id: "p2", room_id: "room-b" });
    const candidate = makeCandidate({
      candidate_type: "walkthrough_via_portal",
      portal_id: "portal-1",
    });

    const features = extractFeatures(candidate, photoA, photoB, null);

    expect(features.portal_distance).toBe(1);
  });

  it("portal_distance=999 for exterior_walkaround", () => {
    const photoA = makePhoto();
    const photoB = makePhoto({ photo_id: "p2" });
    const candidate = makeCandidate({ candidate_type: "exterior_walkaround" });

    const features = extractFeatures(candidate, photoA, photoB, null);

    expect(features.portal_distance).toBe(999);
  });

  it("embedding_cosine_sim defaults to 0.5 when null is passed", () => {
    const photoA = makePhoto();
    const photoB = makePhoto({ photo_id: "p2" });
    const candidate = makeCandidate();

    const features = extractFeatures(candidate, photoA, photoB, null);

    expect(features.embedding_cosine_sim).toBe(0.5);
  });

  it("embedding_cosine_sim uses provided value when non-null", () => {
    const photoA = makePhoto();
    const photoB = makePhoto({ photo_id: "p2" });
    const candidate = makeCandidate();

    const features = extractFeatures(candidate, photoA, photoB, 0.85);

    expect(features.embedding_cosine_sim).toBe(0.85);
  });

  it("is_open_path_flag=1 when photoA has an open portal to photoB's room", () => {
    const photoA = makePhoto({
      room_id: "room-a",
      visible_portals: [{
        portal_id: "p",
        from_room_id: "room-a",
        to_room_id: "room-b",
        screen_position: { x: 0.5, y: 0.5, bbox: { x1: 0, y1: 0, x2: 1, y2: 1 } },
        depth_estimate: "near",
        is_open_path: true,
        confidence: 0.9,
      }],
    });
    const photoB = makePhoto({ photo_id: "p2", room_id: "room-b" });
    const candidate = makeCandidate({
      candidate_type: "walkthrough_via_portal",
      portal_id: "p",
    });

    const features = extractFeatures(candidate, photoA, photoB, null);

    expect(features.is_open_path_flag).toBe(1);
  });

  it("is_open_path_flag=0 when no open portal exists", () => {
    const photoA = makePhoto({ visible_portals: [] });
    const photoB = makePhoto({ photo_id: "p2" });
    const candidate = makeCandidate({ candidate_type: "same_room_different_angle" });

    const features = extractFeatures(candidate, photoA, photoB, null);

    expect(features.is_open_path_flag).toBe(0);
  });

  it("shot_type_delta is non-zero for wide vs detail", () => {
    const photoA = makePhoto({ shot_type: "wide" });
    const photoB = makePhoto({ photo_id: "p2", shot_type: "detail" });
    const candidate = makeCandidate({ candidate_type: "wide_to_detail" });

    const features = extractFeatures(candidate, photoA, photoB, null);

    // SHOT_ORDER: wide=1, detail=4 → |1-4|/4 = 0.75
    expect(features.shot_type_delta).toBeCloseTo(0.75, 5);
  });

  it("lighting_delta defaults to 0.5 when visible_features is empty", () => {
    const photoA = makePhoto({ visible_features: [] });
    const photoB = makePhoto({ photo_id: "p2", visible_features: [] });
    const candidate = makeCandidate();

    const features = extractFeatures(candidate, photoA, photoB, null);

    expect(features.lighting_delta).toBe(0.5);
  });

  it("portal_centeredness=0.5 for non-walkthrough candidates", () => {
    const photoA = makePhoto();
    const photoB = makePhoto({ photo_id: "p2" });
    const candidate = makeCandidate({ candidate_type: "same_room_different_angle" });

    const features = extractFeatures(candidate, photoA, photoB, null);

    expect(features.portal_centeredness).toBe(0.5);
  });

  it("portal_centeredness near 1 for centered portal", () => {
    const photoA = makePhoto({
      visible_portals: [{
        portal_id: "center-portal",
        from_room_id: "room-a",
        to_room_id: "room-b",
        screen_position: { x: 0.5, y: 0.5, bbox: { x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 } },
        depth_estimate: "mid",
        is_open_path: true,
        confidence: 0.95,
      }],
    });
    const photoB = makePhoto({ photo_id: "p2" });
    const candidate = makeCandidate({
      candidate_type: "walkthrough_via_portal",
      portal_id: "center-portal",
    });

    const features = extractFeatures(candidate, photoA, photoB, null);

    // Portal at (0.5,0.5) → distance from center = 0 → centeredness = 1
    expect(features.portal_centeredness).toBeCloseTo(1.0, 5);
  });

  it("returns all 10 required feature keys", () => {
    const photoA = makePhoto();
    const photoB = makePhoto({ photo_id: "p2" });
    const candidate = makeCandidate();

    const features = extractFeatures(candidate, photoA, photoB, 0.75);

    const keys = Object.keys(features);
    expect(keys).toContain("same_room");
    expect(keys).toContain("portal_distance");
    expect(keys).toContain("shot_type_delta");
    expect(keys).toContain("zoom_delta");
    expect(keys).toContain("focal_subject_overlap");
    expect(keys).toContain("lighting_delta");
    expect(keys).toContain("embedding_cosine_sim");
    expect(keys).toContain("bearing_compatibility_score");
    expect(keys).toContain("portal_centeredness");
    expect(keys).toContain("is_open_path_flag");
    expect(keys.length).toBe(10);
  });
});
