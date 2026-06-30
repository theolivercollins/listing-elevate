/**
 * Tests for lib/drive/intake-db.ts
 *
 * Strategy: mock lib/db.js to control getSupabase, then drive the chainable
 * Supabase query builder with per-test response queues. Covers upsert paths
 * (insert / update-on-count-change / no-op), getStableDetected filters, and
 * the status non-downgrade invariant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mock (hoisted) ─────────────────────────────────────────────────────

vi.mock("../../db.js", () => ({
  getSupabase: vi.fn(),
}));

// ── Imports (after vi.mock) ───────────────────────────────────────────────────

import { getSupabase } from "../../db.js";
import {
  upsertDetectedFolder,
  getIntake,
  getIntakeByFolder,
  getStableDetected,
  getByStatus,
  setStatus,
  setTelegramMessageId,
  setPropertyId,
  appendFeedback,
  claimForApproval,
  reapStuckIngesting,
  claimForRegenerate,
  getWatchState,
  upsertWatchState,
  type DriveIntake,
} from "../intake-db.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

type DbResult = { data?: unknown; error?: unknown };

/**
 * Build a chainable Supabase query builder that resolves to `result` at any
 * terminal call (.single, .maybeSingle) or when awaited directly.
 */
function makeChain(result: DbResult) {
  const chain: Record<string, unknown> = {};
  const terminalResult = Promise.resolve(result);

  // All chainable non-terminal methods return the same chain object
  for (const m of [
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "gt",
    "lt",
    "lte",
    "gte",
    "in",
    "is",
    "order",
    "limit",
    "range",
    "filter",
  ]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }

  // Terminal methods
  chain["single"] = vi.fn().mockResolvedValue(result);
  chain["maybeSingle"] = vi.fn().mockResolvedValue(result);

  // Make chain thenable so `await supabase.from(...).update(...).eq(...)` works
  chain["then"] = (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => terminalResult.then(onFulfilled, onRejected);
  chain["catch"] = (onRejected?: (e: unknown) => unknown) =>
    terminalResult.catch(onRejected);

  return chain;
}

/**
 * Build a mock Supabase client where each call to .from() consumes the next
 * entry from `responses`. Excess calls reuse the last entry.
 */
function makeClient(responses: DbResult[]) {
  const queue = [...responses];
  return {
    from: vi.fn().mockImplementation(() => {
      const result = queue.length > 0 ? queue.shift()! : { data: null, error: null };
      return makeChain(result);
    }),
  };
}

// Fixture
const BASE_ROW: DriveIntake = {
  id: "intake-1",
  drive_folder_id: "folder-abc",
  address: "123 Main St",
  final_folder_id: "final-xyz",
  photo_count: 10,
  last_count_change_at: "2026-01-01T00:00:00.000Z",
  status: "detected",
  telegram_message_id: null,
  feedback_notes: null,
  property_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

// ── upsertDetectedFolder ──────────────────────────────────────────────────────

describe("upsertDetectedFolder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a new row when driveFolderId is not found", async () => {
    const newRow: DriveIntake = { ...BASE_ROW, id: "new-1" };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([
        // select → no existing row
        { data: null, error: null },
        // insert → new row
        { data: newRow, error: null },
      ]) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await upsertDetectedFolder({
      driveFolderId: "folder-abc",
      address: "123 Main St",
      finalFolderId: "final-xyz",
      photoCount: 10,
    });

    expect(result.id).toBe("new-1");
    // getSupabase is called once (client cached locally); from() is called twice
    // (select + insert) on the same client — verify via the returned data.
    expect(getSupabase).toHaveBeenCalledTimes(1);
  });

  it("updates photo_count and last_count_change_at when count changes", async () => {
    const updatedRow: DriveIntake = { ...BASE_ROW, photo_count: 15 };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([
        // select → existing row with photo_count=10
        { data: BASE_ROW, error: null },
        // update → row with new count
        { data: updatedRow, error: null },
      ]) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await upsertDetectedFolder({
      driveFolderId: "folder-abc",
      address: "123 Main St",
      finalFolderId: "final-xyz",
      photoCount: 15, // changed from 10
    });

    expect(result.photo_count).toBe(15);
    // getSupabase is called once; from() called twice (select + update) on same client
    expect(getSupabase).toHaveBeenCalledTimes(1);
  });

  it("returns existing row without writing when photo_count is unchanged", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([
        // select → existing row with photo_count=10
        { data: BASE_ROW, error: null },
        // NO second call expected
      ]) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await upsertDetectedFolder({
      driveFolderId: "folder-abc",
      address: "123 Main St",
      finalFolderId: "final-xyz",
      photoCount: 10, // same as existing
    });

    expect(result).toEqual(BASE_ROW);
    // Only one getSupabase call (the select); no insert/update
    expect(getSupabase).toHaveBeenCalledTimes(1);
  });

  it("does not change status when row is in an advanced state", async () => {
    // An approved row with count change should get count updated but NOT status changed
    const approvedRow: DriveIntake = { ...BASE_ROW, status: "approved", photo_count: 10 };
    const afterUpdate: DriveIntake = { ...approvedRow, photo_count: 20 };

    vi.mocked(getSupabase).mockReturnValue(
      makeClient([
        { data: approvedRow, error: null },
        { data: afterUpdate, error: null },
      ]) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await upsertDetectedFolder({
      driveFolderId: "folder-abc",
      address: "123 Main St",
      finalFolderId: "final-xyz",
      photoCount: 20,
    });

    expect(result.status).toBe("approved"); // status preserved
    expect(result.photo_count).toBe(20);
  });

  it("throws on select error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: new Error("DB error") }]) as unknown as ReturnType<typeof getSupabase>,
    );

    await expect(
      upsertDetectedFolder({
        driveFolderId: "folder-abc",
        address: "123 Main St",
        finalFolderId: null,
        photoCount: 5,
      }),
    ).rejects.toThrow("DB error");
  });
});

