/**
 * Tests for reapStuckGeneratingDeliveryRuns (lib/pipeline/stuck-reaper.ts).
 *
 * Recovery for a delivery_run pinned at stage='generating' with error=NULL —
 * the post-Checkpoint-A decouple failure modes:
 *   - ZERO scenes for the property → dead → setRunError.
 *   - ALL scenes needs_review with no clip_url → dead → setRunError.
 *   - A healthy in-progress run (scenes pending/generating/qc_pass with task_ids,
 *     or any clip_url present) → LEFT ALONE (no setRunError). This is the
 *     critical no-false-positive guard.
 *
 * Mock strategy mirrors buildGeneratingPropertiesDb in stuck-reaper.test.ts:
 *   1. db.from("delivery_runs").select(...).eq("stage","generating").is("error",null).lt("updated_at",cutoff)
 *   2. per run: db.from("scenes").select("status, clip_url").eq("property_id", pid)
 *   3. setRunError(runId, reason) — dynamically imported from lib/delivery/runs.js, mocked here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  reapStuckGeneratingDeliveryRuns,
  DELIVERY_GENERATING_STUCK_MINUTES,
} from "../stuck-reaper.js";

// reapStuckGeneratingDeliveryRuns dynamically imports lib/delivery/runs.js for
// setRunError. Hoist the mock so it's in place before the reaper imports it.
const mockSetRunError = vi.fn();
vi.mock("../../delivery/runs.js", () => ({
  setRunError: (...a: unknown[]) => mockSetRunError(...a),
}));

beforeEach(() => {
  mockSetRunError.mockReset();
  mockSetRunError.mockResolvedValue(undefined);
  // Non-prod write guard: production so the reaper executes.
  process.env.VERCEL_ENV = "production";
});
afterEach(() => {
  delete process.env.VERCEL_ENV;
});

/**
 * Builds a Supabase mock for reapStuckGeneratingDeliveryRuns.
 *   - First .from() call → delivery_runs select (terminal .lt()).
 *   - Subsequent .from() calls → scenes select (terminal .eq(property_id)),
 *     made thenable so `await chain` resolves with scene rows.
 */
function buildDb(opts: {
  runRows: Array<{ id: string; property_id: string; updated_at: string }>;
  sceneRowsByProperty: Record<string, Array<{ status: string; clip_url: string | null }>>;
  runSelectError?: { message: string } | null;
  sceneSelectError?: { message: string } | null;
}) {
  let fromCallCount = 0;

  const fromSpy = vi.fn().mockImplementation((table: string) => {
    fromCallCount++;
    if (fromCallCount === 1) {
      // delivery_runs select — terminal is .lt()
      const chain: Record<string, unknown> = {};
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.is = vi.fn().mockReturnValue(chain);
      chain.lt = vi.fn().mockResolvedValue({
        data: opts.runRows,
        error: opts.runSelectError ?? null,
      });
      return { select: vi.fn().mockReturnValue(chain) };
    }
    // scenes select — terminal is .eq("property_id", pid). We capture the
    // property id from that .eq() call to return the right scene set, and make
    // the chain thenable.
    let capturedPid = "";
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn().mockImplementation((col: string, val: string) => {
      if (col === "property_id") capturedPid = val;
      return chain;
    });
    chain.is = vi.fn().mockReturnValue(chain);
    chain.not = vi.fn().mockReturnValue(chain);
    chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
      const result = {
        data: opts.sceneRowsByProperty[capturedPid] ?? [],
        error: opts.sceneSelectError ?? null,
      };
      resolve(result);
      return Promise.resolve(result);
    });
    return { select: vi.fn().mockReturnValue(chain) };
  });

  return { from: fromSpy } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("reapStuckGeneratingDeliveryRuns", () => {
  const NOW = new Date("2026-06-18T12:00:00Z");

  /** A run updated past the stuck threshold (old enough to inspect). */
  function stuckRun(id: string, propertyId: string): { id: string; property_id: string; updated_at: string } {
    return {
      id,
      property_id: propertyId,
      updated_at: new Date(NOW.getTime() - (DELIVERY_GENERATING_STUCK_MINUTES + 5) * 60 * 1000).toISOString(),
    };
  }

  it("(ii-a) zero-scene generating run → setRunError, reaped", async () => {
    const db = buildDb({
      runRows: [stuckRun("run-zero", "prop-zero")],
      sceneRowsByProperty: { "prop-zero": [] },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual(["run-zero"]);
    expect(mockSetRunError).toHaveBeenCalledTimes(1);
    expect(mockSetRunError).toHaveBeenCalledWith(
      "run-zero",
      expect.stringMatching(/no scenes were created/i),
    );
  });

  it("(ii-b) all-needs_review-no-clip run → setRunError, reaped", async () => {
    const db = buildDb({
      runRows: [stuckRun("run-nr", "prop-nr")],
      sceneRowsByProperty: {
        "prop-nr": [
          { status: "needs_review", clip_url: null },
          { status: "needs_review", clip_url: null },
          { status: "needs_review", clip_url: null },
        ],
      },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual(["run-nr"]);
    expect(mockSetRunError).toHaveBeenCalledTimes(1);
    expect(mockSetRunError).toHaveBeenCalledWith(
      "run-nr",
      expect.stringMatching(/all scenes need review with no clip/i),
    );
  });

  it("(ii-c) healthy in-progress run (pending/generating scenes) → LEFT ALONE", async () => {
    const db = buildDb({
      runRows: [stuckRun("run-healthy", "prop-healthy")],
      sceneRowsByProperty: {
        "prop-healthy": [
          { status: "generating", clip_url: null }, // submitted, awaiting clip
          { status: "pending", clip_url: null },
          { status: "qc_pass", clip_url: "https://cdn.test/clip.mp4" },
        ],
      },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
    expect(mockSetRunError).not.toHaveBeenCalled();
  });

  it("(ii-c2) a needs_review run that has at least one clip_url → LEFT ALONE (partial success)", async () => {
    const db = buildDb({
      runRows: [stuckRun("run-partial", "prop-partial")],
      sceneRowsByProperty: {
        "prop-partial": [
          { status: "needs_review", clip_url: null },
          { status: "needs_review", clip_url: "https://cdn.test/ok.mp4" },
        ],
      },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result.reaped).toBe(0);
    expect(mockSetRunError).not.toHaveBeenCalled();
  });

  it("non-prod write guard: no env → returns {0,[]} and never writes", async () => {
    delete process.env.VERCEL_ENV;
    const db = buildDb({
      runRows: [stuckRun("run-guard", "prop-guard")],
      sceneRowsByProperty: { "prop-guard": [] },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result).toEqual({ reaped: 0, ids: [] });
    expect(mockSetRunError).not.toHaveBeenCalled();
  });

  it("mixed batch: dead run annotated, healthy run untouched", async () => {
    const db = buildDb({
      runRows: [
        stuckRun("run-dead", "prop-dead"),
        stuckRun("run-ok", "prop-ok"),
      ],
      sceneRowsByProperty: {
        "prop-dead": [],
        "prop-ok": [{ status: "generating", clip_url: null }],
      },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual(["run-dead"]);
    expect(mockSetRunError).toHaveBeenCalledTimes(1);
    expect(mockSetRunError).toHaveBeenCalledWith("run-dead", expect.any(String));
  });

  it("no stuck runs → {0,[]} without touching setRunError", async () => {
    const db = buildDb({ runRows: [], sceneRowsByProperty: {} });
    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);
    expect(result).toEqual({ reaped: 0, ids: [] });
    expect(mockSetRunError).not.toHaveBeenCalled();
  });
});
