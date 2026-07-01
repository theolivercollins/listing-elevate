/**
 * Tests for reapStuckGeneratingDeliveryRuns (lib/pipeline/stuck-reaper.ts).
 *
 * Recovery for a delivery_run pinned at stage='generating' with error=NULL.
 * Three paths:
 *
 *   Path A — ZERO scenes (director/submit never ran — the HTTP hop dropped):
 *     • Within DELIVERY_GENERATING_REFIRE_WINDOW_MINUTES (45 min from created_at):
 *       autonomously re-fire continuePipelineAfterPhotoSelection (cap: 1 per tick).
 *     • Past the window: give up → setRunError + updatePropertyStatus('failed').
 *
 *   Path B — ALL scenes needs_review with no clip_url (providers all failed):
 *     • Only after DELIVERY_GENERATING_STUCK_MINUTES (15 min from updated_at):
 *       setRunError + updatePropertyStatus('needs_review').
 *     • Before 15 min: skip (may still be mid-render).
 *     • If the run's error is already RESUME_BALANCE_ERROR (set at submit time
 *       by resumeRunErrorAction in ../pipeline.ts on an Atlas 402): skip —
 *       never overwrite the actionable balance message with the generic one.
 *
 *   Path C — Otherwise (some scene progressing or has a clip):
 *     • Left alone — no-false-positive guard.
 *
 * Mock strategy mirrors buildGeneratingPropertiesDb in stuck-reaper.test.ts:
 *   1. db.from("delivery_runs").select(...).eq("stage","generating").is("error",null).lt("updated_at",cutoff)
 *   2. per run: db.from("scenes").select("status, clip_url").eq("property_id", pid)
 *   3. Dynamic imports mocked via vi.mock hoisted to file top.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  reapStuckGeneratingDeliveryRuns,
  DELIVERY_GENERATING_STUCK_MINUTES,
  DELIVERY_GENERATING_REFIRE_MINUTES,
  DELIVERY_GENERATING_REFIRE_WINDOW_MINUTES,
} from "../stuck-reaper.js";
// Real (unmocked) import — a pure string constant, no side effects on load.
// Keeps the "already-actionable" test below in sync with the real message
// instead of duplicating the literal string.
import { RESUME_BALANCE_ERROR } from "../../pipeline.js";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// These must be declared before vi.mock calls because vi.mock factory functions
// run lazily but are hoisted to the top of the file by the test runner.

const mockSetRunError = vi.fn();
const mockResumeGeneratingUnderLease = vi.fn();
const mockUpdatePropertyStatus = vi.fn();

// reapStuckGeneratingDeliveryRuns dynamically imports lib/delivery/runs.js and,
// for the Path A zero-scene re-fire, lib/delivery/resume-generation.js (the
// shared per-run resolve-lease mutex). Hoist the mocks so they are in place
// before the reaper resolves its dynamic imports.
vi.mock("../../delivery/runs.js", () => ({
  setRunError: (...a: unknown[]) => mockSetRunError(...a),
}));

vi.mock("../../delivery/resume-generation.js", () => ({
  resumeGeneratingUnderLease: (...a: unknown[]) => mockResumeGeneratingUnderLease(...a),
}));

vi.mock("../../db.js", () => ({
  updatePropertyStatus: (...a: unknown[]) => mockUpdatePropertyStatus(...a),
}));

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockSetRunError.mockReset();
  mockSetRunError.mockResolvedValue(undefined);
  mockResumeGeneratingUnderLease.mockReset();
  // Default: the resolve lease is free → the re-fire runs, ran:true.
  mockResumeGeneratingUnderLease.mockResolvedValue({ ran: true, result: undefined });
  mockUpdatePropertyStatus.mockReset();
  mockUpdatePropertyStatus.mockResolvedValue(undefined);
  // Non-prod write guard: set production so the reaper executes.
  process.env.VERCEL_ENV = "production";
});

afterEach(() => {
  delete process.env.VERCEL_ENV;
});

// ── Mock builder ──────────────────────────────────────────────────────────────

type RunRow = {
  id: string;
  property_id: string;
  updated_at: string;
  created_at?: string;
  error?: string | null;
};

/**
 * Builds a Supabase mock for reapStuckGeneratingDeliveryRuns.
 *   - First .from() call → delivery_runs select (terminal .lt()).
 *   - Subsequent .from() calls → scenes select (terminal .eq(property_id)),
 *     made thenable so `await chain` resolves with scene rows.
 */
