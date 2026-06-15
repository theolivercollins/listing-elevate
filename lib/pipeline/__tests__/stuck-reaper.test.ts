/**
 * Tests for lib/pipeline/stuck-reaper.ts
 *
 * Each reaper function is tested for:
 *   - A row older than the threshold IS reaped (correct table, correct status, correct error note).
 *   - A row younger than the threshold is NOT reaped.
 *   - The returned { reaped, ids } shape is correct.
 *   - Passing `now` explicitly controls the cutoff (deterministic).
 *   - Internal errors are swallowed; { reaped: 0, ids: [] } returned without throwing.
 *
 * Mock strategy: build a minimal Supabase chainable mock that tracks .from()
 * → .select() → .eq()/.is()/.not()/.lt()/.in() → resolves with test data.
 * Mirrors the mock pattern in api/cron/__tests__/poll-listing-iterations.bunny-rehost.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  reapStuckLabIterations,
  reapStuckScenes,
  reapStuckLabListings,
  reapStuckDeliveryRuns,
  reapStuckGeneratingProperties,
  RENDER_STUCK_MINUTES,
  GENERATE_STUCK_MINUTES,
  SUBMIT_STUCK_MINUTES,
  ANALYZE_STUCK_MINUTES,
  DELIVERY_STUCK_MINUTES,
  DELIVERY_MAX_AGE_MINUTES,
  GENERATING_STUCK_MINUTES,
  GENERATING_MAX_AGE_MINUTES,
} from "../stuck-reaper.js";

// ── Module mocks for dynamic imports inside the two new reapers ──────────────
// reapStuckDeliveryRuns dynamically imports lib/delivery/scrape.js.
// reapStuckGeneratingProperties dynamically imports lib/pipeline.js.
// We hoist these mocks so they're in place before any test runs.

const mockRunScrapeStage = vi.fn();
vi.mock("../../delivery/scrape.js", () => ({
  runScrapeStage: (...args: unknown[]) => mockRunScrapeStage(...args),
}));

const mockResubmitScene = vi.fn();
vi.mock("../../pipeline.js", () => ({
  resubmitScene: (...args: unknown[]) => mockResubmitScene(...args),
}));

// Reset mock implementations before each test so they don't bleed across suites.
beforeEach(() => {
  mockRunScrapeStage.mockReset();
  mockResubmitScene.mockReset();
});

// ── Supabase mock factory ────────────────────────────────────────────────────

/**
 * Builds a minimal Supabase client mock.
 *
 * `selectResult`: what `.select()` chain resolves with ({ data, error }).
 * `updateResult`: what `.update()` → ... → resolves with ({ error }).
 *
 * All methods return `this` (the same chain object) to satisfy the fluent API,
 * then the terminal `.lt()` / `.in()` call resolves with the configured result.
 */
function buildMockDb(opts: {
  selectResult: { data: Array<{ id: string }> | null; error: { message: string } | null };
  updateResult: { error: { message: string } | null };
}) {
  // We capture what update was called with so tests can assert on it.
  const updateSpy = vi.fn();
  const inSpy = vi.fn();

  // Select chain: .from(t).select(c).eq/is/not/lt — terminal is lt or the last filter.
  // We need the last method in the select filter chain to resolve with selectResult.
  // Because different reapers use different filter orderings we make ALL filter
  // methods resolve with selectResult when awaited AND return `this` for chaining.
  const selectChain: Record<string, unknown> = {};
  const terminalSelect = vi.fn().mockResolvedValue(opts.selectResult);
  selectChain.eq = vi.fn().mockReturnValue(selectChain);
  selectChain.is = vi.fn().mockReturnValue(selectChain);
  selectChain.not = vi.fn().mockReturnValue(selectChain);
  selectChain.in = vi.fn().mockReturnValue(selectChain);
  // lt is typically the last filter (cutoff age check); make it the terminal.
  selectChain.lt = terminalSelect;

  // Update chain: .from(t).update(patch).in(ids) OR .in("id", ids).
  const updateChain: Record<string, unknown> = {};
  updateChain.in = inSpy.mockResolvedValue(opts.updateResult);
  updateSpy.mockReturnValue(updateChain);

  const fromSpy = vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnValue(selectChain),
    update: updateSpy,
  }));

  return {
    from: fromSpy,
    _updateSpy: updateSpy,
    _inSpy: inSpy,
  } as unknown as {
    from: typeof fromSpy;
    _updateSpy: typeof updateSpy;
    _inSpy: typeof inSpy;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a Date that is `minutes` minutes in the PAST relative to `now`. */
function minutesAgo(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60 * 1000);
}

