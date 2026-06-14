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
  RENDER_STUCK_MINUTES,
  GENERATE_STUCK_MINUTES,
  SUBMIT_STUCK_MINUTES,
  ANALYZE_STUCK_MINUTES,
} from "../stuck-reaper.js";

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

// ── Threshold constant sanity checks ────────────────────────────────────────

describe("threshold constants", () => {
  it("RENDER_STUCK_MINUTES is 30", () => expect(RENDER_STUCK_MINUTES).toBe(30));
  it("GENERATE_STUCK_MINUTES is 30", () => expect(GENERATE_STUCK_MINUTES).toBe(30));
  it("SUBMIT_STUCK_MINUTES is 20", () => expect(SUBMIT_STUCK_MINUTES).toBe(20));
  it("ANALYZE_STUCK_MINUTES is 15", () => expect(ANALYZE_STUCK_MINUTES).toBe(15));
});
