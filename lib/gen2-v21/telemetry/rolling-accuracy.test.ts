import { describe, it, expect, vi } from "vitest";
import { computeRollingAccuracy } from "./rolling-accuracy.js";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

interface MockLabel {
  label_id: string;
  listing_id: string;
  operator_verdict: string;
  model_prediction_at_time: number | null;
  created_at: string;
}

function makeSupabase(rows: MockLabel[], error: { message: string } | null = null) {
  const terminal = { limit: vi.fn().mockResolvedValue({ data: rows, error }) };
  const withEq = { eq: vi.fn(() => terminal), limit: terminal.limit };
  const ordered = { order: vi.fn(() => withEq) };

  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ordered),
    })),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rolling-accuracy", () => {
  it("computes correct accuracy when predictions align with verdicts", async () => {
    const rows: MockLabel[] = [
      { label_id: "1", listing_id: "lst-1", operator_verdict: "good", model_prediction_at_time: 0.9, created_at: "2026-05-01T00:00:00Z" },
      { label_id: "2", listing_id: "lst-1", operator_verdict: "good", model_prediction_at_time: 0.7, created_at: "2026-05-02T00:00:00Z" },
      { label_id: "3", listing_id: "lst-1", operator_verdict: "bad",  model_prediction_at_time: 0.2, created_at: "2026-05-03T00:00:00Z" },
      { label_id: "4", listing_id: "lst-1", operator_verdict: "bad",  model_prediction_at_time: 0.4, created_at: "2026-05-04T00:00:00Z" },
    ];

    const sb = makeSupabase(rows);
    const result = await computeRollingAccuracy(sb, { lastN: 20 });

    expect(result.sampleSize).toBe(4);
    expect(result.predictionsMade).toBe(4);
    expect(result.accuracy).toBe(1.0); // all correct
  });

  it("ignores rows where model_prediction_at_time is null (cold-start rows)", async () => {
    const rows: MockLabel[] = [
      { label_id: "1", listing_id: "lst-1", operator_verdict: "good", model_prediction_at_time: null, created_at: "2026-05-01T00:00:00Z" },
      { label_id: "2", listing_id: "lst-1", operator_verdict: "good", model_prediction_at_time: null, created_at: "2026-05-02T00:00:00Z" },
      { label_id: "3", listing_id: "lst-1", operator_verdict: "good", model_prediction_at_time: 0.8,  created_at: "2026-05-03T00:00:00Z" },
    ];

    const sb = makeSupabase(rows);
    const result = await computeRollingAccuracy(sb, { lastN: 20 });

    // Only the 3rd row has a prediction
    expect(result.sampleSize).toBe(1);
    expect(result.predictionsMade).toBe(3);
    expect(result.accuracy).toBe(1.0);
  });

  it("excludes 'tie' verdicts from accuracy calculation", async () => {
    const rows: MockLabel[] = [
      { label_id: "1", listing_id: "lst-1", operator_verdict: "tie",  model_prediction_at_time: 0.6, created_at: "2026-05-01T00:00:00Z" },
      { label_id: "2", listing_id: "lst-1", operator_verdict: "good", model_prediction_at_time: 0.3, created_at: "2026-05-02T00:00:00Z" }, // wrong
      { label_id: "3", listing_id: "lst-1", operator_verdict: "bad",  model_prediction_at_time: 0.2, created_at: "2026-05-03T00:00:00Z" }, // correct
    ];

    const sb = makeSupabase(rows);
    const result = await computeRollingAccuracy(sb, { lastN: 20 });

    // Only rows 2 and 3 are scoreable (tie excluded); row 3 correct, row 2 wrong
    expect(result.sampleSize).toBe(2);
    expect(result.accuracy).toBe(0.5);
  });

  it("returns accuracy=0 and sampleSize=0 when all predictions are null", async () => {
    const rows: MockLabel[] = [
      { label_id: "1", listing_id: "lst-1", operator_verdict: "good", model_prediction_at_time: null, created_at: "2026-05-01T00:00:00Z" },
    ];

    const sb = makeSupabase(rows);
    const result = await computeRollingAccuracy(sb, { lastN: 20 });

    expect(result.accuracy).toBe(0);
    expect(result.sampleSize).toBe(0);
    expect(result.predictionsMade).toBe(1);
  });

  it("throws when supabase query returns an error", async () => {
    const sb = makeSupabase([], { message: "connection timeout" });
    await expect(
      computeRollingAccuracy(sb, { lastN: 50 }),
    ).rejects.toThrow("connection timeout");
  });

  it("supports listingId scoping (passes eq filter to query)", async () => {
    // Chain: from().select().order().eq("listing_id", ...).limit()
    const eqSpy = vi.fn(() => ({
      limit: vi.fn().mockResolvedValue({
        data: [
          { label_id: "1", listing_id: "lst-X", operator_verdict: "good", model_prediction_at_time: 0.9, created_at: "2026-05-01T00:00:00Z" },
        ],
        error: null,
      }),
    }));

    const sb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            eq: eqSpy,
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
      })),
    } as any;

    const result = await computeRollingAccuracy(sb, { listingId: "lst-X", lastN: 20 });

    // eq was called with ("listing_id", "lst-X")
    expect(eqSpy).toHaveBeenCalledWith("listing_id", "lst-X");
    // and returns 1 correct prediction
    expect(result.sampleSize).toBe(1);
    expect(result.accuracy).toBe(1.0);
  });
});
