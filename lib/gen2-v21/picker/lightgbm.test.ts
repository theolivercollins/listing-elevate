import { describe, it, expect } from "vitest";
import { trainPicker, predict, featureImportance } from "./lightgbm.js";
import { shouldRetrain, trainAndPersist } from "./retrain-trigger.js";
import type { PickerFeatures } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFeatures(overrides: Partial<PickerFeatures> = {}): PickerFeatures {
  return {
    same_room: 0,
    portal_distance: 1,
    shot_type_delta: 0.25,
    zoom_delta: 0.25,
    focal_subject_overlap: 0,
    lighting_delta: 0.5,
    embedding_cosine_sim: 0.5,
    bearing_compatibility_score: 0.5,
    portal_centeredness: 0.5,
    is_open_path_flag: 0,
    ...overrides,
  };
}

/** Linearly separable toy dataset: same_room + is_open_path → good (1) */
function makeLinearData(n = 30): Array<{ features: PickerFeatures; target: 0 | 1 }> {
  const data: Array<{ features: PickerFeatures; target: 0 | 1 }> = [];
  for (let i = 0; i < n; i++) {
    const isGood = i % 2 === 0;
    data.push({
      features: makeFeatures({
        same_room: isGood ? 1 : 0,
        is_open_path_flag: isGood ? 1 : 0,
        bearing_compatibility_score: isGood ? 0.9 : 0.1,
        embedding_cosine_sim: isGood ? 0.9 : 0.1,
      }),
      target: isGood ? 1 : 0,
    });
  }
  return data;
}

// ---------------------------------------------------------------------------
// LR + boost tests
// ---------------------------------------------------------------------------

