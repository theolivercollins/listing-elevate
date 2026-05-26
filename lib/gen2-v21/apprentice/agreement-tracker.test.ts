/**
 * Tests for agreement-tracker.
 */

import { describe, it, expect } from "vitest";
import type { ApprenticePrediction, PairLabel } from "../types.js";
import { computeAgreementRate } from "./agreement-tracker.js";

function makePrediction(
  candidateId: string,
  verdict: "good" | "bad" | "tie",
  overrides: Partial<ApprenticePrediction> = {},
): ApprenticePrediction {
  return {
    candidate_id: candidateId,
    predicted_verdict: verdict,
    predicted_transition_tag: null,
    confidence: 0.8,
    reasoning: "test",
    model_version: "gemini-2.5-pro",
    few_shot_label_ids: [],
    ...overrides,
  };
}

function makeLabel(
  labelId: string,
  verdict: "good" | "bad" | "tie",
  overrides: Partial<PairLabel> = {},
): PairLabel {
  return {
    label_id: labelId,
    listing_id: "listing-abc",
    photo_a_id: `photo-a-${labelId}`,
    photo_b_id: `photo-b-${labelId}`,
    scene_graph_version: "v1",
    model_version_at_prediction: null,
    model_prediction_at_time: null,
    operator_verdict: verdict,
    transition_tag: null,
    thumbnail_hash_a: "hash-a",
    thumbnail_hash_b: "hash-b",
    source_mode: "directors_cut",
    apprentice_predicted_verdict: null,
    apprentice_was_wrong: null,
    created_at: "2026-05-23T10:00:00Z",
    ...overrides,
  };
}

describe("computeAgreementRate", () => {
  it("joins predictions to labels by candidate_id === label_id", () => {
    const predictions = [
      makePrediction("cand-001", "good"),
      makePrediction("cand-002", "bad"),
      makePrediction("cand-003", "good"),
    ];
    const labels = [
      makeLabel("cand-001", "good"),  // agree
      makeLabel("cand-002", "good"),  // disagree
      makeLabel("cand-003", "good"),  // agree
    ];

    const result = computeAgreementRate(predictions, labels);
    expect(result.total).toBeCloseTo(2 / 3, 3);
  });

  it("handles partial matches — only joined pairs count", () => {
    const predictions = [
      makePrediction("cand-001", "good"),
      makePrediction("cand-002", "bad"),
      makePrediction("cand-999", "good"), // no matching label
    ];
    const labels = [
      makeLabel("cand-001", "good"),  // agree
      makeLabel("cand-002", "bad"),   // agree
      // cand-999 has no label
    ];

    const result = computeAgreementRate(predictions, labels);
    // 2/2 matched, both agree
    expect(result.total).toBeCloseTo(1.0, 3);
  });

  it("computes rolling20 window over last 20 entries", () => {
    // 30 predictions, last 20 all agree, first 10 all disagree
    const predictions: ApprenticePrediction[] = [];
    const labels: PairLabel[] = [];

    for (let i = 0; i < 10; i++) {
      predictions.push(makePrediction(`cand-${i}`, "good"));
      labels.push(makeLabel(`cand-${i}`, "bad")); // disagree
    }
    for (let i = 10; i < 30; i++) {
      predictions.push(makePrediction(`cand-${i}`, "good"));
      labels.push(makeLabel(`cand-${i}`, "good")); // agree
    }

    const result = computeAgreementRate(predictions, labels);
    expect(result.rolling20).toBeCloseTo(1.0, 3); // last 20 all agree
    expect(result.rolling50).toBeCloseTo(20 / 30, 3); // 20/30 total
  });

  it("returns zeros when no matching labels", () => {
    const predictions = [makePrediction("cand-001", "good")];
    const labels = [makeLabel("no-match", "good")];

    const result = computeAgreementRate(predictions, labels);
    expect(result.rolling20).toBe(0);
    expect(result.rolling50).toBe(0);
    expect(result.total).toBe(0);
  });

  it("handles empty inputs gracefully", () => {
    expect(computeAgreementRate([], [])).toEqual({ rolling20: 0, rolling50: 0, total: 0 });
    expect(computeAgreementRate([], [makeLabel("x", "good")])).toEqual({
      rolling20: 0,
      rolling50: 0,
      total: 0,
    });
    expect(computeAgreementRate([makePrediction("x", "good")], [])).toEqual({
      rolling20: 0,
      rolling50: 0,
      total: 0,
    });
  });
});