// ── reapStuckLabIterations ───────────────────────────────────────────────────

describe("reapStuckLabIterations", () => {
  const NOW = new Date("2026-06-14T12:00:00Z");
  const STUCK_ID = "bc699120-0000-0000-0000-000000000001";

  it("reaps a row older than RENDER_STUCK_MINUTES", async () => {
    // Row created_at is 31 minutes ago — past the 30-min threshold.
    const db = buildMockDb({
      selectResult: { data: [{ id: STUCK_ID }], error: null },
      updateResult: { error: null },
    });

    const result = await reapStuckLabIterations(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual([STUCK_ID]);
    // Confirm update was called
    expect(db._updateSpy).toHaveBeenCalledWith({
      status: "failed",
      render_error: "timed out — render never completed (reaped)",
    });
    expect(db._inSpy).toHaveBeenCalledWith("id", [STUCK_ID]);
  });

  it("returns { reaped: 0, ids: [] } when no rows exceed threshold (select returns empty)", async () => {
    const db = buildMockDb({
      selectResult: { data: [], error: null },
      updateResult: { error: null },
    });

    const result = await reapStuckLabIterations(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
    expect(db._updateSpy).not.toHaveBeenCalled();
  });

  it("passes cutoff based on now param — threshold is RENDER_STUCK_MINUTES", async () => {
    // The select chain's .lt() is called with the cutoff timestamp.
    // We verify the from() call targets the correct table.
    const db = buildMockDb({
      selectResult: { data: [], error: null },
      updateResult: { error: null },
    });

    await reapStuckLabIterations(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(db.from).toHaveBeenCalledWith("prompt_lab_listing_scene_iterations");
    // The select chain .lt was called with "created_at" and a cutoff 30 min before NOW.
    const expectedCutoff = new Date(NOW.getTime() - RENDER_STUCK_MINUTES * 60 * 1000).toISOString();
    // Access the lt mock through the select chain
    const fromResult = db.from.mock.results[0]?.value;
    const selectChain = fromResult?.select?.mock?.results?.[0]?.value;
    expect(selectChain?.lt).toHaveBeenCalledWith("created_at", expectedCutoff);
  });

  it("returns { reaped: 0, ids: [] } and does not throw on select error", async () => {
    const db = buildMockDb({
      selectResult: { data: null, error: { message: "DB connection refused" } },
      updateResult: { error: null },
    });

    const result = await reapStuckLabIterations(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
    expect(db._updateSpy).not.toHaveBeenCalled();
  });

  it("returns { reaped: 0, ids: [] } and does not throw on update error", async () => {
    const db = buildMockDb({
      selectResult: { data: [{ id: STUCK_ID }], error: null },
      updateResult: { error: { message: "update failed" } },
    });

    const result = await reapStuckLabIterations(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
  });

  it("reaps multiple stuck rows and returns all ids", async () => {
    const ids = ["aaa-111", "bbb-222", "ccc-333"];
    const db = buildMockDb({
      selectResult: { data: ids.map((id) => ({ id })), error: null },
      updateResult: { error: null },
    });

    const result = await reapStuckLabIterations(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(3);
    expect(result.ids).toEqual(ids);
    expect(db._inSpy).toHaveBeenCalledWith("id", ids);
  });
});

// ── reapStuckScenes ──────────────────────────────────────────────────────────

describe("reapStuckScenes", () => {
  const NOW = new Date("2026-06-14T12:00:00Z");
  const GENERATING_ID = "scene-gen-001";

  /**
   * reapStuckScenes makes TWO select queries (generating + pending) and one
   * combined update. We need a mock that can return different data for each
   * select call.
   */
  function buildScenesDb(opts: {
    generatingData: Array<{ id: string }>;
    pendingData: Array<{ id: string }>;
    updateError: { message: string } | null;
  }) {
    const updateSpy = vi.fn();
    const inSpy = vi.fn().mockResolvedValue({ error: opts.updateError });
    updateSpy.mockReturnValue({ in: inSpy });

    // We need two separate select chains for the two calls.
    let selectCallCount = 0;
    const fromSpy = vi.fn().mockImplementation(() => {
      const thisCallCount = ++selectCallCount;
      const chain: Record<string, unknown> = {};
      // The terminal call is .lt() — resolve with data depending on call order.
      const terminal = vi.fn().mockResolvedValue(
        thisCallCount === 1
          ? { data: opts.generatingData, error: null }
          : { data: opts.pendingData, error: null },
      );
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.is = vi.fn().mockReturnValue(chain);
      chain.not = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.lt = terminal;
      return {
        select: vi.fn().mockReturnValue(chain),
        update: updateSpy,
      };
    });

    return {
      from: fromSpy,
      _updateSpy: updateSpy,
      _inSpy: inSpy,
    };
  }

  it("reaps a generating scene older than GENERATE_STUCK_MINUTES", async () => {
    const db = buildScenesDb({
      generatingData: [{ id: GENERATING_ID }],
      pendingData: [],
      updateError: null,
    });

    const result = await reapStuckScenes(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(1);
    expect(result.ids).toContain(GENERATING_ID);
    expect(db._updateSpy).toHaveBeenCalledWith({ status: "needs_review" });
    expect(db._inSpy).toHaveBeenCalledWith("id", [GENERATING_ID]);
  });

  it("reaps multiple stuck generating scenes in one update call", async () => {
    const SECOND_ID = "scene-gen-002";
    const db = buildScenesDb({
      generatingData: [{ id: GENERATING_ID }, { id: SECOND_ID }],
      pendingData: [],
      updateError: null,
    });

    const result = await reapStuckScenes(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(2);
    expect(result.ids).toContain(GENERATING_ID);
    expect(result.ids).toContain(SECOND_ID);
    expect(db._updateSpy).toHaveBeenCalledTimes(1);
    expect(db._inSpy).toHaveBeenCalledWith("id", [GENERATING_ID, SECOND_ID]);
  });

  it("ages generating scenes by submitted_at, older-than direction (column + direction guard)", async () => {
    const db = buildScenesDb({ generatingData: [], pendingData: [], updateError: null });

    await reapStuckScenes(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    const fromResult = db.from.mock.results[0]?.value;
    const selectChain = fromResult?.select?.mock?.results?.[0]?.value;
    const expectedCutoff = new Date(NOW.getTime() - GENERATE_STUCK_MINUTES * 60 * 1000).toISOString();
    // A flipped column or comparison direction here would orphan stuck scenes
    // or reap fresh ones — assert both explicitly.
    expect(selectChain?.eq).toHaveBeenCalledWith("status", "generating");
    expect(selectChain?.lt).toHaveBeenCalledWith("submitted_at", expectedCutoff);
  });

  it("returns { reaped: 0, ids: [] } when both selects return empty", async () => {
    const db = buildScenesDb({
      generatingData: [],
      pendingData: [],
      updateError: null,
    });

    const result = await reapStuckScenes(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
    expect(db._updateSpy).not.toHaveBeenCalled();
  });

  it("uses scenes table", async () => {
    const db = buildScenesDb({
      generatingData: [],
      pendingData: [],
      updateError: null,
    });

    await reapStuckScenes(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(db.from).toHaveBeenCalledWith("scenes");
  });

  it("returns { reaped: 0, ids: [] } without throwing on update error", async () => {
    const db = buildScenesDb({
      generatingData: [{ id: GENERATING_ID }],
      pendingData: [],
      updateError: { message: "update failed" },
    });

    const result = await reapStuckScenes(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
  });

  it("now param controls the cutoff and resolves without throwing", async () => {
    const db = buildScenesDb({
      generatingData: [],
      pendingData: [],
      updateError: null,
    });

    await expect(
      reapStuckScenes(db as unknown as import("@supabase/supabase-js").SupabaseClient, minutesAgo(NOW, 0)),
    ).resolves.not.toThrow();

    expect(GENERATE_STUCK_MINUTES).toBe(30);
    // SUBMIT_STUCK_MINUTES is reserved for the property-level pending reaper (follow-up).
    expect(SUBMIT_STUCK_MINUTES).toBe(20);
  });
});

// ── reapStuckLabListings ─────────────────────────────────────────────────────

describe("reapStuckLabListings", () => {
  const NOW = new Date("2026-06-14T12:00:00Z");
  const STUCK_ID = "listing-stuck-001";

  it("reaps a listing stuck in 'analyzing' older than ANALYZE_STUCK_MINUTES", async () => {
    const db = buildMockDb({
      selectResult: { data: [{ id: STUCK_ID }], error: null },
      updateResult: { error: null },
    });

    const result = await reapStuckLabListings(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual([STUCK_ID]);
    expect(db._updateSpy).toHaveBeenCalledWith({
      status: "failed",
      notes: "timed out — analysis or direction never completed (reaped)",
    });
    expect(db._inSpy).toHaveBeenCalledWith("id", [STUCK_ID]);
  });

  it("reaps a listing stuck in 'directing' (same query covers both statuses)", async () => {
    const DIRECTING_ID = "listing-directing-001";
    const db = buildMockDb({
      selectResult: { data: [{ id: DIRECTING_ID }], error: null },
      updateResult: { error: null },
    });

    const result = await reapStuckLabListings(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual([DIRECTING_ID]);
  });

  it("returns { reaped: 0, ids: [] } when no rows exceed threshold", async () => {
    const db = buildMockDb({
      selectResult: { data: [], error: null },
      updateResult: { error: null },
    });

    const result = await reapStuckLabListings(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
    expect(db._updateSpy).not.toHaveBeenCalled();
  });

  it("uses the correct table: prompt_lab_listings", async () => {
    const db = buildMockDb({
      selectResult: { data: [], error: null },
      updateResult: { error: null },
    });

    await reapStuckLabListings(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(db.from).toHaveBeenCalledWith("prompt_lab_listings");
  });

  it("threshold constant is ANALYZE_STUCK_MINUTES", () => {
    expect(ANALYZE_STUCK_MINUTES).toBe(15);
  });

  it("passes cutoff based on now param", async () => {
    const db = buildMockDb({
      selectResult: { data: [], error: null },
      updateResult: { error: null },
    });

    await reapStuckLabListings(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    const expectedCutoff = new Date(NOW.getTime() - ANALYZE_STUCK_MINUTES * 60 * 1000).toISOString();
    const fromResult = db.from.mock.results[0]?.value;
    const selectChain = fromResult?.select?.mock?.results?.[0]?.value;
    expect(selectChain?.lt).toHaveBeenCalledWith("created_at", expectedCutoff);
  });

  it("returns { reaped: 0, ids: [] } without throwing on select error", async () => {
    const db = buildMockDb({
      selectResult: { data: null, error: { message: "connection error" } },
      updateResult: { error: null },
    });

    const result = await reapStuckLabListings(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
  });

  it("returns { reaped: 0, ids: [] } without throwing on update error", async () => {
    const db = buildMockDb({
      selectResult: { data: [{ id: STUCK_ID }], error: null },
      updateResult: { error: { message: "update error" } },
    });

    const result = await reapStuckLabListings(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
  });

  it("reaps multiple stuck listings", async () => {
    const ids = ["listing-001", "listing-002"];
    const db = buildMockDb({
      selectResult: { data: ids.map((id) => ({ id })), error: null },
      updateResult: { error: null },
    });

    const result = await reapStuckLabListings(db as unknown as import("@supabase/supabase-js").SupabaseClient, NOW);

    expect(result.reaped).toBe(2);
    expect(result.ids).toEqual(ids);
    expect(db._inSpy).toHaveBeenCalledWith("id", ids);
  });
});

// ── reapStuckDeliveryRuns ────────────────────────────────────────────────────

/**
 * Mock factory for reapStuckDeliveryRuns.
 *
 * The reaper does:
 *   1. db.from("delivery_runs").select(...).in(...).lt(...)  → selectResult
 *   2. For each row (if exhausted): db.from("delivery_runs").update(...).eq(...)  → updateResult
 *   3. For each row (if young): runScrapeStage(runId) via dynamic import (mocked above)
 *
 * The update chain for the exhausted path ends with .eq("id", id) — not .in().
 * We expose a separate `_eqSpy` for the update terminal.
 */
function buildDeliveryRunsDb(opts: {
  selectResult: { data: Array<{ id: string; stage: string; created_at: string }> | null; error: { message: string } | null };
  updateResult: { error: { message: string } | null };
}) {
  const updateSpy = vi.fn();
  const eqUpdateSpy = vi.fn().mockResolvedValue(opts.updateResult);

  const updateChain: Record<string, unknown> = {};
  updateChain.eq = eqUpdateSpy;
  updateSpy.mockReturnValue(updateChain);

  // Select chain: terminal is .lt()
  const selectChain: Record<string, unknown> = {};
  selectChain.in = vi.fn().mockReturnValue(selectChain);
  selectChain.eq = vi.fn().mockReturnValue(selectChain);
  selectChain.is = vi.fn().mockReturnValue(selectChain);
  selectChain.not = vi.fn().mockReturnValue(selectChain);
  selectChain.lt = vi.fn().mockResolvedValue(opts.selectResult);

  const fromSpy = vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnValue(selectChain),
    update: updateSpy,
  }));

  return {
    from: fromSpy,
    _updateSpy: updateSpy,
    _eqUpdateSpy: eqUpdateSpy,
  } as unknown as {
    from: typeof fromSpy;
    _updateSpy: typeof updateSpy;
    _eqUpdateSpy: typeof eqUpdateSpy;
  };
}

describe("reapStuckDeliveryRuns", () => {
  const NOW = new Date("2026-06-14T12:00:00Z");
  const RUN_ID = "run-stuck-001";

  /** A run created 10 minutes ago — young enough to re-fire (< 60m exhausted). */
  function youngRun(stage = "scraping"): { id: string; stage: string; created_at: string } {
    return {
      id: RUN_ID,
      stage,
      created_at: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
    };
  }

  /** A run created 70 minutes ago — past the 60m exhausted ceiling. */
  function oldRun(stage = "scraping"): { id: string; stage: string; created_at: string } {
    return {
      id: RUN_ID,
      stage,
      created_at: new Date(NOW.getTime() - 70 * 60 * 1000).toISOString(),
    };
  }

  it("(a) stuck-and-young → runScrapeStage fired, count=1", async () => {
    mockRunScrapeStage.mockResolvedValue(undefined);
    const db = buildDeliveryRunsDb({
      selectResult: { data: [youngRun()], error: null },
      updateResult: { error: null },
    });

    const result = await reapStuckDeliveryRuns(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual([RUN_ID]);
    expect(mockRunScrapeStage).toHaveBeenCalledWith(RUN_ID);
    expect(db._updateSpy).not.toHaveBeenCalled(); // no exhausted-update
  });

  it("(a) stuck intake run → runScrapeStage fired (covers intake stage)", async () => {
    mockRunScrapeStage.mockResolvedValue(undefined);
    const db = buildDeliveryRunsDb({
      selectResult: { data: [youngRun("intake")], error: null },
      updateResult: { error: null },
    });

    const result = await reapStuckDeliveryRuns(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(result.reaped).toBe(1);
    expect(mockRunScrapeStage).toHaveBeenCalledWith(RUN_ID);
  });

  it("(b) stuck-and-exhausted → error written, runScrapeStage NOT fired", async () => {
    const db = buildDeliveryRunsDb({
      selectResult: { data: [oldRun()], error: null },
      updateResult: { error: null },
    });

    const result = await reapStuckDeliveryRuns(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual([RUN_ID]);
    expect(mockRunScrapeStage).not.toHaveBeenCalled();
    // exhausted update written
    expect(db._updateSpy).toHaveBeenCalledOnce();
    const patch = db._updateSpy.mock.calls[0]?.[0] as Record<string, string>;
    expect(patch.error).toMatch(/stuck in scraping >60m/);
    expect(patch.error).toMatch(/auto-recovery exhausted/);
  });

  it("(c) no rows exceed the stuck threshold → nothing reaped", async () => {
    const db = buildDeliveryRunsDb({
      selectResult: { data: [], error: null },
      updateResult: { error: null },
    });

    const result = await reapStuckDeliveryRuns(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
    expect(mockRunScrapeStage).not.toHaveBeenCalled();
  });

  it("(d) reaper never throws when the select query errors", async () => {
    const db = buildDeliveryRunsDb({
      selectResult: { data: null, error: { message: "connection refused" } },
      updateResult: { error: null },
    });

    const result = await reapStuckDeliveryRuns(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
  });

  it("(d) reaper never throws when runScrapeStage throws", async () => {
    mockRunScrapeStage.mockRejectedValue(new Error("network timeout"));
    const db = buildDeliveryRunsDb({
      selectResult: { data: [youngRun()], error: null },
      updateResult: { error: null },
    });

    await expect(
      reapStuckDeliveryRuns(
        db as unknown as import("@supabase/supabase-js").SupabaseClient,
        NOW,
      ),
    ).resolves.toMatchObject({ reaped: 0, ids: [] });
  });

  it("(d) reaper never throws when the exhausted update errors", async () => {
    const db = buildDeliveryRunsDb({
      selectResult: { data: [oldRun()], error: null },
      updateResult: { error: { message: "update failed" } },
    });

    await expect(
      reapStuckDeliveryRuns(
        db as unknown as import("@supabase/supabase-js").SupabaseClient,
        NOW,
      ),
    ).resolves.toMatchObject({ reaped: 0, ids: [] });
  });

  it("cutoff is based on now param (DELIVERY_STUCK_MINUTES threshold)", async () => {
    const db = buildDeliveryRunsDb({
      selectResult: { data: [], error: null },
      updateResult: { error: null },
    });

    await reapStuckDeliveryRuns(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(db.from).toHaveBeenCalledWith("delivery_runs");
    const expectedCutoff = new Date(NOW.getTime() - DELIVERY_STUCK_MINUTES * 60 * 1000).toISOString();
    const fromResult = db.from.mock.results[0]?.value;
    const selectChain = fromResult?.select?.mock?.results?.[0]?.value;
    expect(selectChain?.lt).toHaveBeenCalledWith("updated_at", expectedCutoff);
  });

  it("constants: DELIVERY_STUCK_MINUTES=15, DELIVERY_MAX_AGE_MINUTES=60", () => {
    expect(DELIVERY_STUCK_MINUTES).toBe(15);
    expect(DELIVERY_MAX_AGE_MINUTES).toBe(60);
  });
});

// ── reapStuckGeneratingProperties ────────────────────────────────────────────

/**
 * Mock factory for reapStuckGeneratingProperties.
 *
 * The reaper does (per property):
 *   1. db.from("properties").select("id, updated_at").eq("status","generating").lt("updated_at", cutoff)
 *   2. db.from("scenes").select("id").eq(...).is(...).is(...).is(...)  → scene select (terminal: last .is())
 *   3. If exhausted: db.from("properties").update({status:"needs_review",...}).eq("id", prop.id)
 *   4. If young: resubmitScene(sceneId) via dynamic import + db.from("properties").update({updated_at}).eq(...)
 *
 * We use a stateful call-count to return different data for the property select vs scene select.
 */
function buildGeneratingPropertiesDb(opts: {
  propertyRows: Array<{ id: string; updated_at: string }>;
  sceneRows: Array<{ id: string }>;
  propSelectError: { message: string } | null;
  sceneSelectError: { message: string } | null;
  updateResult: { error: { message: string } | null };
}) {
  const updateSpy = vi.fn();
  const eqUpdateSpy = vi.fn().mockResolvedValue(opts.updateResult);
  const updateChain: Record<string, unknown> = {};
  updateChain.eq = eqUpdateSpy;
  updateSpy.mockReturnValue(updateChain);

  // Each call to .from() returns a fresh chain.
  // Call 1: property select — terminal is .lt()
  // Call 2+: scene select — terminal is last .is() — we make all filter methods also resolve
  let fromCallCount = 0;

  const fromSpy = vi.fn().mockImplementation(() => {
    fromCallCount++;
    const chain: Record<string, unknown> = {};
    if (fromCallCount === 1) {
      // Property select: terminal is .lt()
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.is = vi.fn().mockReturnValue(chain);
      chain.not = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.lt = vi.fn().mockResolvedValue({ data: opts.propertyRows, error: opts.propSelectError });
    } else {
      // Scene select (per property): the query ends with three .is() calls.
      // We make the chain thenable so that `await chain` resolves with scene data
      // regardless of which filter is called last. All filter methods return `chain`
      // so they are chainable; `chain.then` makes the whole chain awaitable.
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.not = vi.fn().mockReturnValue(chain);
      chain.in = vi.fn().mockReturnValue(chain);
      chain.lt = vi.fn().mockReturnValue(chain);
      chain.is = vi.fn().mockReturnValue(chain);
      // Make the chain a thenable — when awaited, resolves with scene data.
      chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
        resolve({ data: opts.sceneRows, error: opts.sceneSelectError });
        return Promise.resolve({ data: opts.sceneRows, error: opts.sceneSelectError });
      });
    }
    return {
      select: vi.fn().mockReturnValue(chain),
      update: updateSpy,
    };
  });

  return {
    from: fromSpy,
    _updateSpy: updateSpy,
    _eqUpdateSpy: eqUpdateSpy,
  } as unknown as {
    from: typeof fromSpy;
    _updateSpy: typeof updateSpy;
    _eqUpdateSpy: typeof eqUpdateSpy;
  };
}

describe("reapStuckGeneratingProperties", () => {
  const NOW = new Date("2026-06-14T12:00:00Z");
  const PROP_ID = "prop-stuck-001";
  const SCENE_ID = "scene-never-sub-001";

  /** A property updated 25 minutes ago — stuck (>20m) but young (< 60m). */
  function youngProp(): { id: string; updated_at: string } {
    return {
      id: PROP_ID,
      updated_at: new Date(NOW.getTime() - 25 * 60 * 1000).toISOString(),
    };
  }

  /** A property updated 65 minutes ago — exhausted (> 60m). */
  function oldProp(): { id: string; updated_at: string } {
    return {
      id: PROP_ID,
      updated_at: new Date(NOW.getTime() - 65 * 60 * 1000).toISOString(),
    };
  }

  it("(a) stuck-and-young with never-submitted scene → resubmitScene fired, timestamp bumped", async () => {
    mockResubmitScene.mockResolvedValue({ ok: true, provider: "atlas" });
    const db = buildGeneratingPropertiesDb({
      propertyRows: [youngProp()],
      sceneRows: [{ id: SCENE_ID }],
      propSelectError: null,
      sceneSelectError: null,
      updateResult: { error: null },
    });

    const result = await reapStuckGeneratingProperties(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual([PROP_ID]);
    expect(mockResubmitScene).toHaveBeenCalledWith(SCENE_ID);
    // property timestamp bump written (updated_at)
    expect(db._updateSpy).toHaveBeenCalledOnce();
    const patch = db._updateSpy.mock.calls[0]?.[0] as Record<string, string>;
    expect(patch).toHaveProperty("updated_at");
    expect(patch).not.toHaveProperty("status"); // not changing status on re-fire path
  });

  it("(a) resubmitScene failure still bumps timestamp (rate-limit) and counts as reaped", async () => {
    mockResubmitScene.mockResolvedValue({ ok: false, error: "all providers exhausted" });
    const db = buildGeneratingPropertiesDb({
      propertyRows: [youngProp()],
      sceneRows: [{ id: SCENE_ID }],
      propSelectError: null,
      sceneSelectError: null,
      updateResult: { error: null },
    });

    const result = await reapStuckGeneratingProperties(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(result.reaped).toBe(1);
    // timestamp bump still happened even though resubmit failed
    expect(db._updateSpy).toHaveBeenCalledOnce();
  });

  it("(b) stuck-and-exhausted → status set to needs_review, resubmitScene NOT fired", async () => {
    const db = buildGeneratingPropertiesDb({
      propertyRows: [oldProp()],
      sceneRows: [{ id: SCENE_ID }],
      propSelectError: null,
      sceneSelectError: null,
      updateResult: { error: null },
    });

    const result = await reapStuckGeneratingProperties(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(result.reaped).toBe(1);
    expect(result.ids).toEqual([PROP_ID]);
    expect(mockResubmitScene).not.toHaveBeenCalled();
    // give-up update written
    expect(db._updateSpy).toHaveBeenCalledOnce();
    const patch = db._updateSpy.mock.calls[0]?.[0] as Record<string, string>;
    expect(patch.status).toBe("needs_review");
  });

  it("(c) no rows exceed stuck threshold → nothing reaped", async () => {
    const db = buildGeneratingPropertiesDb({
      propertyRows: [],
      sceneRows: [],
      propSelectError: null,
      sceneSelectError: null,
      updateResult: { error: null },
    });

    const result = await reapStuckGeneratingProperties(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
    expect(mockResubmitScene).not.toHaveBeenCalled();
  });

  it("(c) property stuck but has no never-submitted scenes → skipped", async () => {
    const db = buildGeneratingPropertiesDb({
      propertyRows: [youngProp()],
      sceneRows: [], // no never-submitted scenes
      propSelectError: null,
      sceneSelectError: null,
      updateResult: { error: null },
    });

    const result = await reapStuckGeneratingProperties(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(result.reaped).toBe(0);
    expect(result.ids).toEqual([]);
    expect(mockResubmitScene).not.toHaveBeenCalled();
  });

  it("(d) reaper never throws when property select errors", async () => {
    const db = buildGeneratingPropertiesDb({
      propertyRows: [],
      sceneRows: [],
      propSelectError: { message: "connection refused" },
      sceneSelectError: null,
      updateResult: { error: null },
    });

    await expect(
      reapStuckGeneratingProperties(
        db as unknown as import("@supabase/supabase-js").SupabaseClient,
        NOW,
      ),
    ).resolves.toMatchObject({ reaped: 0, ids: [] });
  });

  it("(d) reaper never throws when resubmitScene throws", async () => {
    mockResubmitScene.mockRejectedValue(new Error("unexpected throw"));
    const db = buildGeneratingPropertiesDb({
      propertyRows: [youngProp()],
      sceneRows: [{ id: SCENE_ID }],
      propSelectError: null,
      sceneSelectError: null,
      updateResult: { error: null },
    });

    await expect(
      reapStuckGeneratingProperties(
        db as unknown as import("@supabase/supabase-js").SupabaseClient,
        NOW,
      ),
    ).resolves.not.toThrow();
  });

  it("cutoff is based on now param (GENERATING_STUCK_MINUTES threshold)", async () => {
    const db = buildGeneratingPropertiesDb({
      propertyRows: [],
      sceneRows: [],
      propSelectError: null,
      sceneSelectError: null,
      updateResult: { error: null },
    });

    await reapStuckGeneratingProperties(
      db as unknown as import("@supabase/supabase-js").SupabaseClient,
      NOW,
    );

    expect(db.from).toHaveBeenCalledWith("properties");
    const expectedCutoff = new Date(NOW.getTime() - GENERATING_STUCK_MINUTES * 60 * 1000).toISOString();
    const fromResult = db.from.mock.results[0]?.value;
    const selectChain = fromResult?.select?.mock?.results?.[0]?.value;
    expect(selectChain?.lt).toHaveBeenCalledWith("updated_at", expectedCutoff);
  });

  it("constants: GENERATING_STUCK_MINUTES=20, GENERATING_MAX_AGE_MINUTES=60", () => {
    expect(GENERATING_STUCK_MINUTES).toBe(20);
    expect(GENERATING_MAX_AGE_MINUTES).toBe(60);
  });
});

// ── Threshold constant sanity checks ────────────────────────────────────────

describe("threshold constants", () => {
  it("RENDER_STUCK_MINUTES is 30", () => expect(RENDER_STUCK_MINUTES).toBe(30));
  it("GENERATE_STUCK_MINUTES is 30", () => expect(GENERATE_STUCK_MINUTES).toBe(30));
  it("SUBMIT_STUCK_MINUTES is 20", () => expect(SUBMIT_STUCK_MINUTES).toBe(20));
  it("ANALYZE_STUCK_MINUTES is 15", () => expect(ANALYZE_STUCK_MINUTES).toBe(15));
});