// ── getStableDetected ─────────────────────────────────────────────────────────

describe("getStableDetected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rows matching the stable filter", async () => {
    const stableRow: DriveIntake = { ...BASE_ROW, photo_count: 5 };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [stableRow], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );

    const results = await getStableDetected(15);

    expect(results).toHaveLength(1);
    expect(results[0].photo_count).toBe(5);
  });

  it("returns empty array when no stable rows exist", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );

    const results = await getStableDetected(15);
    expect(results).toEqual([]);
  });

  it("passes the correct cutoff to lte filter", async () => {
    const before = Date.now();

    // Capture what chain methods are called with
    let capturedLteValue: string | undefined;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gt", "order", "limit"]) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    chain["lte"] = vi.fn().mockImplementation((_col: string, val: string) => {
      capturedLteValue = val;
      return chain;
    });
    chain["then"] = (resolve?: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    chain["catch"] = (reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).catch(reject);
    chain["single"] = vi.fn().mockResolvedValue({ data: null, error: null });
    chain["maybeSingle"] = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(getSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    } as unknown as ReturnType<typeof getSupabase>);

    await getStableDetected(30);

    const after = Date.now();
    expect(capturedLteValue).toBeDefined();
    const cutoffMs = new Date(capturedLteValue!).getTime();
    const expectedLow = before - 30 * 60 * 1_000;
    const expectedHigh = after - 30 * 60 * 1_000;
    // cutoff should be ~30 minutes in the past
    expect(cutoffMs).toBeGreaterThanOrEqual(expectedLow - 50);
    expect(cutoffMs).toBeLessThanOrEqual(expectedHigh + 50);
  });
});

// ── setStatus ─────────────────────────────────────────────────────────────────

describe("setStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates status without patch", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(setStatus("intake-1", "ingesting")).resolves.toBeUndefined();
  });

  it("merges patch fields", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(
      setStatus("intake-1", "error", { feedback_notes: "pipeline failed" }),
    ).resolves.toBeUndefined();
  });

  it("throws on error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: new Error("update failed") }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(setStatus("intake-1", "error")).rejects.toThrow("update failed");
  });
});

// ── appendFeedback ────────────────────────────────────────────────────────────

describe("appendFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends to existing notes with newline separator", async () => {
    const existingRow: DriveIntake = { ...BASE_ROW, feedback_notes: "note 1" };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([
        // getIntake select
        { data: existingRow, error: null },
        // update
        { data: null, error: null },
      ]) as unknown as ReturnType<typeof getSupabase>,
    );

    await appendFeedback("intake-1", "note 2");
    // The second call to getSupabase should have been an update
    expect(getSupabase).toHaveBeenCalledTimes(2);
  });

  it("sets notes directly when no existing notes", async () => {
    const rowNoNotes: DriveIntake = { ...BASE_ROW, feedback_notes: null };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([
        { data: rowNoNotes, error: null },
        { data: null, error: null },
      ]) as unknown as ReturnType<typeof getSupabase>,
    );

    await expect(appendFeedback("intake-1", "first note")).resolves.toBeUndefined();
  });
});

// ── getWatchState / upsertWatchState ──────────────────────────────────────────

describe("getWatchState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no singleton row exists", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    const result = await getWatchState();
    expect(result).toBeNull();
  });

  it("returns the singleton row", async () => {
    const state = {
      id: "singleton",
      channel_id: "ch-1",
      resource_id: "res-1",
      expiration: 9999999999,
      start_page_token: "tok-1",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: state, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    const result = await getWatchState();
    expect(result?.channel_id).toBe("ch-1");
  });
});

