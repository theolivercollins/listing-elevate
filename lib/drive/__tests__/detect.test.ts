/**
 * Tests for lib/drive/detect.ts
 *
 * Strategy: mock all external deps (Drive client, intake-db, Telegram client,
 * Supabase), then assert the business logic in detect.ts produces the right
 * side-effects and return values.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks (hoisted) ────────────────────────────────────────────────────

vi.mock("../../drive/client.js", () => ({
  listPropertyFolders: vi.fn(),
  findFinalSubfolder: vi.fn(),
  countFinalImages: vi.fn(),
  getStartPageToken: vi.fn(),
  listChanges: vi.fn(),
  watchChanges: vi.fn(),
  stopChannel: vi.fn(),
}));

vi.mock("../../drive/intake-db.js", () => ({
  upsertDetectedFolder: vi.fn(),
  getStableDetected: vi.fn(),
  getByStatus: vi.fn(),
  setStatus: vi.fn(),
  setTelegramMessageId: vi.fn(),
  getWatchState: vi.fn(),
  upsertWatchState: vi.fn(),
}));

vi.mock("../../telegram/client.js", async (importOriginal) => {
  // Pass escapeMarkdown through from the real module — detect.ts uses it as a
  // pure utility and it must not be stubbed out, otherwise calls throw.
  const actual = await importOriginal<typeof import("../../telegram/client.js")>();
  return {
    ...actual,
    sendMessage: vi.fn(),
  };
});

vi.mock("../../db.js", () => ({
  getSupabase: vi.fn(),
}));

// ── Imports (after vi.mock) ───────────────────────────────────────────────────

import {
  listPropertyFolders,
  findFinalSubfolder,
  countFinalImages,
  getStartPageToken,
  watchChanges,
  stopChannel,
} from "../../drive/client.js";
import {
  upsertDetectedFolder,
  getStableDetected,
  getByStatus,
  setStatus,
  setTelegramMessageId,
  getWatchState,
  upsertWatchState,
  type DriveIntake,
} from "../../drive/intake-db.js";
import { sendMessage } from "../../telegram/client.js";
import { getSupabase } from "../../db.js";
import {
  reconcileWatchedFolder,
  settleAndPrompt,
  renewChannelIfNeeded,
  pollResults,
} from "../detect.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIntakeRow(overrides: Partial<DriveIntake> = {}): DriveIntake {
  return {
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
    ...overrides,
  };
}

/** Build a chainable Supabase mock that resolves to `result`. */
function makeSupabaseChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  const terminalResult = Promise.resolve(result);
  for (const m of ["select", "eq", "neq", "order", "limit", "filter"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["maybeSingle"] = vi.fn().mockResolvedValue(result);
  chain["then"] = (
    onFulfilled?: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => terminalResult.then(onFulfilled, onRejected);
  chain["catch"] = (onRejected?: (e: unknown) => unknown) =>
    terminalResult.catch(onRejected);
  return chain;
}

// ── reconcileWatchedFolder ────────────────────────────────────────────────────

describe("reconcileWatchedFolder", () => {
  const origEnv = process.env.DRIVE_WATCHED_FOLDER_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DRIVE_WATCHED_FOLDER_ID = "parent-folder-id";
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.DRIVE_WATCHED_FOLDER_ID;
    } else {
      process.env.DRIVE_WATCHED_FOLDER_ID = origEnv;
    }
  });

  it("upserts only folders that have a Final subfolder with images", async () => {
    vi.mocked(listPropertyFolders).mockResolvedValue([
      { id: "f1", name: "Prop A" },
      { id: "f2", name: "Prop B" },
      { id: "f3", name: "Prop C" },
    ]);
    // f1 → Final present, 5 images
    // f2 → no Final subfolder
    // f3 → Final present but 0 images
    vi.mocked(findFinalSubfolder)
      .mockResolvedValueOnce({ id: "final-1", name: "Final" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "final-3", name: "Final" });
    vi.mocked(countFinalImages)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0);
    vi.mocked(upsertDetectedFolder).mockResolvedValue(makeIntakeRow());

    const result = await reconcileWatchedFolder();

    expect(result).toEqual({ seen: 1 });
    expect(upsertDetectedFolder).toHaveBeenCalledOnce();
    expect(upsertDetectedFolder).toHaveBeenCalledWith({
      driveFolderId: "f1",
      address: "Prop A",
      finalFolderId: "final-1",
      photoCount: 5,
    });
  });

  it("tolerates per-folder errors and continues processing remaining folders", async () => {
    vi.mocked(listPropertyFolders).mockResolvedValue([
      { id: "f1", name: "Bad Folder" },
      { id: "f2", name: "Good Folder" },
    ]);
    vi.mocked(findFinalSubfolder)
      .mockRejectedValueOnce(new Error("Drive API error"))
      .mockResolvedValueOnce({ id: "final-2", name: "Final" });
    vi.mocked(countFinalImages).mockResolvedValueOnce(3);
    vi.mocked(upsertDetectedFolder).mockResolvedValue(makeIntakeRow());

    const result = await reconcileWatchedFolder();

    expect(result).toEqual({ seen: 1 });
    expect(upsertDetectedFolder).toHaveBeenCalledOnce();
  });

  it("returns seen:0 and skips scan when DRIVE_WATCHED_FOLDER_ID is unset", async () => {
    delete process.env.DRIVE_WATCHED_FOLDER_ID;

    const result = await reconcileWatchedFolder();

    expect(result).toEqual({ seen: 0 });
    expect(listPropertyFolders).not.toHaveBeenCalled();
  });

  it("caps at 200 folders and warns when more are returned", async () => {
    // Build 205 folders; only first 200 should be processed
    const manyFolders = Array.from({ length: 205 }, (_, i) => ({
      id: `f${i}`,
      name: `Prop ${i}`,
    }));
    vi.mocked(listPropertyFolders).mockResolvedValue(manyFolders);

    // Every folder has a Final subfolder with 1 image — so seen should equal
    // exactly 200, not 205.
    vi.mocked(findFinalSubfolder).mockResolvedValue({ id: "final-x", name: "Final" });
    vi.mocked(countFinalImages).mockResolvedValue(1);
    vi.mocked(upsertDetectedFolder).mockResolvedValue(makeIntakeRow());

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await reconcileWatchedFolder();

    expect(result).toEqual({ seen: 200 });
    expect(upsertDetectedFolder).toHaveBeenCalledTimes(200);
    // Must warn about truncation — no silent cap
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("205"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("200"),
    );

    warnSpy.mockRestore();
  });
});