function buildDb(opts: {
  runRows: RunRow[];
  sceneRowsByProperty: Record<string, Array<{ status: string; clip_url: string | null }>>;
  runSelectError?: { message: string } | null;
  sceneSelectError?: { message: string } | null;
}) {
  let fromCallCount = 0;

  const fromSpy = vi.fn().mockImplementation((_table: string) => {
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
    // scenes select — terminal is .eq("property_id", pid). Capture the property
    // id from that .eq() call to return the right scene set, and make the chain
    // thenable so `await db.from("scenes").select(…).eq(…)` resolves.
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

// ── Shared run-row helpers ────────────────────────────────────────────────────

const NOW = new Date("2026-06-18T12:00:00Z");

/**
 * A run whose updated_at is DELIVERY_GENERATING_STUCK_MINUTES+5 (20 min) old.
 * updated_at and created_at are both 20 min ago, placing it within the 45-min
 * re-fire window (Path A → re-fire, not give-up).
 */
function stuckRun(id: string, propertyId: string): RunRow {
  const ts = new Date(NOW.getTime() - (DELIVERY_GENERATING_STUCK_MINUTES + 5) * 60_000).toISOString();
  return { id, property_id: propertyId, updated_at: ts, created_at: ts };
}

/** A run whose created_at is DELIVERY_GENERATING_REFIRE_WINDOW_MINUTES+5 (50 min) old — window exhausted. */
function exhaustedRun(id: string, propertyId: string): RunRow {
  const ts = new Date(NOW.getTime() - (DELIVERY_GENERATING_REFIRE_WINDOW_MINUTES + 5) * 60_000).toISOString();
  return { id, property_id: propertyId, updated_at: ts, created_at: ts };
}

/** A run that is n minutes old (both updated_at and created_at). */
function runAgeMin(id: string, propertyId: string, ageMin: number): RunRow {
  const ts = new Date(NOW.getTime() - ageMin * 60_000).toISOString();
  return { id, property_id: propertyId, updated_at: ts, created_at: ts };
}

/** A run where updated_at is updatedAgeMin old but created_at is createdAgeMin old. */
function runWithAges(
  id: string,
  propertyId: string,
  updatedAgeMin: number,
  createdAgeMin: number,
): RunRow {
  return {
    id,
    property_id: propertyId,
    updated_at: new Date(NOW.getTime() - updatedAgeMin * 60_000).toISOString(),
    created_at: new Date(NOW.getTime() - createdAgeMin * 60_000).toISOString(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("reapStuckGeneratingDeliveryRuns", () => {
  // ── Path A: zero-scene runs (re-fire / give-up) ───────────────────────────

  it("(ii-a) zero-scene run within recovery window (20 min) → re-fires under the lease, reaped, no setRunError", async () => {
    const db = buildDb({
      runRows: [stuckRun("run-zero", "prop-zero")],
      sceneRowsByProperty: { "prop-zero": [] },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual(["run-zero"]);
    expect(mockResumeGeneratingUnderLease).toHaveBeenCalledTimes(1);
    // resumeGeneratingUnderLease is keyed (runId, propertyId).
    expect(mockResumeGeneratingUnderLease).toHaveBeenCalledWith("run-zero", "prop-zero");
    expect(mockSetRunError).not.toHaveBeenCalled();
  });

  it("zero-scene run, 6 min old → re-fires once through the lease; no setRunError", async () => {
    const db = buildDb({
      runRows: [runAgeMin("run-6min", "prop-6min", 6)],
      sceneRowsByProperty: { "prop-6min": [] },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(mockResumeGeneratingUnderLease).toHaveBeenCalledTimes(1);
    expect(mockResumeGeneratingUnderLease).toHaveBeenCalledWith("run-6min", "prop-6min");
    expect(mockSetRunError).not.toHaveBeenCalled();
    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual(["run-6min"]);
  });

  it("zero-scene run, lease HELD by a concurrent resolver → skip cleanly: no setRunError, NOT reaped", async () => {
    // Another actor (a manual Resume or a prior tick still running the director)
    // holds the per-run lease → resumeGeneratingUnderLease reports ran:false.
    mockResumeGeneratingUnderLease.mockResolvedValueOnce({ ran: false });

    const db = buildDb({
      runRows: [runAgeMin("run-held", "prop-held", 6)],
      sceneRowsByProperty: { "prop-held": [] },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(mockResumeGeneratingUnderLease).toHaveBeenCalledTimes(1);
    // No error stamped, no property status change — pure skip, retries next tick.
    expect(mockSetRunError).not.toHaveBeenCalled();
    expect(mockUpdatePropertyStatus).not.toHaveBeenCalled();
    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
  });

  it("lease held on run A does NOT consume the tick's re-fire cap → run B still re-fires", async () => {
    // run-a's lease is held (skip), run-b's is free (re-fire). Because the skip
    // doesn't burn the 1-per-tick cap, run-b is still re-fired this tick.
    mockResumeGeneratingUnderLease
      .mockResolvedValueOnce({ ran: false })              // run-a: lease held
      .mockResolvedValueOnce({ ran: true, result: undefined }); // run-b: fired

    const db = buildDb({
      runRows: [
        runAgeMin("run-a", "prop-a", 6),
        runAgeMin("run-b", "prop-b", 6),
      ],
      sceneRowsByProperty: { "prop-a": [], "prop-b": [] },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(mockResumeGeneratingUnderLease).toHaveBeenNthCalledWith(1, "run-a", "prop-a");
    expect(mockResumeGeneratingUnderLease).toHaveBeenNthCalledWith(2, "run-b", "prop-b");
    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual(["run-b"]);
    expect(mockSetRunError).not.toHaveBeenCalled();
  });

  it("zero-scene run, window exhausted (50 min) → give-up: setRunError 'after auto-retry' + updatePropertyStatus 'failed'; no re-fire", async () => {
    const db = buildDb({
      runRows: [exhaustedRun("run-old", "prop-old")],
      sceneRowsByProperty: { "prop-old": [] },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual(["run-old"]);
    expect(mockResumeGeneratingUnderLease).not.toHaveBeenCalled();
    expect(mockSetRunError).toHaveBeenCalledTimes(1);
    expect(mockSetRunError).toHaveBeenCalledWith(
      "run-old",
      expect.stringMatching(/no scenes were created after auto-retry/i),
    );
    expect(mockUpdatePropertyStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdatePropertyStatus).toHaveBeenCalledWith("prop-old", "failed");
  });

  it("re-fire throws → setRunError 'auto-retry failed', still reaped", async () => {
    mockResumeGeneratingUnderLease.mockRejectedValueOnce(new Error("director timeout"));

    const db = buildDb({
      runRows: [runAgeMin("run-throws", "prop-throws", 6)],
      sceneRowsByProperty: { "prop-throws": [] },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(mockResumeGeneratingUnderLease).toHaveBeenCalledTimes(1);
    expect(mockSetRunError).toHaveBeenCalledTimes(1);
    expect(mockSetRunError).toHaveBeenCalledWith(
      "run-throws",
      expect.stringMatching(/auto-retry failed.*director timeout/i),
    );
    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual(["run-throws"]);
  });

  it("two eligible zero-scene runs → only ONE re-fire this tick (cap); second left for next tick", async () => {
    const db = buildDb({
      runRows: [
        runAgeMin("run-a", "prop-a", 6),
        runAgeMin("run-b", "prop-b", 6),
      ],
      sceneRowsByProperty: { "prop-a": [], "prop-b": [] },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    // Only the first run in iteration order is re-fired
    expect(mockResumeGeneratingUnderLease).toHaveBeenCalledTimes(1);
    expect(mockResumeGeneratingUnderLease).toHaveBeenCalledWith("run-a", "prop-a");
    expect(mockSetRunError).not.toHaveBeenCalled();
    // Second run is left untouched (no reaped++ for it)
    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual(["run-a"]);
  });

  // ── Path B: all-needs_review-no-clip runs (providers failed) ─────────────

  it("(ii-b) all-needs_review-no-clip run, 20 min old → setRunError + updatePropertyStatus 'needs_review', reaped", async () => {
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
    expect(mockUpdatePropertyStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdatePropertyStatus).toHaveBeenCalledWith("prop-nr", "needs_review");
    expect(mockResumeGeneratingUnderLease).not.toHaveBeenCalled();
  });

  it("all-needs_review-no-clip run, 16 min old → setRunError + updatePropertyStatus 'needs_review'", async () => {
    const db = buildDb({
      runRows: [runWithAges("run-pf-16", "prop-pf-16", 16, 16)],
      sceneRowsByProperty: {
        "prop-pf-16": [
          { status: "needs_review", clip_url: null },
          { status: "needs_review", clip_url: null },
        ],
      },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result.reaped).toBe(1);
    expect(mockSetRunError).toHaveBeenCalledWith(
      "run-pf-16",
      expect.stringMatching(/providers failed/i),
    );
    expect(mockUpdatePropertyStatus).toHaveBeenCalledWith("prop-pf-16", "needs_review");
  });

  it("all-needs_review-no-clip run, 20 min old, error already RESUME_BALANCE_ERROR → Path B does NOT overwrite it; actionable message survives", async () => {
    // A submit pass already set the more-actionable balance error (Atlas 402)
    // on this run. Path B must leave it in place instead of clobbering it with
    // the generic "providers failed" message 15 min later.
    const db = buildDb({
      runRows: [{ ...stuckRun("run-balance", "prop-balance"), error: RESUME_BALANCE_ERROR }],
      sceneRowsByProperty: {
        "prop-balance": [
          { status: "needs_review", clip_url: null },
          { status: "needs_review", clip_url: null },
        ],
      },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(mockSetRunError).not.toHaveBeenCalled();
    expect(mockUpdatePropertyStatus).not.toHaveBeenCalled();
    expect(mockResumeGeneratingUnderLease).not.toHaveBeenCalled();
    // Not counted as reaped this tick — a clean skip, same shape as the
    // lease-held skip in Path A.
    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
  });

  it("all-needs_review-no-clip run, 6 min old → no action (too early, may still be mid-render)", async () => {
    const db = buildDb({
      runRows: [runAgeMin("run-pf-6", "prop-pf-6", 6)],
      sceneRowsByProperty: {
        "prop-pf-6": [
          { status: "needs_review", clip_url: null },
          { status: "needs_review", clip_url: null },
        ],
      },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
    expect(mockSetRunError).not.toHaveBeenCalled();
    expect(mockUpdatePropertyStatus).not.toHaveBeenCalled();
  });

  // ── Path C: healthy / partial runs (no-false-positive guard) ─────────────

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
    expect(mockResumeGeneratingUnderLease).not.toHaveBeenCalled();
  });

  it("(ii-c2) run with at least one clip_url present → LEFT ALONE (partial success)", async () => {
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
    expect(mockResumeGeneratingUnderLease).not.toHaveBeenCalled();
  });

  it("run with a qc_pass scene → LEFT ALONE", async () => {
    const db = buildDb({
      runRows: [stuckRun("run-qcp", "prop-qcp")],
      sceneRowsByProperty: {
        "prop-qcp": [{ status: "qc_pass", clip_url: "https://cdn.test/ok.mp4" }],
      },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result.reaped).toBe(0);
    expect(mockSetRunError).not.toHaveBeenCalled();
    expect(mockResumeGeneratingUnderLease).not.toHaveBeenCalled();
  });

  // ── Mixed batch ───────────────────────────────────────────────────────────

  it("mixed batch: window-exhausted dead run annotated, healthy run untouched", async () => {
    const db = buildDb({
      runRows: [
        exhaustedRun("run-dead", "prop-dead"),
        stuckRun("run-ok", "prop-ok"),
      ],
      sceneRowsByProperty: {
        "prop-dead": [],                                        // give-up path
        "prop-ok": [{ status: "generating", clip_url: null }], // Path C → skip
      },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual(["run-dead"]);
    expect(mockSetRunError).toHaveBeenCalledTimes(1);
    expect(mockSetRunError).toHaveBeenCalledWith(
      "run-dead",
      expect.stringMatching(/after auto-retry/i),
    );
    expect(mockUpdatePropertyStatus).toHaveBeenCalledWith("prop-dead", "failed");
    expect(mockResumeGeneratingUnderLease).not.toHaveBeenCalled();
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("no stuck runs → {0,[]} without any writes", async () => {
    const db = buildDb({ runRows: [], sceneRowsByProperty: {} });
    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);
    expect(result).toEqual({ reaped: 0, ids: [] });
    expect(mockSetRunError).not.toHaveBeenCalled();
    expect(mockResumeGeneratingUnderLease).not.toHaveBeenCalled();
    expect(mockUpdatePropertyStatus).not.toHaveBeenCalled();
  });

  it("non-prod write guard: no VERCEL_ENV → returns {0,[]} and never writes", async () => {
    delete process.env.VERCEL_ENV;
    const db = buildDb({
      runRows: [runAgeMin("run-guard", "prop-guard", 6)],
      sceneRowsByProperty: { "prop-guard": [] },
    });

    const result = await reapStuckGeneratingDeliveryRuns(db, NOW);

    expect(result).toEqual({ reaped: 0, ids: [] });
    expect(mockSetRunError).not.toHaveBeenCalled();
    expect(mockResumeGeneratingUnderLease).not.toHaveBeenCalled();
    expect(mockUpdatePropertyStatus).not.toHaveBeenCalled();
  });

  it("LE_ALLOW_NONPROD_WRITES override → reaper executes even without VERCEL_ENV=production", async () => {
    delete process.env.VERCEL_ENV;
    process.env.LE_ALLOW_NONPROD_WRITES = "true";

    const db = buildDb({
      runRows: [exhaustedRun("run-override", "prop-override")],
      sceneRowsByProperty: { "prop-override": [] },
    });

    try {
      const result = await reapStuckGeneratingDeliveryRuns(db, NOW);
      expect(result.reaped).toBe(1);
    } finally {
      delete process.env.LE_ALLOW_NONPROD_WRITES;
    }
  });

  it("constants have expected values", () => {
    expect(DELIVERY_GENERATING_STUCK_MINUTES).toBe(15);
    expect(DELIVERY_GENERATING_REFIRE_MINUTES).toBe(5);
    expect(DELIVERY_GENERATING_REFIRE_WINDOW_MINUTES).toBe(45);
  });
});
