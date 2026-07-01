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
  setDeliveryRunId,
  setLastPausedReason,
  appendFeedback,
  claimForApproval,
  reapStuckIngesting,
  claimForRegenerate,
  getWatchState,
  upsertWatchState,
  appendChatMessages,
  getChatMessages,
  stagePlan,
  getPendingPlan,
  consumePlan,
  clearPendingPlan,
  getActiveRefineIntake,
  markUpdateProcessed,
  type DriveIntake,
} from "../intake-db.js";
import type { RefineAction } from "../../telegram/refine-types.js";

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
    "not",
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

// ── setDeliveryRunId / setLastPausedReason ───────────────────────────────────

describe("setDeliveryRunId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves without error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(setDeliveryRunId("intake-1", "run-uuid")).resolves.toBeUndefined();
  });

  it("throws on DB error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: new Error("update failed") }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(setDeliveryRunId("intake-1", "run-uuid")).rejects.toThrow("update failed");
  });
});

describe("setLastPausedReason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves without error when setting a reason", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(
      setLastPausedReason("intake-1", "missing listing field: price"),
    ).resolves.toBeUndefined();
  });

  it("resolves without error when clearing (reason: null)", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(setLastPausedReason("intake-1", null)).resolves.toBeUndefined();
  });

  it("throws on DB error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: new Error("update failed") }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(setLastPausedReason("intake-1", "some reason")).rejects.toThrow("update failed");
  });
});

// ── Telegram conversational-refine state ─────────────────────────────────────

describe("appendChatMessages / getChatMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends to existing history", async () => {
    const existing: DriveIntake = { ...BASE_ROW, chat_messages: [{ role: "user", content: "hi" }] };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([
        { data: existing, error: null }, // getIntake
        { data: null, error: null }, // update
      ]) as unknown as ReturnType<typeof getSupabase>,
    );

    await appendChatMessages("intake-1", [{ role: "assistant", content: "hello back" }]);
    expect(getSupabase).toHaveBeenCalledTimes(2);
  });

  it("caps history to the last 20 entries", async () => {
    const long = Array.from({ length: 19 }, (_, i) => ({ role: "user" as const, content: `msg-${i}` }));
    const existing: DriveIntake = { ...BASE_ROW, chat_messages: long };
    const client: Record<string, unknown>[] = [];
    let capturedPatch: Record<string, unknown> | undefined;
    vi.mocked(getSupabase).mockImplementation(() => {
      const call = client.length;
      client.push({});
      if (call === 0) {
        return { from: () => makeChain({ data: existing, error: null }) } as unknown as ReturnType<typeof getSupabase>;
      }
      return {
        from: () => ({
          update: (patch: Record<string, unknown>) => {
            capturedPatch = patch;
            return { eq: () => Promise.resolve({ error: null }) };
          },
        }),
      } as unknown as ReturnType<typeof getSupabase>;
    });

    await appendChatMessages("intake-1", [
      { role: "assistant", content: "reply-1" },
      { role: "user", content: "reply-2" },
    ]);

    expect((capturedPatch?.chat_messages as unknown[]).length).toBe(20);
    expect((capturedPatch?.chat_messages as Array<{ content: string }>).at(-1)?.content).toBe("reply-2");
  });

  it("getChatMessages returns [] when the intake has no history yet", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: BASE_ROW, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    expect(await getChatMessages("intake-1")).toEqual([]);
  });

  it("getChatMessages returns [] when the intake itself is missing", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    expect(await getChatMessages("missing")).toEqual([]);
  });
});

