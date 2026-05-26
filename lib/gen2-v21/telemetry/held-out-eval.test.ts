import { describe, it, expect, vi } from "vitest";
import { runHeldOutEval } from "./held-out-eval.js";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

interface MockLabel {
  label_id: string;
  listing_id: string;
  operator_verdict: string;
  model_prediction_at_time: number | null;
}

function makeSupabase(rows: MockLabel[], error: { message: string } | null = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        not: vi.fn(() => ({
          neq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: rows, error }),
          })),
        })),
      })),
    })),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("held-out-eval", () => {
  it("splits labels by listing_id (NOT by individual label)", async () => {
    // 5 listings (lst-1..5), 2 labels each = 10 total
    // 80% train = lst-1..4, 20% held-out = lst-5
    const rows: MockLabel[] = [];
    for (let l = 1; l <= 5; l++) {
      for (let i = 0; i < 2; i++) {
        rows.push({
          label_id: `lbl-${l}-${i}`,
          listing_id: `lst-${l}`,
          operator_verdict: "good",
          model_prediction_at_time: 0.9, // all correct
        });
      }
    }

    const sb = makeSupabase(rows);
    const result = await runHeldOutEval(sb);

    // 5 listings → floor(5*0.8)=4 train, 1 held-out
    expect(result.trainedListings).toBe(4);
    expect(result.heldOutListings).toBe(1);
    expect(result.accuracyOnHeldout).toBe(1.0);
  });

  it("computes accuracy only on held-out listing labels (not training labels)", async () => {
    // 10 listings: train 8, held-out 2.
    // Held-out listings have wrong predictions (pred 0.8 but verdict "bad").
    const rows: MockLabel[] = [];
    for (let l = 1; l <= 8; l++) {
      rows.push({
        label_id: `lbl-train-${l}`,
        listing_id: `lst-${String(l).padStart(2, "0")}`,
        operator_verdict: "good",
        model_prediction_at_time: 0.9, // correct in train
      });
    }
    // Held-out listings (lst-09, lst-10) — wrong predictions
    for (let l = 9; l <= 10; l++) {
      rows.push({
        label_id: `lbl-held-${l}`,
        listing_id: `lst-${String(l).padStart(2, "0")}`,
        operator_verdict: "bad",
        model_prediction_at_time: 0.8, // wrong: pred >= 0.5 but verdict is bad
      });
    }

    const sb = makeSupabase(rows);
    const result = await runHeldOutEval(sb);

    expect(result.trainedListings).toBe(8);
    expect(result.heldOutListings).toBe(2);
    // Both held-out labels are wrong → accuracy 0
    expect(result.accuracyOnHeldout).toBe(0);
  });

  it("returns zero accuracy and zero counts when no labels exist", async () => {
    const sb = makeSupabase([]);
    const result = await runHeldOutEval(sb);

    expect(result.accuracyOnHeldout).toBe(0);
    expect(result.trainedListings).toBe(0);
    expect(result.heldOutListings).toBe(0);
  });

  it("returns zero heldOutListings when only one listing exists (insufficient for split)", async () => {
    const rows: MockLabel[] = [
      { label_id: "lbl-1", listing_id: "lst-only", operator_verdict: "good", model_prediction_at_time: 0.9 },
      { label_id: "lbl-2", listing_id: "lst-only", operator_verdict: "bad",  model_prediction_at_time: 0.2 },
    ];

    const sb = makeSupabase(rows);
    const result = await runHeldOutEval(sb);

    expect(result.heldOutListings).toBe(0);
    expect(result.accuracyOnHeldout).toBe(0);
  });

  it("is idempotent: calling twice returns same result", async () => {
    const rows: MockLabel[] = [];
    for (let l = 1; l <= 5; l++) {
      rows.push({
        label_id: `lbl-${l}`,
        listing_id: `lst-${l}`,
        operator_verdict: l % 2 === 0 ? "good" : "bad",
        model_prediction_at_time: l % 2 === 0 ? 0.8 : 0.2, // all correct
      });
    }

    const sb1 = makeSupabase(rows);
    const sb2 = makeSupabase(rows);

    const r1 = await runHeldOutEval(sb1);
    const r2 = await runHeldOutEval(sb2);

    expect(r1.accuracyOnHeldout).toBe(r2.accuracyOnHeldout);
    expect(r1.trainedListings).toBe(r2.trainedListings);
    expect(r1.heldOutListings).toBe(r2.heldOutListings);
  });

  it("throws when supabase query returns an error", async () => {
    const sb = makeSupabase([], { message: "query failed" });
    await expect(runHeldOutEval(sb)).rejects.toThrow("query failed");
  });
});
