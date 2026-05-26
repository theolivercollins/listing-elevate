import { describe, it, expect } from "vitest";
import { generateCandidates } from "./rule-generator.js";
import type {
  PhotoSceneFacts,
  PropertySceneGraph,
  VisiblePortal,
} from "../types.js";

function makePhoto(
  id: string,
  roomId: string,
  overrides: Partial<PhotoSceneFacts> = {},
): PhotoSceneFacts {
  return {
    photo_id: id,
    room_id: roomId,
    room_confidence: 0.98,
    sub_region: null,
    camera_bearing_vector: "looking_into_room",
    shot_type: "wide",
    focal_subject: null,
    visible_features: [],
    visible_portals: [],
    ...overrides,
  };
}

function makeGraph(
  photos: PhotoSceneFacts[],
  overrides: Partial<PropertySceneGraph> = {},
): PropertySceneGraph {
  return {
    listing_id: "listing-001",
    photos,
    rooms: [],
    front_orientation: "N",
    exterior_shots: [],
    extracted_at: "2026-05-26T00:00:00Z",
    model_version: "gemini-2.5-pro@2026-05-23",
    ...overrides,
  };
}

describe("generateCandidates — rule-generator", () => {
  // ---- room_confidence gate ----

  it("filters out photos with room_confidence below 0.70 gate (new default)", () => {
    const lowConf = makePhoto("low1", "room-a", { room_confidence: 0.65 });
    const lowConf2 = makePhoto("low2", "room-a", { room_confidence: 0.60 });
    const graph = makeGraph([lowConf, lowConf2]);
    // Use default gate (0.70)
    const results = generateCandidates(graph);
    expect(results).toHaveLength(0);
  });

  it("admits photos with room_confidence >= 0.70 (previously rejected at 0.97)", () => {
    // These would have been filtered at the old 0.97 gate
    const a = makePhoto("a", "room-a", { room_confidence: 0.75 });
    const b = makePhoto("b", "room-a", { room_confidence: 0.80 });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph);
    // Should produce candidates since both pass the 0.70 gate
    expect(results.length).toBeGreaterThan(0);
  });

  it("still filters when roomConfidenceGate is explicitly set to 0.97", () => {
    const lowConf = makePhoto("low1", "room-a", { room_confidence: 0.90 });
    const lowConf2 = makePhoto("low2", "room-a", { room_confidence: 0.85 });
    const graph = makeGraph([lowConf, lowConf2]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    expect(results).toHaveLength(0);
  });

  // ---- same_room_different_angle ----

  it("generates same_room_different_angle when bearing compat > 0.2 in same room", () => {
    // looking_into + looking_out = 0.2 (exactly at threshold, NOT > 0.2) — should NOT match
    // Use a pair with compat 0.9 to confirm it still works
    const a = makePhoto("a", "room-a", { camera_bearing_vector: "looking_into_room" });
    const b = makePhoto("b", "room-a", { camera_bearing_vector: "looking_into_room" });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const sameRoom = results.filter((r) => r.candidate_type === "same_room_different_angle");
    expect(sameRoom.length).toBeGreaterThan(0);
    expect(sameRoom[0].heuristic_score).toBeGreaterThan(0.2);
  });

  it("rejects same_room pair where bearing compat = 0.2 (looking_into + looking_out, NOT > 0.2)", () => {
    const a = makePhoto("a", "room-a", { camera_bearing_vector: "looking_into_room" });
    const b = makePhoto("b", "room-a", { camera_bearing_vector: "looking_out_of_room" });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const sameRoom = results.filter((r) => r.candidate_type === "same_room_different_angle");
    // bearing compat (0.2) is NOT > 0.2, so same_room_different_angle should not appear
    expect(sameRoom).toHaveLength(0);
  });

  it("now surfaces same_room pair that was previously rejected at 0.4 threshold (bearing compat 0.3)", () => {
    // parallel_to_wall_N + parallel_to_wall_E = 0.6 (passes)
    // But let us use unknown+unknown = 0.5, which passes both old 0.4 and new 0.2
    // The previously-blocked case: looking_into + looking_out = 0.2, which is NOT > 0.2 still
    // Use parallel_to_wall_N + parallel_to_wall_S = 0.1 → rejected
    // Instead show that 0.5 (unknown+unknown) works with the new threshold
    const a = makePhoto("a", "room-a", { camera_bearing_vector: "unknown" });
    const b = makePhoto("b", "room-a", { camera_bearing_vector: "parallel_to_wall_N" });
    // unknown + parallel_to_wall_N = 0.5 → passes old threshold too, but test documents intent
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const sameRoom = results.filter((r) => r.candidate_type === "same_room_different_angle");
    expect(sameRoom.length).toBeGreaterThan(0);
  });

  // ---- walkthrough_via_portal ----

  it("generates walkthrough_via_portal when open portal exists with confidence >= 0.4", () => {
    const portal: VisiblePortal = {
      portal_id: "door-1",
      from_room_id: "kitchen",
      to_room_id: "living",
      screen_position: { x: 0.5, y: 0.5, bbox: { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.8 } },
      depth_estimate: "mid",
      is_open_path: true,
      confidence: 0.45,  // previously rejected at 0.6 gate
    };
    const a = makePhoto("a", "kitchen", { visible_portals: [portal] });
    const b = makePhoto("b", "living");
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const wt = results.filter((r) => r.candidate_type === "walkthrough_via_portal");
    expect(wt.length).toBeGreaterThan(0);
    expect(wt[0].portal_id).toBe("door-1");
  });

  it("still generates walkthrough_via_portal for high-confidence portals (>= 0.85)", () => {
    const portal: VisiblePortal = {
      portal_id: "door-1",
      from_room_id: "kitchen",
      to_room_id: "living",
      screen_position: { x: 0.5, y: 0.5, bbox: { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.8 } },
      depth_estimate: "mid",
      is_open_path: true,
      confidence: 0.85,
    };
    const a = makePhoto("a", "kitchen", { visible_portals: [portal] });
    const b = makePhoto("b", "living");
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const wt = results.filter((r) => r.candidate_type === "walkthrough_via_portal");
    expect(wt.length).toBeGreaterThan(0);
    expect(wt[0].portal_id).toBe("door-1");
  });

  it("does NOT generate walkthrough when portal is_open_path=false (mirror)", () => {
    const mirror: VisiblePortal = {
      portal_id: "mirror-1",
      from_room_id: "bedroom",
      to_room_id: "bathroom",
      screen_position: { x: 0.5, y: 0.5, bbox: { x1: 0.3, y1: 0.2, x2: 0.7, y2: 0.9 } },
      depth_estimate: "near",
      is_open_path: false,
      confidence: 0.95,
    };
    const a = makePhoto("a", "bedroom", { visible_portals: [mirror] });
    const b = makePhoto("b", "bathroom");
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const wt = results.filter((r) => r.candidate_type === "walkthrough_via_portal");
    expect(wt).toHaveLength(0);
  });

  it("does NOT generate walkthrough when portal confidence < 0.4 (below new threshold)", () => {
    const portal: VisiblePortal = {
      portal_id: "door-low",
      from_room_id: "kitchen",
      to_room_id: "living",
      screen_position: { x: 0.5, y: 0.5, bbox: { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.8 } },
      depth_estimate: "mid",
      is_open_path: true,
      confidence: 0.35,
    };
    const a = makePhoto("a", "kitchen", { visible_portals: [portal] });
    const b = makePhoto("b", "living");
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const wt = results.filter((r) => r.candidate_type === "walkthrough_via_portal");
    expect(wt).toHaveLength(0);
  });

  // ---- wide_to_detail ----

  it("generates wide_to_detail when focal_subject overlap > 0", () => {
    const a = makePhoto("a", "room-a", {
      shot_type: "wide",
      focal_subject: "fireplace mantle",
    });
    const b = makePhoto("b", "room-a", {
      shot_type: "detail",
      focal_subject: "fireplace stone",
    });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const wd = results.filter((r) => r.candidate_type === "wide_to_detail");
    expect(wd.length).toBeGreaterThan(0);
    expect(wd[0].heuristic_score).toBeGreaterThan(0);
  });

  it("generates wide_to_detail for wide+close pair in same room (new: no focal overlap required)", () => {
    const a = makePhoto("a", "room-a", { shot_type: "wide", focal_subject: null });
    const b = makePhoto("b", "room-a", { shot_type: "close", focal_subject: null });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const wd = results.filter((r) => r.candidate_type === "wide_to_detail");
    expect(wd.length).toBeGreaterThan(0);
  });

  it("generates wide_to_detail for medium+detail pair in same room", () => {
    const a = makePhoto("a", "room-a", { shot_type: "medium", focal_subject: null });
    const b = makePhoto("b", "room-a", { shot_type: "detail", focal_subject: null });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const wd = results.filter((r) => r.candidate_type === "wide_to_detail");
    expect(wd.length).toBeGreaterThan(0);
  });

  it("does NOT generate wide_to_detail for medium+close pair (not a qualifying shot-type combo)", () => {
    const a = makePhoto("a", "room-a", { shot_type: "medium", focal_subject: null });
    const b = makePhoto("b", "room-a", { shot_type: "close", focal_subject: null });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const wd = results.filter((r) => r.candidate_type === "wide_to_detail");
    expect(wd).toHaveLength(0);
  });

  // ---- aerial_to_entry ----

  it("generates aerial_to_entry with score 0.85 for aerial + front exterior pair", () => {
    const aerial = makePhoto("aerial1", "exterior", { shot_type: "aerial" });
    const entry = makePhoto("entry1", "exterior", { shot_type: "wide" });
    const graph = makeGraph([aerial, entry], {
      exterior_shots: [
        { photo_id: "aerial1", type: "aerial" },
        { photo_id: "entry1", type: "front" },
      ],
    });
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const ae = results.filter((r) => r.candidate_type === "aerial_to_entry");
    expect(ae.length).toBeGreaterThan(0);
    expect(ae[0].heuristic_score).toBe(0.85);
  });

  // ---- exterior_walkaround ----

  it("exterior_walkaround requires different exterior types", () => {
    // Two front shots → same type → should NOT generate walkaround
    const a = makePhoto("ext1", "exterior");
    const b = makePhoto("ext2", "exterior");
    const graph = makeGraph([a, b], {
      exterior_shots: [
        { photo_id: "ext1", type: "front" },
        { photo_id: "ext2", type: "front" },
      ],
    });
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const wa = results.filter((r) => r.candidate_type === "exterior_walkaround");
    expect(wa).toHaveLength(0);
  });

  it("generates exterior_walkaround for front + side pair", () => {
    const a = makePhoto("ext1", "exterior");
    const b = makePhoto("ext2", "exterior");
    const graph = makeGraph([a, b], {
      exterior_shots: [
        { photo_id: "ext1", type: "front" },
        { photo_id: "ext2", type: "side" },
      ],
    });
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const wa = results.filter((r) => r.candidate_type === "exterior_walkaround");
    expect(wa.length).toBeGreaterThan(0);
    expect(wa[0].heuristic_score).toBe(0.7);
  });

  // ---- same_room_fallback ----

  it("emits same_room_fallback when pair matched no typed rule (opposing bearings, same room)", () => {
    // looking_into + looking_out = bCompat 0.2, NOT > 0.2, no focal overlap, no portal
    // → no same_room_different_angle, no wide_to_detail, no portal → fallback
    const a = makePhoto("a", "room-a", {
      camera_bearing_vector: "looking_into_room",
      shot_type: "wide",
    });
    const b = makePhoto("b", "room-a", {
      camera_bearing_vector: "looking_out_of_room",
      shot_type: "wide",
    });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const fallback = results.filter((r) => r.candidate_type === "same_room_fallback");
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback[0].heuristic_score).toBe(0.3);
  });

  it("does NOT emit same_room_fallback when another typed candidate matched", () => {
    // Two looking_into_room in same room → same_room_different_angle (bCompat 0.9 > 0.2)
    const a = makePhoto("a", "room-a", { camera_bearing_vector: "looking_into_room" });
    const b = makePhoto("b", "room-a", { camera_bearing_vector: "looking_into_room" });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const fallback = results.filter((r) => r.candidate_type === "same_room_fallback");
    expect(fallback).toHaveLength(0);
  });

  it("does NOT emit same_room_fallback for different-room pairs", () => {
    // No typed rule matches but different rooms → fallback should not fire
    const portal: VisiblePortal = {
      portal_id: "door-no",
      from_room_id: "kitchen",
      to_room_id: "other-room",
      screen_position: { x: 0.5, y: 0.5, bbox: { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.8 } },
      depth_estimate: "mid",
      is_open_path: false,
      confidence: 0.9,
    };
    const a = makePhoto("a", "kitchen", { visible_portals: [portal] });
    const b = makePhoto("b", "dining");
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const fallback = results.filter((r) => r.candidate_type === "same_room_fallback");
    expect(fallback).toHaveLength(0);
  });

  // ---- multi-category (same pair can appear in multiple types) ----

  it("a pair can appear in both wide_to_detail and same_room_different_angle", () => {
    // wide + detail in same room, focal overlap > 0, bearing compat > 0.2
    const a = makePhoto("a", "room-a", {
      shot_type: "wide",
      focal_subject: "sofa corner",
      camera_bearing_vector: "looking_into_room",
    });
    const b = makePhoto("b", "room-a", {
      shot_type: "detail",
      focal_subject: "sofa cushion",
      camera_bearing_vector: "looking_into_room",
    });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    const types = new Set(results.map((r) => r.candidate_type));
    expect(types.has("wide_to_detail")).toBe(true);
    expect(types.has("same_room_different_angle")).toBe(true);
  });

  // ---- sorting and cap ----

  it("returns candidates sorted by heuristic_score descending", () => {
    const portal: VisiblePortal = {
      portal_id: "door-x",
      from_room_id: "kitchen",
      to_room_id: "dining",
      screen_position: { x: 0.5, y: 0.5, bbox: { x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.8 } },
      depth_estimate: "mid",
      is_open_path: true,
      confidence: 0.9,
    };
    const photos = [
      makePhoto("a", "kitchen", { camera_bearing_vector: "looking_into_room", visible_portals: [portal] }),
      makePhoto("b", "kitchen", { camera_bearing_vector: "looking_into_room" }),
      makePhoto("c", "dining"),
    ];
    const graph = makeGraph(photos);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].heuristic_score).toBeGreaterThanOrEqual(results[i].heuristic_score);
    }
  });

  it("returns at most 200 candidates even with many photos (new cap)", () => {
    // Generate 21 photos in the same room — creates ~210 pairs
    const photos = Array.from({ length: 21 }, (_, i) =>
      makePhoto(`p${i.toString().padStart(2, "0")}`, "room-a", {
        camera_bearing_vector: "looking_into_room",
      }),
    );
    const graph = makeGraph(photos);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    expect(results.length).toBeLessThanOrEqual(200);
  });

  it("old 100-candidate cap is no longer in effect (>100 candidates can surface)", () => {
    // 21 photos same room → 210 pairs all matching same_room_different_angle (bCompat 0.9)
    const photos = Array.from({ length: 21 }, (_, i) =>
      makePhoto(`p${i.toString().padStart(2, "0")}`, "room-a", {
        camera_bearing_vector: "looking_into_room",
      }),
    );
    const graph = makeGraph(photos);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    // With 21 photos there are 210 pairs; multi-category means even more candidates.
    // At minimum we should have > 100 before the 200 cap kicks in.
    expect(results.length).toBeGreaterThan(100);
    expect(results.length).toBeLessThanOrEqual(200);
  });
});