// ── settleAndPrompt ───────────────────────────────────────────────────────────

describe("settleAndPrompt", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a Telegram prompt and flips status for each stable row", async () => {
    const row1 = makeIntakeRow({ id: "i1", address: "100 Oak Ave", photo_count: 8 });
    const row2 = makeIntakeRow({ id: "i2", address: "200 Pine St", photo_count: 12 });
    vi.mocked(getStableDetected).mockResolvedValue([row1, row2]);
    vi.mocked(sendMessage)
      .mockResolvedValueOnce({ messageId: 111 })
      .mockResolvedValueOnce({ messageId: 222 });
    vi.mocked(setTelegramMessageId).mockResolvedValue(undefined);
    vi.mocked(setStatus).mockResolvedValue(undefined);

    const result = await settleAndPrompt(10);

    expect(result).toEqual({ prompted: 2 });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      "🏠 New property detected: *100 Oak Ave* — 8 photos in Final.\nGenerate a video?",
      {
        buttons: [
          [
            { text: "✅ Generate", callbackData: "approve:i1" },
            { text: "❌ Skip", callbackData: "skip:i1" },
          ],
        ],
      },
    );
    expect(setTelegramMessageId).toHaveBeenCalledWith("i1", 111);
    expect(setStatus).toHaveBeenCalledWith("i1", "awaiting_approval");
    expect(setTelegramMessageId).toHaveBeenCalledWith("i2", 222);
    expect(setStatus).toHaveBeenCalledWith("i2", "awaiting_approval");
  });

  it("tolerates per-row errors and continues with remaining rows", async () => {
    const row1 = makeIntakeRow({ id: "i1", address: "Bad Row" });
    const row2 = makeIntakeRow({ id: "i2", address: "Good Row" });
    vi.mocked(getStableDetected).mockResolvedValue([row1, row2]);
    vi.mocked(sendMessage)
      .mockRejectedValueOnce(new Error("Telegram down"))
      .mockResolvedValueOnce({ messageId: 999 });
    vi.mocked(setTelegramMessageId).mockResolvedValue(undefined);
    vi.mocked(setStatus).mockResolvedValue(undefined);

    const result = await settleAndPrompt(10);

    expect(result).toEqual({ prompted: 1 });
    expect(setStatus).toHaveBeenCalledOnce();
    expect(setStatus).toHaveBeenCalledWith("i2", "awaiting_approval");
  });

  it("returns prompted:0 when no stable rows exist", async () => {
    vi.mocked(getStableDetected).mockResolvedValue([]);

    const result = await settleAndPrompt(10);

    expect(result).toEqual({ prompted: 0 });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// ── renewChannelIfNeeded ──────────────────────────────────────────────────────

describe("renewChannelIfNeeded", () => {
  const origEnv = process.env.DRIVE_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DRIVE_WEBHOOK_SECRET = "test-secret";
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.DRIVE_WEBHOOK_SECRET;
    } else {
      process.env.DRIVE_WEBHOOK_SECRET = origEnv;
    }
  });

  it("skips renewal when a channel exists and is not expiring soon", async () => {
    const farFuture = Date.now() + 48 * 60 * 60 * 1_000; // 48 h from now
    vi.mocked(getWatchState).mockResolvedValue({
      id: "singleton",
      channel_id: "ch-1",
      resource_id: "res-1",
      expiration: farFuture,
      start_page_token: "token-abc",
      updated_at: new Date().toISOString(),
    });

    const result = await renewChannelIfNeeded();

    expect(result).toEqual({ renewed: false });
    expect(watchChanges).not.toHaveBeenCalled();
  });

  it("registers a new channel when no watch state exists", async () => {
    vi.mocked(getWatchState).mockResolvedValue(null);
    vi.mocked(getStartPageToken).mockResolvedValue("new-token");
    vi.mocked(watchChanges).mockResolvedValue({
      channelId: "ch-new",
      resourceId: "res-new",
      expiration: Date.now() + 7 * 24 * 60 * 60 * 1_000,
    });
    vi.mocked(upsertWatchState).mockResolvedValue(undefined);

    const result = await renewChannelIfNeeded();

    expect(result).toEqual({ renewed: true });
    expect(getStartPageToken).toHaveBeenCalled();
    expect(watchChanges).toHaveBeenCalledWith(
      "new-token",
      expect.stringContaining("/api/drive/webhook"),
      "test-secret",
    );
    expect(upsertWatchState).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: "ch-new",
        resource_id: "res-new",
        start_page_token: "new-token",
      }),
    );
    expect(stopChannel).not.toHaveBeenCalled();
  });

  it("stops old channel after registering new one when expiring soon", async () => {
    const expiringSoon = Date.now() + 1 * 60 * 60 * 1_000; // 1 h from now
    vi.mocked(getWatchState).mockResolvedValue({
      id: "singleton",
      channel_id: "ch-old",
      resource_id: "res-old",
      expiration: expiringSoon,
      start_page_token: "existing-token",
      updated_at: new Date().toISOString(),
    });
    vi.mocked(watchChanges).mockResolvedValue({
      channelId: "ch-new",
      resourceId: "res-new",
      expiration: Date.now() + 7 * 24 * 60 * 60 * 1_000,
    });
    vi.mocked(stopChannel).mockResolvedValue(undefined);
    vi.mocked(upsertWatchState).mockResolvedValue(undefined);

    const result = await renewChannelIfNeeded();

    expect(result).toEqual({ renewed: true });
    expect(getStartPageToken).not.toHaveBeenCalled(); // reuses existing token
    expect(watchChanges).toHaveBeenCalledWith(
      "existing-token",
      expect.stringContaining("/api/drive/webhook"),
      "test-secret",
    );
    expect(stopChannel).toHaveBeenCalledWith("ch-old", "res-old");
    expect(upsertWatchState).toHaveBeenCalled();
  });
});