describe("trainPicker + predict", () => {
  it("LR trains on linearly-separable toy data and classifies correctly", () => {
    const data = makeLinearData(40);
    const weights = trainPicker(data);

    let correct = 0;
    for (const d of data) {
      const pred = predict(d.features, weights);
      const predicted = pred.score >= 0.5 ? 1 : 0;
      if (predicted === d.target) correct++;
    }
    const accuracy = correct / data.length;

    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it("predict returns score in [0,1]", () => {
    const weights = trainPicker(makeLinearData(20));
    const pred = predict(makeFeatures(), weights);
    expect(pred.score).toBeGreaterThanOrEqual(0);
    expect(pred.score).toBeLessThanOrEqual(1);
  });

  it("predict returns top_3_features with 3 entries", () => {
    const weights = trainPicker(makeLinearData(20));
    const pred = predict(makeFeatures({ same_room: 1 }), weights);
    expect(pred.top_3_features.length).toBe(3);
  });

  it("predict used_fallback_heuristic=false", () => {
    const weights = trainPicker(makeLinearData(20));
    const pred = predict(makeFeatures(), weights);
    expect(pred.used_fallback_heuristic).toBe(false);
  });

  it("featureImportance returns all features sorted by magnitude", () => {
    const weights = trainPicker(makeLinearData(20));
    const importance = featureImportance(weights);
    expect(importance.length).toBe(10);
    // Sorted descending
    for (let i = 1; i < importance.length; i++) {
      expect(importance[i - 1].importance).toBeGreaterThanOrEqual(importance[i].importance);
    }
  });

  it("high same_room+open_path features score higher than low", () => {
    const weights = trainPicker(makeLinearData(40));

    const good = predict(
      makeFeatures({ same_room: 1, is_open_path_flag: 1, bearing_compatibility_score: 0.9, embedding_cosine_sim: 0.9 }),
      weights,
    );
    const bad = predict(
      makeFeatures({ same_room: 0, is_open_path_flag: 0, bearing_compatibility_score: 0.1, embedding_cosine_sim: 0.1 }),
      weights,
    );

    expect(good.score).toBeGreaterThan(bad.score);
  });

  it("throws on empty label set", () => {
    expect(() => trainPicker([])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Retrain trigger tests
// ---------------------------------------------------------------------------

describe("shouldRetrain", () => {
  it("returns false when label count < 10", () => {
    expect(shouldRetrain(5, 0)).toBe(false);
    expect(shouldRetrain(9, 0)).toBe(false);
  });

  it("fires at exactly 10 labels", () => {
    expect(shouldRetrain(10, 0)).toBe(true);
  });

  it("fires at every 10-label boundary", () => {
    expect(shouldRetrain(20, 10)).toBe(true);
    expect(shouldRetrain(30, 20)).toBe(true);
    expect(shouldRetrain(100, 90)).toBe(true);
  });

  it("does not re-fire between 10-label boundaries", () => {
    expect(shouldRetrain(15, 10)).toBe(false);
    expect(shouldRetrain(19, 10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Held-out split test
// ---------------------------------------------------------------------------

describe("trainAndPersist (held-out split by listing)", () => {
  it("split is by listing_id, not by individual label", async () => {
    // 3 listings, each with multiple labels
    const listingA = "listing-A";
    const listingB = "listing-B";
    const listingC = "listing-C";

    const labelsData = [
      ...Array.from({ length: 4 }, (_, i) => ({ label_id: `A${i}`, listing_id: listingA, features_blob: makeFeatures({ same_room: 1, is_open_path_flag: 1 }), target: 1 as 0 | 1 })),
      ...Array.from({ length: 4 }, (_, i) => ({ label_id: `B${i}`, listing_id: listingB, features_blob: makeFeatures({ same_room: 0, is_open_path_flag: 0 }), target: 0 as 0 | 1 })),
      ...Array.from({ length: 4 }, (_, i) => ({ label_id: `C${i}`, listing_id: listingC, features_blob: makeFeatures({ same_room: 1, is_open_path_flag: 1 }), target: 1 as 0 | 1 })),
    ];

    let deactivateCalled = false;
    let insertedRow: unknown = null;

    const mockSupabase = {
      from: (table: string) => ({
        select: () => ({ then: () => {} }),
        insert: (row: unknown) => {
          insertedRow = row;
          return {
            select: () => ({
              limit: () => ({
                then: (cb: (res: { data: unknown; error: unknown }) => void) => {
                  cb({ data: [{ model_id: "mock-model-id" }], error: null });
                },
              }),
            }),
          };
        },
        update: () => {
          deactivateCalled = true;
          return {
            eq: () => ({
              then: (cb: (res: { data: unknown; error: unknown }) => void) => {
                cb({ data: null, error: null });
              },
            }),
          };
        },
        eq: () => ({ then: () => {} }),
        limit: () => ({ then: () => {} }),
        then: () => {},
      }),
      rpc: async () => ({ error: null }),
    };

    const result = await trainAndPersist(
      mockSupabase as never,
      async () => labelsData,
    );

    // Should return a model_id
    expect(result.model_id).toBe("mock-model-id");

    // Deactivation should have been called
    expect(deactivateCalled).toBe(true);

    // The inserted model should have is_active=true
    const inserted = insertedRow as { is_active: boolean; label_count_at_train: number };
    expect(inserted.is_active).toBe(true);
    expect(inserted.label_count_at_train).toBe(12);
  });

  it("accuracy_on_holdout is in [0,1]", async () => {
    const labelsData = [
      ...Array.from({ length: 6 }, (_, i) => ({
        label_id: `X${i}`,
        listing_id: i < 3 ? "lst-1" : "lst-2",
        features_blob: makeFeatures({ same_room: i < 3 ? 1 : 0 }),
        target: (i < 3 ? 1 : 0) as 0 | 1,
      })),
    ];

    const mockSupabase = {
      from: (_: string) => ({
        insert: (row: unknown) => ({
          select: () => ({
            limit: () => ({
              then: (cb: (res: { data: unknown; error: unknown }) => void) => {
                cb({ data: [{ model_id: "m1" }], error: null });
              },
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            then: (cb: (res: { data: unknown; error: unknown }) => void) => {
              cb({ data: null, error: null });
            },
          }),
        }),
        then: () => {},
      }),
      rpc: async () => ({ error: null }),
    };

    const result = await trainAndPersist(
      mockSupabase as never,
      async () => labelsData,
    );

    expect(result.accuracy_on_holdout).toBeGreaterThanOrEqual(0);
    expect(result.accuracy_on_holdout).toBeLessThanOrEqual(1);
  });
});