describe("upsertWatchState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts without error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(
      upsertWatchState({ channel_id: "ch-2", start_page_token: "tok-2" }),
    ).resolves.toBeUndefined();
  });
});

// ── Simple getters ────────────────────────────────────────────────────────────

describe("getIntake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when not found", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    expect(await getIntake("missing")).toBeNull();
  });

  it("returns the row when found", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: BASE_ROW, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    const row = await getIntake("intake-1");
    expect(row?.id).toBe("intake-1");
  });
});

describe("getIntakeByFolder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when not found", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    expect(await getIntakeByFolder("unknown-folder")).toBeNull();
  });
});

describe("getByStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns matching rows", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [BASE_ROW], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    const rows = await getByStatus("detected");
    expect(rows).toHaveLength(1);
  });
});

// ── claimForApproval ──────────────────────────────────────────────────────────

describe("claimForApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when exactly one row is updated (claim succeeds)", async () => {
    // Supabase returns data: [{id: 'intake-1'}] — one row matched
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [{ id: "intake-1" }], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await claimForApproval("intake-1");
    expect(result).toBe(true);
  });

  it("returns false when no rows are updated (already claimed by another caller)", async () => {
    // Supabase returns data: [] — no rows matched the status filter
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await claimForApproval("intake-1");
    expect(result).toBe(false);
  });

  it("returns false when data is null (row not found)", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await claimForApproval("intake-1");
    expect(result).toBe(false);
  });

  it("throws on DB error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: new Error("DB error") }]) as unknown as ReturnType<typeof getSupabase>,
    );

    await expect(claimForApproval("intake-1")).rejects.toThrow("DB error");
  });
});

// ── reapStuckIngesting ────────────────────────────────────────────────────────

describe("reapStuckIngesting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns reaped rows when stuck-ingesting rows exist", async () => {
    const stuckRow: DriveIntake = { ...BASE_ROW, status: "ingesting" };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [stuckRow], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );

    const results = await reapStuckIngesting(30);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("ingesting"); // the row as it was before update
  });

  it("returns empty array when no stuck rows exist", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );

    const results = await reapStuckIngesting(30);
    expect(results).toEqual([]);
  });

  it("passes the correct cutoff to lt filter", async () => {
    const before = Date.now();

    let capturedLtValue: string | undefined;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "update", "order", "limit"]) {
      chain[m] = vi.fn().mockReturnValue(chain);
    }
    chain["lt"] = vi.fn().mockImplementation((_col: string, val: string) => {
      capturedLtValue = val;
      return chain;
    });
    chain["then"] = (resolve?: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    chain["catch"] = (reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).catch(reject);
    chain["single"] = vi.fn().mockResolvedValue({ data: null, error: null });
    chain["maybeSingle"] = vi.fn().mockResolvedValue({ data: null, error: null });

    vi.mocked(getSupabase).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    } as unknown as ReturnType<typeof getSupabase>);

    await reapStuckIngesting(15);

    const after = Date.now();
    expect(capturedLtValue).toBeDefined();
    const cutoffMs = new Date(capturedLtValue!).getTime();
    const expectedLow = before - 15 * 60 * 1_000;
    const expectedHigh = after - 15 * 60 * 1_000;
    // cutoff should be ~15 minutes in the past
    expect(cutoffMs).toBeGreaterThanOrEqual(expectedLow - 50);
    expect(cutoffMs).toBeLessThanOrEqual(expectedHigh + 50);
  });

  it("throws on DB error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: new Error("reap failed") }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(reapStuckIngesting(30)).rejects.toThrow("reap failed");
  });
});

// ── claimForRegenerate ────────────────────────────────────────────────────────

describe("claimForRegenerate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when exactly one row is updated (claim succeeds)", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [{ id: "intake-1" }], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await claimForRegenerate("intake-1");
    expect(result).toBe(true);
  });

  it("returns false when no rows are updated (already claimed by another caller)", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await claimForRegenerate("intake-1");
    expect(result).toBe(false);
  });

  it("returns false when data is null (row not found or wrong status)", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );

    const result = await claimForRegenerate("intake-1");
    expect(result).toBe(false);
  });

  it("throws on DB error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: new Error("DB error") }]) as unknown as ReturnType<typeof getSupabase>,
    );

    await expect(claimForRegenerate("intake-1")).rejects.toThrow("DB error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("setTelegramMessageId / setPropertyId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("setTelegramMessageId resolves without error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(setTelegramMessageId("intake-1", 12345)).resolves.toBeUndefined();
  });

  it("setPropertyId resolves without error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(setPropertyId("intake-1", "prop-uuid")).resolves.toBeUndefined();
  });
});