describe("stagePlan / getPendingPlan / consumePlan / clearPendingPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const actions: RefineAction[] = [{ kind: "set_voice", voice_id: "voice-1" }];

  it("stagePlan writes the plan and returns a fresh planId", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    const planId = await stagePlan("intake-1", { actions, summary: "Switch voice." });
    expect(typeof planId).toBe("string");
    expect(planId.length).toBeGreaterThan(0);
  });

  it("stagePlan throws on DB error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: new Error("update failed") }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(stagePlan("intake-1", { actions, summary: "x" })).rejects.toThrow("update failed");
  });

  it("getPendingPlan returns the plan when the id matches, unconsumed, and fresh", async () => {
    const row: DriveIntake = {
      ...BASE_ROW,
      pending_plan: { actions, summary: "Switch voice." },
      pending_plan_id: "plan-abc",
      pending_plan_created_at: new Date().toISOString(),
      pending_plan_consumed_at: null,
    };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: row, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    const staged = await getPendingPlan("intake-1", "plan-abc");
    expect(staged).toEqual({ actions, summary: "Switch voice." });
  });

  it("getPendingPlan returns null when the planId does not match", async () => {
    const row: DriveIntake = {
      ...BASE_ROW,
      pending_plan: { actions, summary: "x" },
      pending_plan_id: "plan-abc",
      pending_plan_created_at: new Date().toISOString(),
      pending_plan_consumed_at: null,
    };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: row, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    expect(await getPendingPlan("intake-1", "wrong-id")).toBeNull();
  });

  it("getPendingPlan returns null once consumed", async () => {
    const row: DriveIntake = {
      ...BASE_ROW,
      pending_plan: { actions, summary: "x" },
      pending_plan_id: "plan-abc",
      pending_plan_created_at: new Date().toISOString(),
      pending_plan_consumed_at: new Date().toISOString(),
    };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: row, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    expect(await getPendingPlan("intake-1", "plan-abc")).toBeNull();
  });

  it("getPendingPlan returns null once older than the 1h staleness window", async () => {
    const row: DriveIntake = {
      ...BASE_ROW,
      pending_plan: { actions, summary: "x" },
      pending_plan_id: "plan-abc",
      pending_plan_created_at: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
      pending_plan_consumed_at: null,
    };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: row, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    expect(await getPendingPlan("intake-1", "plan-abc")).toBeNull();
  });

  it("getPendingPlan returns null when the intake does not exist", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    expect(await getPendingPlan("missing", "plan-abc")).toBeNull();
  });

  it("consumePlan returns true when exactly one row is CAS-updated (this caller won)", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [{ id: "intake-1" }], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    expect(await consumePlan("intake-1", "plan-abc")).toBe(true);
  });

  it("consumePlan returns false when no row matches (already consumed / wrong id)", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    expect(await consumePlan("intake-1", "plan-abc")).toBe(false);
  });

  it("consumePlan throws on DB error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: new Error("DB error") }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(consumePlan("intake-1", "plan-abc")).rejects.toThrow("DB error");
  });

  it("clearPendingPlan resolves without error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(clearPendingPlan("intake-1")).resolves.toBeUndefined();
  });

  it("clearPendingPlan throws on DB error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: new Error("update failed") }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(clearPendingPlan("intake-1")).rejects.toThrow("update failed");
  });
});

describe("getActiveRefineIntake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the most-recently-created eligible intake", async () => {
    const row: DriveIntake = { ...BASE_ROW, delivery_run_id: "run-1", status: "generating" };
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: row, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    const result = await getActiveRefineIntake();
    expect(result?.id).toBe(BASE_ROW.id);
  });

  it("FIX 2: orders by created_at (stable — never reorders once a row is created), never updated_at", async () => {
    const row: DriveIntake = { ...BASE_ROW, delivery_run_id: "run-1", status: "generating" };
    const client = makeClient([{ data: row, error: null }]);
    vi.mocked(getSupabase).mockReturnValue(client as unknown as ReturnType<typeof getSupabase>);

    await getActiveRefineIntake();

    // makeClient hands back a fresh chain per .from() call — capture the one
    // this call actually used to inspect exactly what .order() was called with.
    const chain = client.from.mock.results[0]!.value as { order: ReturnType<typeof vi.fn> };
    expect(chain.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(chain.order).not.toHaveBeenCalledWith("updated_at", expect.anything());
  });

  it("returns null when no intake is routed through the delivery pipeline / in an eligible status", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    expect(await getActiveRefineIntake()).toBeNull();
  });

  it("throws on DB error", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: new Error("DB error") }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(getActiveRefineIntake()).rejects.toThrow("DB error");
  });
});

// ── Telegram webhook idempotency (C1 — atomic claim) ─────────────────────────

describe("markUpdateProcessed — atomic claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves true on a clean insert (this caller claimed it — should dispatch)", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: [{ update_id: 42 }], error: null }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(markUpdateProcessed(42)).resolves.toBe(true);
  });

  it("resolves false on a unique-violation (23505) — another caller already claimed it; a safe no-op, not a failure", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: { code: "23505", message: "duplicate key" } }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(markUpdateProcessed(42)).resolves.toBe(false);
  });

  it("rethrows any other (genuinely unexpected) DB error — never silently treated as claimed or not-claimed", async () => {
    vi.mocked(getSupabase).mockReturnValue(
      makeClient([{ data: null, error: { code: "42703", message: "column missing" } }]) as unknown as ReturnType<typeof getSupabase>,
    );
    await expect(markUpdateProcessed(42)).rejects.toMatchObject({ code: "42703" });
  });

  it("double-claim: two concurrent calls for the SAME update_id resolve exactly one true and one false", async () => {
    // Simulates the real Postgres race: the first insert to physically land
    // succeeds; every other concurrent insert for the same primary key gets
    // 23505 back, deterministically — this is the actual mechanism (not a
    // simulation of luck) that closes the C1 TOCTOU gap.
    let landed = false;
    vi.mocked(getSupabase).mockImplementation(() => ({
      from: () => ({
        insert: () => ({
          select: () =>
            Promise.resolve(
              landed
                ? { data: null, error: { code: "23505", message: "duplicate key" } }
                : ((landed = true), { data: [{ update_id: 99 }], error: null }),
            ),
        }),
      }),
    }) as unknown as ReturnType<typeof getSupabase>);

    const [first, second] = await Promise.all([markUpdateProcessed(99), markUpdateProcessed(99)]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].filter((v) => v === false)).toHaveLength(1);
  });
});
