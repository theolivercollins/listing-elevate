import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock picker trainAndPersist
vi.mock("../picker/index.js", () => ({
  trainAndPersist: vi.fn().mockResolvedValue({ model_id: "model-abc123", accuracy_on_holdout: 0.82 }),
  extractFeatures: vi.fn(),
  heuristicScore: vi.fn(),
  trainPicker: vi.fn(),
  predict: vi.fn(),
  featureImportance: vi.fn(),
  shouldRetrain: vi.fn(),
}));

import { triggerRetrainIfReady } from "./retrain-hook.js";
import { trainAndPersist } from "../picker/index.js";
import type { PickerFeatures } from "../types.js";

const SAMPLE_FEATURES: PickerFeatures = {
  same_room: 1,
  portal_distance: 0,
  shot_type_delta: 0.25,
  zoom_delta: 0.25,
  focal_subject_overlap: 0.8,
  lighting_delta: 0.1,
  embedding_cosine_sim: 0.9,
  bearing_compatibility_score: 0.7,
  portal_centeredness: 0.5,
  is_open_path_flag: 1,
};

function makeOutcomeRow(id: string, labelId: string, score: number) {
  return { outcome_id: id, pair_label_id: labelId, judge_score: score };
}

function makeLabelRow(labelId: string) {
  return {
    label_id: labelId,
    listing_id: "listing-1",
    features_blob: SAMPLE_FEATURES,
    operator_verdict: "good",
  };
}

function buildSupabase(config: {
  activeModelLabelCount?: number;
  judgedCount?: number;
  outcomes?: Array<{ outcome_id: string; pair_label_id: string; judge_score: number }>;
  labels?: Array<{ label_id: string; listing_id: string; features_blob: PickerFeatures; operator_verdict: string }>;
}) {
  const {
    activeModelLabelCount = 0,
    outcomes = [],
    labels = [],
  } = config;

  const makeBuilder = (tableName: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn().mockReturnThis();
    builder.update = vi.fn().mockReturnThis();
    builder.insert = vi.fn().mockReturnThis();
    builder.eq = vi.fn().mockReturnThis();
    builder.neq = vi.fn().mockReturnThis();
    builder.not = vi.fn().mockReturnThis();
    builder.order = vi.fn().mockReturnThis();
    builder.limit = vi.fn().mockReturnThis();
    builder.then = vi.fn().mockImplementation((resolve: (res: unknown) => void) => {
      if (tableName === "gen2_picker_models") {
        resolve({ data: [{ label_count_at_train: activeModelLabelCount }], error: null });
      } else if (tableName === "gen2_render_outcomes") {
        resolve({ data: outcomes, error: null });
      } else if (tableName === "gen2_pair_labels") {
        resolve({ data: labels, error: null });
      } else {
        resolve({ data: [], error: null });
      }
    });
    return builder;
  };

  return {
    from: vi.fn().mockImplementation((tableName: string) => makeBuilder(tableName)),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("triggerRetrainIfReady", () => {
  it("returns retrained=false when fewer than 10 new outcomes", async () => {
    const supabase = buildSupabase({
      activeModelLabelCount: 0,
      outcomes: [makeOutcomeRow("o1", "l1", 0.9)], // only 1
      labels: [makeLabelRow("l1")],
    });

    const result = await triggerRetrainIfReady(supabase);
    expect(result.retrained).toBe(false);
    expect(trainAndPersist).not.toHaveBeenCalled();
  });

  it("triggers retrain when >= 10 new judged outcomes exist", async () => {
    const outcomes = Array.from({ length: 12 }, (_, i) =>
      makeOutcomeRow(`o${i}`, `l${i}`, i >= 6 ? 0.9 : 0.3),
    );
    const labels = Array.from({ length: 12 }, (_, i) => makeLabelRow(`l${i}`));

    const supabase = buildSupabase({
      activeModelLabelCount: 0,
      outcomes,
      labels,
    });

    const result = await triggerRetrainIfReady(supabase);
    expect(result.retrained).toBe(true);
    expect(result.model_id).toBe("model-abc123");
    expect(trainAndPersist).toHaveBeenCalledOnce();
  });

  it("does not retrain when current count minus last train count < 10", async () => {
    const outcomes = Array.from({ length: 12 }, (_, i) =>
      makeOutcomeRow(`o${i}`, `l${i}`, 0.9),
    );
    const labels = Array.from({ length: 12 }, (_, i) => makeLabelRow(`l${i}`));

    const supabase = buildSupabase({
      activeModelLabelCount: 10, // already trained at 10; 12-10 = 2 new
      outcomes,
      labels,
    });

    const result = await triggerRetrainIfReady(supabase);
    expect(result.retrained).toBe(false);
    expect(trainAndPersist).not.toHaveBeenCalled();
  });

  it("high judge_score outcomes are weighted 2x (training rows duplicated)", async () => {
    const outcomes = Array.from({ length: 10 }, (_, i) =>
      makeOutcomeRow(`o${i}`, `l${i}`, 0.9), // all high-score
    );
    const labels = Array.from({ length: 10 }, (_, i) => makeLabelRow(`l${i}`));

    const supabase = buildSupabase({
      activeModelLabelCount: 0,
      outcomes,
      labels,
    });

    await triggerRetrainIfReady(supabase);

    expect(trainAndPersist).toHaveBeenCalledOnce();
    // Capture the labelsQuery argument and verify it produces 2x rows
    const callArgs = (trainAndPersist as ReturnType<typeof vi.fn>).mock.calls[0];
    const labelsQuery: () => Promise<unknown[]> = callArgs[1];
    const rows = await labelsQuery();
    // 10 high-score outcomes × 2 weight = 20 training rows
    expect(rows).toHaveLength(20);
  });

  it("low judge_score outcomes contribute with weight 1x (target=0)", async () => {
    const outcomes = Array.from({ length: 10 }, (_, i) =>
      makeOutcomeRow(`o${i}`, `l${i}`, 0.3), // all low-score
    );
    const labels = Array.from({ length: 10 }, (_, i) => makeLabelRow(`l${i}`));

    const supabase = buildSupabase({
      activeModelLabelCount: 0,
      outcomes,
      labels,
    });

    await triggerRetrainIfReady(supabase);

    const callArgs = (trainAndPersist as ReturnType<typeof vi.fn>).mock.calls[0];
    const labelsQuery: () => Promise<unknown[]> = callArgs[1];
    const rows = await labelsQuery();
    // 10 low-score outcomes × 1 weight = 10 training rows
    expect(rows).toHaveLength(10);
    // All should have target=0
    for (const row of rows as Array<{ target: number }>) {
      expect(row.target).toBe(0);
    }
  });
});