// ── pollResults ───────────────────────────────────────────────────────────────

describe("pollResults", () => {
  beforeEach(() => vi.clearAllMocks());

  it("notifies Telegram and sets status to rendered when property is complete", async () => {
    const row = makeIntakeRow({
      id: "i1",
      address: "42 Elm Street",
      status: "generating",
      property_id: "prop-1",
    });
    vi.mocked(getByStatus).mockResolvedValue([row]);
    const mockChain = makeSupabaseChain({
      data: {
        id: "prop-1",
        address: "42 Elm Street",
        status: "complete",
        horizontal_video_url: "https://cdn.example.com/video.mp4",
      },
      error: null,
    });
    vi.mocked(getSupabase).mockReturnValue({ from: () => mockChain } as any);
    vi.mocked(sendMessage).mockResolvedValue({ messageId: 500 });
    vi.mocked(setStatus).mockResolvedValue(undefined);

    const result = await pollResults();

    expect(result).toEqual({ notified: 1 });
    expect(sendMessage).toHaveBeenCalledWith(
      "✅ *42 Elm Street* is ready: https://cdn.example.com/video.mp4",
      { buttons: [[{ text: "🔁 Regenerate", callbackData: "regen:i1" }]] },
    );
    expect(setStatus).toHaveBeenCalledWith("i1", "rendered");
  });

  it("notifies Telegram and sets status to error when property failed", async () => {
    const row = makeIntakeRow({
      id: "i2",
      address: "55 Oak Ave",
      status: "generating",
      property_id: "prop-2",
    });
    vi.mocked(getByStatus).mockResolvedValue([row]);
    const mockChain = makeSupabaseChain({
      data: {
        id: "prop-2",
        address: "55 Oak Ave",
        status: "failed",
        horizontal_video_url: null,
      },
      error: null,
    });
    vi.mocked(getSupabase).mockReturnValue({ from: () => mockChain } as any);
    vi.mocked(sendMessage).mockResolvedValue({ messageId: 501 });
    vi.mocked(setStatus).mockResolvedValue(undefined);

    const result = await pollResults();

    expect(result).toEqual({ notified: 1 });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("⚠️ *55 Oak Ave* failed"),
    );
    expect(setStatus).toHaveBeenCalledWith("i2", "error");
  });

  it("skips rows with no property_id", async () => {
    const row = makeIntakeRow({ id: "i3", property_id: null, status: "generating" });
    vi.mocked(getByStatus).mockResolvedValue([row]);

    const result = await pollResults();

    expect(result).toEqual({ notified: 0 });
    expect(getSupabase).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not notify when property is still generating", async () => {
    const row = makeIntakeRow({
      id: "i4",
      property_id: "prop-4",
      status: "generating",
    });
    vi.mocked(getByStatus).mockResolvedValue([row]);
    const mockChain = makeSupabaseChain({
      data: { id: "prop-4", address: "Some St", status: "generating", horizontal_video_url: null },
      error: null,
    });
    vi.mocked(getSupabase).mockReturnValue({ from: () => mockChain } as any);

    const result = await pollResults();

    expect(result).toEqual({ notified: 0 });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("tolerates per-row errors and continues", async () => {
    const row1 = makeIntakeRow({ id: "i5", property_id: "prop-5", status: "generating", address: "Error Row" });
    const row2 = makeIntakeRow({ id: "i6", property_id: "prop-6", status: "generating", address: "Good Row" });
    vi.mocked(getByStatus).mockResolvedValue([row1, row2]);
    const errorChain = makeSupabaseChain({ data: null, error: new Error("DB down") });
    const goodChain = makeSupabaseChain({
      data: { id: "prop-6", address: "Good Row", status: "delivered", horizontal_video_url: "https://cdn/v.mp4" },
      error: null,
    });
    vi.mocked(getSupabase)
      .mockReturnValueOnce({ from: () => errorChain } as any)
      .mockReturnValueOnce({ from: () => goodChain } as any);
    vi.mocked(sendMessage).mockResolvedValue({ messageId: 600 });
    vi.mocked(setStatus).mockResolvedValue(undefined);

    const result = await pollResults();

    expect(result).toEqual({ notified: 1 });
    expect(setStatus).toHaveBeenCalledWith("i6", "rendered");
  });
});
