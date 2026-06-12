// Tests for the stuck-run reaper.
// Follows the orphan-run bd011913 incident (2026-06-12): analyzeRun inserts a
// row at status "extracting" BEFORE calling Claude; if the function times out
// the row is stranded forever.  reapStuckRuns() must flip those rows to
// "failed" on the next reads-list call.
import { describe, it, expect } from "vitest";
import { reapStuckRuns, TRANSIENT_THRESHOLDS } from "./reaper.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRow(
  id: string,
  status: string,
  ageMinutes: number,
  siteId = "site-1",
) {
  const updated = new Date(Date.now() - ageMinutes * 60 * 1000).toISOString();
  return { id, status, site_id: siteId, updated_at: updated };
}

type Row = ReturnType<typeof makeRow>;

// Minimal chainable Supabase stub for the reaper's two operations:
//   1. SELECT stale transient rows  (.from().select().eq().in().lte())
//   2. UPDATE to 'failed'           (.from().update().in())
function makeSupabase(rows: Row[]) {
  const updates: Array<{ ids: string[]; patch: Record<string, unknown> }> = [];

  const db = {
    _updates: updates,

    from(table: string) {
      if (table !== "market_update_runs") {
        throw new Error(`Unexpected table: ${table}`);
      }

      // SELECT branch — returns rows filtered by .eq() and .lte().
      let selectedRows: Row[] = [...rows];
      const selectApi: any = {
        select() { return selectApi; },
        eq(col: string, val: unknown) {
          selectedRows = selectedRows.filter((r: any) => r[col] === val);
          return selectApi;
        },
        in(col: string, vals: unknown[]) {
          selectedRows = selectedRows.filter((r: any) => vals.includes(r[col]));
          return selectApi;
        },
        lte(col: string, val: unknown) {
          selectedRows = selectedRows.filter((r: any) => r[col] <= (val as string));
          return selectApi;
        },
        // Terminal — promise resolves
        then(resolve: any) {
          return Promise.resolve({ data: selectedRows, error: null }).then(resolve);
        },
      };

      // UPDATE branch
      let updatePatch: Record<string, unknown> = {};
      const updateApi: any = {
        update(patch: Record<string, unknown>) {
          updatePatch = patch;
          return updateApi;
        },
        in(_col: string, vals: unknown[]) {
          updates.push({ ids: vals as string[], patch: updatePatch });
          return updateApi;
        },
        then(resolve: any) {
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };

      return {
        select: () => selectApi,
        update: (patch: Record<string, unknown>) => updateApi.update(patch),
      };
    },
  } as any;

  return db;
}

// ── reaper unit tests ─────────────────────────────────────────────────────────

describe("reapStuckRuns", () => {
  it("marks a stale 'extracting' row as failed", async () => {
    const stale = makeRow("run-stale-1", "extracting", 20); // 20 min > 15 min threshold
    const supabase = makeSupabase([stale]);

    await reapStuckRuns(supabase, "site-1");

    expect(supabase._updates).toHaveLength(1);
    expect(supabase._updates[0].ids).toContain("run-stale-1");
    expect(supabase._updates[0].patch.status).toBe("failed");
    expect(typeof supabase._updates[0].patch.error).toBe("string");
    expect((supabase._updates[0].patch.error as string).length).toBeGreaterThan(0);
  });

  it("does NOT reap a fresh 'extracting' row within the threshold", async () => {
    const fresh = makeRow("run-fresh-1", "extracting", 5); // 5 min < 15 min threshold
    const supabase = makeSupabase([fresh]);

    await reapStuckRuns(supabase, "site-1");

    expect(supabase._updates).toHaveLength(0);
  });

  it("does NOT reap rows with terminal statuses (ready, needs_review, generated, failed)", async () => {
    const terminal = [
      makeRow("run-ready", "ready", 60),
      makeRow("run-needs", "needs_review", 60),
      makeRow("run-gen", "generated", 60),
      makeRow("run-failed", "failed", 60),
    ];
    const supabase = makeSupabase(terminal);

    await reapStuckRuns(supabase, "site-1");

    expect(supabase._updates).toHaveLength(0);
  });

  it("is idempotent: calling twice on the same stale row does not crash", async () => {
    const stale = makeRow("run-stale-2", "extracting", 30);
    const supabase = makeSupabase([stale]);

    await reapStuckRuns(supabase, "site-1");
    await reapStuckRuns(supabase, "site-1");

    // No exception thrown; at least one update issued
    expect(supabase._updates.length).toBeGreaterThanOrEqual(1);
  });

  it("returns the count of reaped runs", async () => {
    const stale = [
      makeRow("run-a", "extracting", 20),
      makeRow("run-b", "extracting", 45),
    ];
    const supabase = makeSupabase(stale);

    const count = await reapStuckRuns(supabase, "site-1");

    expect(count).toBe(2);
  });

  it("returns 0 when nothing is stale", async () => {
    const fresh = makeRow("run-c", "extracting", 3);
    const supabase = makeSupabase([fresh]);

    const count = await reapStuckRuns(supabase, "site-1");

    expect(count).toBe(0);
  });

  it("TRANSIENT_THRESHOLDS exports extracting with a 15-minute threshold", () => {
    expect(TRANSIENT_THRESHOLDS.extracting).toBe(15);
  });

  it("only touches rows for the given siteId", async () => {
    const mine = makeRow("run-mine", "extracting", 20, "site-1");
    const other = makeRow("run-other", "extracting", 20, "site-99");
    const supabase = makeSupabase([mine, other]);

    await reapStuckRuns(supabase, "site-1");

    expect(supabase._updates[0].ids).toContain("run-mine");
    expect(supabase._updates[0].ids).not.toContain("run-other");
  });
});
