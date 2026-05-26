import { describe, it, expect } from "vitest";
import type { PropertySceneGraph, PairCandidate, PickerPrediction, PhotoSceneFacts } from "../types.js";
import { routePropertyPhotos } from "./bulk-router.js";

function makePhoto(id: string, room_confidence: number, room_id = "room-1"): PhotoSceneFacts {
  return {
    photo_id: id,
    room_id,
    room_confidence,
    sub_region: null,
    camera_bearing_vector: "looking_into_room",
    shot_type: "wide",
    focal_subject: null,
    visible_features: [],
    visible_portals: [],
  };
}

function makeGraph(photos: PhotoSceneFacts[]): PropertySceneGraph {
  return {
    listing_id: "listing-1",
    photos,
    rooms: [],
    front_orientation: "N",
    exterior_shots: [],
    extracted_at: "2026-05-26T00:00:00Z",
    model_version: "gemini-2.5-pro@2026-05-23",
  };
}

function makeCandidate(id: string, a: string, b: string, heuristic = 0.8): PairCandidate {
  return {
    candidate_id: id,
    listing_id: "listing-1",
    photo_a_id: a,
    photo_b_id: b,
    candidate_type: "same_room_different_angle",
    heuristic_score: heuristic,
    reasoning: "test",
    portal_id: null,
  };
}

function makePicker(score: number): { score: (c: PairCandidate) => PickerPrediction } {
  return {
    score: () => ({
      score,
      confidence: 0.9,
      top_3_features: [],
      model_version: "heuristic-v1",
      used_fallback_heuristic: true,
    }),
  };
}

describe("routePropertyPhotos", () => {
  it("classifies all photos correctly — high confidence pair + low confidence single", () => {
    const photos = [
      makePhoto("p1", 0.99),
      makePhoto("p2", 0.99),
      makePhoto("p3", 0.85), // low confidence
    ];
    const graph = makeGraph(photos);
    const candidates = [makeCandidate("c1", "p1", "p2")];
    const result = routePropertyPhotos(graph, candidates, makePicker(0.8));

    expect(result.v21Pairs).toHaveLength(1);
    expect(result.v21Pairs[0].candidate_id).toBe("c1");
    expect(result.v1SinglePhotos).toHaveLength(1);
    expect(result.v1SinglePhotos[0].photo_id).toBe("p3");
    expect(result.v1SinglePhotos[0].reason).toBe("low_confidence");
  });

  it("routes photo to v1_single_image with reason 'no_candidates' when no pair includes it", () => {
    const photos = [makePhoto("solo", 0.99)];
    const graph = makeGraph(photos);
    const result = routePropertyPhotos(graph, [], null);

    expect(result.v21Pairs).toHaveLength(0);
    expect(result.v1SinglePhotos[0].photo_id).toBe("solo");
    expect(result.v1SinglePhotos[0].reason).toBe("no_candidates");
  });

  it("routes photo to v1_single_image with reason 'low_picker_score' when picker score < 0.5", () => {
    const photos = [makePhoto("p1", 0.99), makePhoto("p2", 0.99)];
    const graph = makeGraph(photos);
    const candidates = [makeCandidate("c1", "p1", "p2")];
    const result = routePropertyPhotos(graph, candidates, makePicker(0.3));

    expect(result.v21Pairs).toHaveLength(0);
    expect(result.v1SinglePhotos).toHaveLength(2);
    expect(result.v1SinglePhotos.every((p) => p.reason === "low_picker_score")).toBe(true);
  });

  it("null picker falls through to heuristic_score for sorting, still classifies pairs correctly", () => {
    const photos = [makePhoto("p1", 0.99), makePhoto("p2", 0.99)];
    const graph = makeGraph(photos);
    const candidates = [makeCandidate("c1", "p1", "p2", 0.9)];
    // null picker — no score gate applied, pair should succeed
    const result = routePropertyPhotos(graph, candidates, null);

    expect(result.v21Pairs).toHaveLength(1);
    expect(result.v1SinglePhotos).toHaveLength(0);
  });

  it("does not double-assign a photo to multiple pairs", () => {
    // p1 appears in two candidates — only the higher-scored one should win
    const photos = [makePhoto("p1", 0.99), makePhoto("p2", 0.99), makePhoto("p3", 0.99)];
    const graph = makeGraph(photos);
    const candidates = [
      makeCandidate("c-low", "p1", "p2", 0.6),
      makeCandidate("c-high", "p1", "p3", 0.9),
    ];
    const result = routePropertyPhotos(graph, candidates, null);

    // c-high wins because it scores higher; p2 falls through with no_candidates
    const pairCandidateIds = result.v21Pairs.map((p) => p.candidate_id);
    expect(pairCandidateIds).toContain("c-high");
    expect(pairCandidateIds).not.toContain("c-low");

    const singleIds = result.v1SinglePhotos.map((p) => p.photo_id);
    expect(singleIds).toContain("p2");
  });

  it("respects roomConfidenceGate opts override in bulk routing", () => {
    // Photo at 0.95 would fail default gate (0.97) but pass with gate=0.90
    const photos = [makePhoto("p1", 0.95), makePhoto("p2", 0.95)];
    const graph = makeGraph(photos);
    const candidates = [makeCandidate("c1", "p1", "p2")];

    const defaultResult = routePropertyPhotos(graph, candidates, null);
    expect(defaultResult.v21Pairs).toHaveLength(0);
    expect(defaultResult.v1SinglePhotos.every((p) => p.reason === "low_confidence")).toBe(true);

    const lowerGateResult = routePropertyPhotos(graph, candidates, null, { roomConfidenceGate: 0.90 });
    expect(lowerGateResult.v21Pairs).toHaveLength(1);
    expect(lowerGateResult.v1SinglePhotos).toHaveLength(0);
  });
});
