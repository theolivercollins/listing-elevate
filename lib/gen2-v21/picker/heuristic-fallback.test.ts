import { describe, it, expect } from "vitest";
import { heuristicScore } from "./heuristic-fallback.js";
import type { PickerFeatures } from "../types.js";

function makeFeatures(overrides: Partial<PickerFeatures> = {}): PickerFeatures {
  return {
    same_room: 0,
    portal_distance: 999,
    shot_type_delta: 0,
    zoom_delta: 0,
    focal_subject_overlap: 0,
    lighting_delta: 0.5,
    embedding_cosine_sim: 0.5,
    bearing_compatibility_score: 0.5,
    portal_centeredness: 0.5,
    is_open_path_flag: 0,
    ...overrides,
  };
}

describe("heuristicScore", () => {
  it("returns top_3_features with same_room, is_open_path_flag, bearing_compatibility_score", () => {
    const features = makeFeatures({ same_room: 1, is_open_path_flag: 1, bearing_compatibility_score: 0.8 });
    const prediction = heuristicScore(features);

    const names = prediction.top_3_features.map((f) => f.name);
    expect(names).toContain("same_room");
    expect(names).toContain("is_open_path_flag");
    expect(names).toContain("bearing_compatibility_score");
    expect(names.length).toBe(3);
  });

  it("sets used_fallback_heuristic=true", () => {
    const prediction = heuristicScore(makeFeatures());
    expect(prediction.used_fallback_heuristic).toBe(true);
  });

  it("confidence is always 0.5", () => {
    const prediction = heuristicScore(makeFeatures({ same_room: 1, is_open_path_flag: 1 }));
    expect(prediction.confidence).toBe(0.5);
  });

  it("score=1.0 for perfect same_room + open_path + good bearing", () => {
    const features = makeFeatures({
      same_room: 1,
      is_open_path_flag: 1,
      bearing_compatibility_score: 1.0,
    });
    const prediction = heuristicScore(features);
    // 0.5*1 + 0.3*1 + 0.2*1 = 1.0
    expect(prediction.score).toBeCloseTo(1.0, 5);
  });

  it("score=0 for opposite extremes", () => {
    const features = makeFeatures({
      same_room: 0,
      is_open_path_flag: 0,
      bearing_compatibility_score: 0,
    });
    const prediction = heuristicScore(features);
    expect(prediction.score).toBe(0);
  });

  it("weighted contributions are correct", () => {
    const features = makeFeatures({
      same_room: 1,
      is_open_path_flag: 1,
      bearing_compatibility_score: 0.6,
    });
    const prediction = heuristicScore(features);

    const sr = prediction.top_3_features.find((f) => f.name === "same_room")!;
    const op = prediction.top_3_features.find((f) => f.name === "is_open_path_flag")!;
    const bc = prediction.top_3_features.find((f) => f.name === "bearing_compatibility_score")!;

    expect(sr.weight).toBeCloseTo(0.5, 5);   // 0.5 * 1
    expect(op.weight).toBeCloseTo(0.3, 5);   // 0.3 * 1
    expect(bc.weight).toBeCloseTo(0.12, 5);  // 0.2 * 0.6
  });

  it("model_version is heuristic-v1", () => {
    const prediction = heuristicScore(makeFeatures());
    expect(prediction.model_version).toBe("heuristic-v1");
  });
});
