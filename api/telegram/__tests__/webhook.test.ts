/**
 * Tests for api/telegram/webhook.ts
 *
 * All side-effectful modules are fully mocked. Fake Telegram update payloads
 * drive each scenario. No real DB or Telegram API calls are made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────
// Must be declared before importing the handler so vitest hoists them.

vi.mock("../../../lib/drive/orchestrate.js", () => ({
  approveIntake: vi.fn(),
  regenerateIntake: vi.fn(),
}));

vi.mock("../../../lib/drive/intake-db.js", () => ({
  getIntake: vi.fn(),
  setStatus: vi.fn(),
  appendFeedback: vi.fn(),
  getByStatus: vi.fn(),
}));

vi.mock("../../../lib/telegram/client.js", () => ({
  sendMessage: vi.fn(),
  editMessageText: vi.fn(),
  answerCallback: vi.fn(),
}));

// Import after mocks are in place.
import handler from "../webhook.js";
import * as orchestrate from "../../../lib/drive/orchestrate.js";
import * as intakeDb from "../../../lib/drive/intake-db.js";
import * as telegramClient from "../../../lib/telegram/client.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const OWNER_CHAT_ID = "123456789";
const WEBHOOK_SECRET = "test-secret";

/** Build a minimal fake Vercel VercelRequest. */
function makeReq(overrides: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  return {
    method: overrides.method ?? "POST",
    headers: {
      "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      ...(overrides.headers ?? {}),
    },
    body: overrides.body ?? {},
  } as never;
}

/** Build a minimal fake Vercel VercelResponse that records calls. */
function makeRes() {
  const calls: { status: number; body: unknown }[] = [];
  const res = {
    _calls: calls,
    status(code: number) {
      const last = { status: code, body: undefined as unknown };
      calls.push(last);
      return {
        json(body: unknown) {
          last.body = body;
          return res;
        },
      };
    },
    setHeader() {
      return res;
    },
  };
  return res as unknown as import("@vercel/node").VercelResponse & {
    _calls: typeof calls;
  };
}

/** Make an update that carries a callback_query. */
function callbackUpdate(data: string, chatId = OWNER_CHAT_ID) {
  return {
    callback_query: {
      id: "cb-query-id",
      data,
      message: { chat: { id: Number(chatId) } },
    },
  };
}

/** Make an update that carries a message with free text. */
function messageUpdate(text: string, chatId = OWNER_CHAT_ID) {
  return {
    message: {
      chat: { id: Number(chatId) },
      text,
    },
  };
}

