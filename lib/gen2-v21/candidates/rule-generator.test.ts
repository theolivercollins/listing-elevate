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
  it("filters out photos with room_confidence below gate and generates zero candidates for them", () => {
    const lowConf = makePhoto("low1", "room-a", { room_confidence: 0.90 });
    const lowConf2 = makePhoto("low2", "room-a", { room_confidence: 0.85 });
    const graph = makeGraph([lowConf, lowConf2]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    expect(results).toHaveLength(0);
  });

  it("generates same_room_different_angle when bearing compat > 0.4 in same room", () => {
    // both looking_into_room → compat = 0.9
    const a = makePhoto("a", "room-a", { camera_bearing_vector: "looking_into_room" });
    const b = makePhoto("b", "room-a", { camera_bearing_vector: "looking_into_room" });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].candidate_type).toBe("same_room_different_angle");
    expect(results[0].heuristic_score).toBeGreaterThan(0.4);
  });

  it("rejects same_room pair with opposing bearings (compat = 0.2, not > 0.4)", () => {
    const a = makePhoto("a", "room-a", { camera_bearing_vector: "looking_into_room" });
    const b = makePhoto("b", "room-a", { camera_bearing_vector: "looking_out_of_room" });
    const graph = makeGraph([a, b]);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    // No same_room_different_angle since bearing compat (0.2) <= 0.4
    const sameRoom = results.filter((r) => r.candidate_type === "same_room_different_angle");
    expect(sameRoom).toHaveLength(0);
  });

  it("generates walkthrough_via_portal when open portal exists between rooms", () => {
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

  it("returns candidates sorted by heuristic_score descending", () => {
    // Create multiple candidates across different rooms
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

  it("returns at most 100 candidates even with many photos", () => {
    // Generate 20 photos in the same room — creates ~190 pairs
    const photos = Array.from({ length: 20 }, (_, i) =>
      makePhoto(`p${i.toString().padStart(2, "0")}`, "room-a", {
        camera_bearing_vector: "looking_into_room",
      }),
    );
    const graph = makeGraph(photos);
    const results = generateCandidates(graph, { roomConfidenceGate: 0.97 });
    expect(results.length).toBeLessThanOrEqual(100);
  });

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
});