/** Fake DriveIntake row builder. */
function fakeIntake(overrides: Partial<{
  id: string;
  address: string;
  telegram_message_id: number | null;
  status: string;
  created_at: string;
}> = {}) {
  return {
    id: "intake-1",
    address: "123 Main St",
    telegram_message_id: 42,
    status: "awaiting_approval",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    drive_folder_id: "folder-1",
    final_folder_id: null,
    photo_count: 5,
    last_count_change_at: new Date().toISOString(),
    feedback_notes: null,
    property_id: null,
    ...overrides,
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();

  // Default env — flag on, secret and owner set
  process.env.DRIVE_INTAKE_ENABLED = "true";
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.TELEGRAM_OWNER_CHAT_ID = OWNER_CHAT_ID;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("api/telegram/webhook — auth", () => {
  it("returns 401 on missing/wrong secret token", async () => {
    const req = makeReq({ headers: { "x-telegram-bot-api-secret-token": "wrong" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._calls[0].status).toBe(401);
  });

  it("returns 200 no-op and ignores strangers (non-owner chat)", async () => {
    const req = makeReq({ body: callbackUpdate("approve:intake-1", "999") });
    const res = makeRes();
    await handler(req, res);
    expect(res._calls[0].status).toBe(200);
    expect(orchestrate.approveIntake).not.toHaveBeenCalled();
  });
});

describe("api/telegram/webhook — feature flag off", () => {
  it("returns 200 no-op when DRIVE_INTAKE_ENABLED is unset/false", async () => {
    delete process.env.DRIVE_INTAKE_ENABLED;
    const req = makeReq({ body: callbackUpdate("approve:intake-1") });
    const res = makeRes();
    await handler(req, res);
    expect(res._calls[0].status).toBe(200);
    expect(orchestrate.approveIntake).not.toHaveBeenCalled();
    expect(telegramClient.answerCallback).not.toHaveBeenCalled();
  });
});

describe("api/telegram/webhook — approve callback", () => {
  it("calls answerCallback, edits message, calls approveIntake, edits again", async () => {
    const intake = fakeIntake({ id: "intake-1", telegram_message_id: 42 });
    vi.mocked(intakeDb.getIntake).mockResolvedValue(intake as never);
    vi.mocked(orchestrate.approveIntake).mockResolvedValue({
      status: "generating",
      propertyId: "prop-1",
    });

    const req = makeReq({ body: callbackUpdate("approve:intake-1") });
    const res = makeRes();
    await handler(req, res);

    expect(telegramClient.answerCallback).toHaveBeenCalledWith("cb-query-id");
    expect(intakeDb.getIntake).toHaveBeenCalledWith("intake-1");
    // First edit — in-progress
    expect(telegramClient.editMessageText).toHaveBeenCalledWith(
      42,
      expect.stringContaining("Generating"),
    );
    expect(orchestrate.approveIntake).toHaveBeenCalledWith("intake-1");
    // Second edit — result
    expect(telegramClient.editMessageText).toHaveBeenCalledWith(
      42,
      expect.stringContaining("Queued"),
    );
    expect(res._calls[0].status).toBe(200);
  });

  it("edits to skipped message when approveIntake returns skipped", async () => {
    const intake = fakeIntake({ id: "intake-1", telegram_message_id: 77 });
    vi.mocked(intakeDb.getIntake).mockResolvedValue(intake as never);
    vi.mocked(orchestrate.approveIntake).mockResolvedValue({
      status: "skipped",
      reason: "non-prod",
    });

    const req = makeReq({ body: callbackUpdate("approve:intake-1") });
    const res = makeRes();
    await handler(req, res);

    const lastEdit = vi.mocked(telegramClient.editMessageText).mock.calls.at(-1);
    expect(lastEdit?.[1]).toContain("Skipped");
    expect(lastEdit?.[1]).toContain("non-prod environment");
  });

  it("edits to failed message when approveIntake returns error", async () => {
    const intake = fakeIntake({ id: "intake-1", telegram_message_id: 55 });
    vi.mocked(intakeDb.getIntake).mockResolvedValue(intake as never);
    vi.mocked(orchestrate.approveIntake).mockResolvedValue({
      status: "error",
      reason: "intake not found",
    });

    const req = makeReq({ body: callbackUpdate("approve:intake-1") });
    const res = makeRes();
    await handler(req, res);

    const lastEdit = vi.mocked(telegramClient.editMessageText).mock.calls.at(-1);
    expect(lastEdit?.[1]).toContain("Failed");
    expect(lastEdit?.[1]).toContain("intake not found");
  });
});

describe("api/telegram/webhook — skip callback", () => {
  it("calls answerCallback, setStatus skipped, edits message", async () => {
    const intake = fakeIntake({ id: "intake-2", telegram_message_id: 10 });
    vi.mocked(intakeDb.getIntake).mockResolvedValue(intake as never);
    vi.mocked(intakeDb.setStatus).mockResolvedValue(undefined);

    const req = makeReq({ body: callbackUpdate("skip:intake-2") });
    const res = makeRes();
    await handler(req, res);

    expect(telegramClient.answerCallback).toHaveBeenCalledWith("cb-query-id");
    expect(intakeDb.setStatus).toHaveBeenCalledWith("intake-2", "skipped");
    expect(telegramClient.editMessageText).toHaveBeenCalledWith(
      10,
      expect.stringContaining("Skipped"),
    );
    expect(res._calls[0].status).toBe(200);
  });
});

describe("api/telegram/webhook — regen callback", () => {
  it("calls answerCallback, regenerateIntake, sendMessage", async () => {
    const intake = fakeIntake({ id: "intake-3" });
    vi.mocked(intakeDb.getIntake).mockResolvedValue(intake as never);
    vi.mocked(orchestrate.regenerateIntake).mockResolvedValue({
      status: "generating",
      propertyId: "prop-3",
    });

    const req = makeReq({ body: callbackUpdate("regen:intake-3") });
    const res = makeRes();
    await handler(req, res);

    expect(telegramClient.answerCallback).toHaveBeenCalledWith("cb-query-id");
    expect(orchestrate.regenerateIntake).toHaveBeenCalledWith("intake-3", "");
    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Regenerating"),
    );
    expect(res._calls[0].status).toBe(200);
  });
});

describe("api/telegram/webhook — free-text message", () => {
  it("appends feedback when an awaiting_approval row exists", async () => {
    const intake = fakeIntake({
      id: "intake-4",
      status: "awaiting_approval",
      created_at: new Date().toISOString(),
    });
    vi.mocked(intakeDb.getByStatus).mockImplementation(async (status) => {
      if (status === "awaiting_approval") return [intake] as never;
      return [];
    });
    vi.mocked(intakeDb.appendFeedback).mockResolvedValue(undefined);

    const req = makeReq({ body: messageUpdate("Move the camera left") });
    const res = makeRes();
    await handler(req, res);

    expect(intakeDb.appendFeedback).toHaveBeenCalledWith(
      "intake-4",
      "Move the camera left",
    );
    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Noted"),
    );
    expect(orchestrate.regenerateIntake).not.toHaveBeenCalled();
    expect(res._calls[0].status).toBe(200);
  });

  it("calls regenerateIntake when only rendered rows exist", async () => {
    const intake = fakeIntake({
      id: "intake-5",
      status: "rendered",
      created_at: new Date().toISOString(),
    });
    vi.mocked(intakeDb.getByStatus).mockImplementation(async (status) => {
      if (status === "awaiting_approval") return [];
      if (status === "rendered") return [intake] as never;
      return [];
    });
    vi.mocked(orchestrate.regenerateIntake).mockResolvedValue({
      status: "generating",
      propertyId: "prop-5",
    });

    const req = makeReq({ body: messageUpdate("Add more energy") });
    const res = makeRes();
    await handler(req, res);

    expect(intakeDb.appendFeedback).not.toHaveBeenCalled();
    expect(orchestrate.regenerateIntake).toHaveBeenCalledWith(
      "intake-5",
      "Add more energy",
    );
    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Regenerating"),
    );
    expect(res._calls[0].status).toBe(200);
  });

  it("sends 'No pending property' when no awaiting or rendered rows", async () => {
    vi.mocked(intakeDb.getByStatus).mockResolvedValue([]);

    const req = makeReq({ body: messageUpdate("hello") });
    const res = makeRes();
    await handler(req, res);

    expect(telegramClient.sendMessage).toHaveBeenCalledWith(
      "No pending property to apply that to.",
    );
    expect(res._calls[0].status).toBe(200);
  });
});
