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
  markUpdateProcessed: vi.fn(),
}));

vi.mock("../../../lib/telegram/client.js", async (importOriginal) => {
  // Pass escapeMarkdown through from the real module — it's a pure utility and
  // must not be mocked, otherwise webhook.ts throws at runtime.
  const actual = await importOriginal<typeof import("../../../lib/telegram/client.js")>();
  return {
    ...actual,
    sendMessage: vi.fn(),
    editMessageText: vi.fn(),
    answerCallback: vi.fn(),
  };
});

vi.mock("../../../lib/telegram/refine-conversation.js", () => ({
  handleRefineMessage: vi.fn(),
  handleRefineCallback: vi.fn(),
}));

// Import after mocks are in place.
import handler from "../webhook.js";
import * as orchestrate from "../../../lib/drive/orchestrate.js";
import * as intakeDb from "../../../lib/drive/intake-db.js";
import * as telegramClient from "../../../lib/telegram/client.js";
import * as refineConversation from "../../../lib/telegram/refine-conversation.js";

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

/** Monotonic counter so each fixture gets a distinct update_id by default
 *  (mirrors real Telegram updates) without every call site having to pass one. */
let nextUpdateId = 1;

/**
 * Make an update that carries a callback_query.
 * Uses `from.id` (the clicker's user id) for the owner gate — not
 * `message.chat.id`, which is the chat the button lives in.
 */
function callbackUpdate(data: string, fromId = OWNER_CHAT_ID, updateId = nextUpdateId++) {
  return {
    update_id: updateId,
    callback_query: {
      id: "cb-query-id",
      from: { id: Number(fromId) },
      data,
      message: { chat: { id: Number(fromId) } },
    },
  };
}

/**
 * Make an update that carries a message with free text.
 * `fromId` defaults to `chatId` — mirrors a Telegram private chat where
 * the user's id and the chat id are equal.  Pass a different value to
 * simulate a group-chat member.
 */
function messageUpdate(text: string, chatId = OWNER_CHAT_ID, fromId = chatId, updateId = nextUpdateId++) {
  return {
    update_id: updateId,
    message: {
      chat: { id: Number(chatId) },
      from: { id: Number(fromId) },
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

  // Idempotency defaults — every update_id claims successfully (this
  // request's insert "wins") unless a test says otherwise.
  vi.mocked(intakeDb.markUpdateProcessed).mockResolvedValue(true);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("api/telegram/webhook — auth", () => {
  it("returns 401 on missing/wrong secret token", async () => {
    const req = makeReq({ headers: { "x-telegram-bot-api-secret-token": "wrong" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._calls[0].status).toBe(401);
  });

  it("returns 401 when TELEGRAM_WEBHOOK_SECRET env is unset (no header)", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    // header also absent — both undefined; must NOT pass the gate
    const req = makeReq({ headers: {} });
    const res = makeRes();
    await handler(req, res);
    expect(res._calls[0].status).toBe(401);
    expect(orchestrate.approveIntake).not.toHaveBeenCalled();
  });

  it("returns 401 when TELEGRAM_WEBHOOK_SECRET env is unset even with a matching undefined header", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    // Omit the header entirely so it reads as undefined
    const req = makeReq({ headers: { "x-telegram-bot-api-secret-token": undefined as unknown as string } });
    const res = makeRes();
    await handler(req, res);
    expect(res._calls[0].status).toBe(401);
  });

  it("returns 200 no-op and ignores strangers (non-owner from.id for callback_query)", async () => {
    // Stranger's from.id is "999", owner is OWNER_CHAT_ID
    const req = makeReq({ body: callbackUpdate("approve:intake-1", "999") });
    const res = makeRes();
    await handler(req, res);
    expect(res._calls[0].status).toBe(200);
    expect(orchestrate.approveIntake).not.toHaveBeenCalled();
  });

  it("returns 200 no-op when TELEGRAM_OWNER_CHAT_ID is unset", async () => {
    delete process.env.TELEGRAM_OWNER_CHAT_ID;
    const req = makeReq({ body: callbackUpdate("approve:intake-1") });
    const res = makeRes();
    await handler(req, res);
    expect(res._calls[0].status).toBe(200);
    expect(orchestrate.approveIntake).not.toHaveBeenCalled();
  });

  it("non-owner cannot approve by spoofing message.chat.id (must use from.id)", async () => {
    // Simulate a callback where message.chat.id matches owner but from.id is stranger
    const strangerId = "999999";
    const update = {
      callback_query: {
        id: "cb-spoof",
        from: { id: Number(strangerId) },  // the actual clicker — stranger
        data: "approve:intake-spoof",
        message: { chat: { id: Number(OWNER_CHAT_ID) } }, // owner's chat (spoofable context)
      },
    };
    const req = makeReq({ body: update });
    const res = makeRes();
    await handler(req, res);
    expect(res._calls[0].status).toBe(200);
    expect(orchestrate.approveIntake).not.toHaveBeenCalled();
  });

  it("group-chat member cannot trigger free-text actions even when chat.id matches owner (message bypass)", async () => {
    // chat.id equals the owner (e.g. a group that was originally a private chat)
    // but from.id is a different user — the sender should be treated as a stranger.
    // senderChatId() prefers from.id over chat.id, so the owner gate must reject this.
    const req = makeReq({
      body: messageUpdate("steer left", OWNER_CHAT_ID, "999"),
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._calls[0].status).toBe(200);
    // Owner gate fires before any dispatch — none of these should be touched.
    expect(orchestrate.approveIntake).not.toHaveBeenCalled();
    expect(orchestrate.regenerateIntake).not.toHaveBeenCalled();
    expect(refineConversation.handleRefineMessage).not.toHaveBeenCalled();
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

  it("2026-07-02 live incident: a reason containing a naked, unbalanced '[' (e.g. a leaked '[object Object]') is sent WITHOUT crashing, in plain-text mode", async () => {
    // Reproduces the exact live failure: a thrown Supabase-shaped plain
    // object used to stringify to the literal "[object Object]" before the
    // errMsg fix. Even now that orchestrate.ts can't produce that literal
    // string anymore, this test locks in defense-in-depth at the webhook
    // layer — ANY reason text containing an unescaped '[' must never be
    // allowed to open a Markdown link entity that Telegram then rejects
    // (webhook.ts:186 -> client.ts:69 in the original incident).
    const intake = fakeIntake({ id: "intake-1", telegram_message_id: 55 });
    vi.mocked(intakeDb.getIntake).mockResolvedValue(intake as never);
    vi.mocked(orchestrate.approveIntake).mockResolvedValue({
      status: "error",
      reason: "[object Object]",
    });

    const req = makeReq({ body: callbackUpdate("approve:intake-1") });
    const res = makeRes();
    await handler(req, res);

    const lastEdit = vi.mocked(telegramClient.editMessageText).mock.calls.at(-1);
    expect(lastEdit?.[1]).toContain("[object Object]");
    // The naked '[' is only safe because this call opts OUT of Markdown
    // parsing entirely — assert the plain-text mode was actually requested.
    expect(lastEdit?.[2]).toEqual({ parseMode: "none" });
    expect(res._calls[0].status).toBe(200);
  });

  it("sends the failed message in plain-text mode via sendMessage when there is no telegram_message_id to edit", async () => {
    const intake = fakeIntake({ id: "intake-1", telegram_message_id: null });
    vi.mocked(intakeDb.getIntake).mockResolvedValue(intake as never);
    vi.mocked(orchestrate.approveIntake).mockResolvedValue({
      status: "error",
      reason: "[object Object]",
    });

    const req = makeReq({ body: callbackUpdate("approve:intake-1") });
    const res = makeRes();
    await handler(req, res);

    const lastSend = vi.mocked(telegramClient.sendMessage).mock.calls.at(-1);
    expect(lastSend?.[0]).toContain("[object Object]");
    expect(lastSend?.[1]).toEqual({ parseMode: "none" });
    expect(res._calls[0].status).toBe(200);
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
  it("routes free text to the conversational refine agent", async () => {
    vi.mocked(refineConversation.handleRefineMessage).mockResolvedValue(undefined);

    const req = makeReq({ body: messageUpdate("swap the music for something upbeat") });
    const res = makeRes();
    await handler(req, res);

    expect(refineConversation.handleRefineMessage).toHaveBeenCalledWith(
      "swap the music for something upbeat",
    );
    expect(res._calls[0].status).toBe(200);
  });

  it("still returns 200 and logs (never 500s) when handleRefineMessage throws", async () => {
    vi.mocked(refineConversation.handleRefineMessage).mockRejectedValue(new Error("boom"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const req = makeReq({ body: messageUpdate("hello") });
    const res = makeRes();
    await handler(req, res);

    expect(res._calls[0].status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("api/telegram/webhook — refine-plan confirm callbacks (apply/adjust/cancel)", () => {
  it("acks the callback and routes an apply:<planId> tap to handleRefineCallback", async () => {
    const req = makeReq({ body: callbackUpdate("apply:plan-abc") });
    const res = makeRes();
    await handler(req, res);

    expect(telegramClient.answerCallback).toHaveBeenCalledWith("cb-query-id");
    expect(refineConversation.handleRefineCallback).toHaveBeenCalledWith("apply:plan-abc");
    expect(res._calls[0].status).toBe(200);
  });

  it("routes an adjust:<planId> tap to handleRefineCallback", async () => {
    const req = makeReq({ body: callbackUpdate("adjust:plan-abc") });
    const res = makeRes();
    await handler(req, res);

    expect(refineConversation.handleRefineCallback).toHaveBeenCalledWith("adjust:plan-abc");
  });

  it("routes a cancel:<planId> tap to handleRefineCallback", async () => {
    const req = makeReq({ body: callbackUpdate("cancel:plan-abc") });
    const res = makeRes();
    await handler(req, res);

    expect(refineConversation.handleRefineCallback).toHaveBeenCalledWith("cancel:plan-abc");
  });
});

describe("api/telegram/webhook — update_id idempotency (C1: atomic claim)", () => {
  it("skips dispatch entirely and returns 200 no-op when markUpdateProcessed reports the update_id already claimed (conflict, not an error)", async () => {
    // A 23505 unique-violation resolves `false` from markUpdateProcessed —
    // no separate "check" call exists anymore; the insert itself IS the gate.
    vi.mocked(intakeDb.markUpdateProcessed).mockResolvedValue(false);

    const req = makeReq({ body: callbackUpdate("approve:intake-1", OWNER_CHAT_ID, 555) });
    const res = makeRes();
    await handler(req, res);

    expect(intakeDb.markUpdateProcessed).toHaveBeenCalledWith(555);
    expect(orchestrate.approveIntake).not.toHaveBeenCalled();
    expect(res._calls[0].status).toBe(200);
  });

  it("claims a new update_id (markUpdateProcessed resolves true) and proceeds to dispatch", async () => {
    vi.mocked(intakeDb.markUpdateProcessed).mockResolvedValue(true);
    const intake = fakeIntake({ id: "intake-1", telegram_message_id: 42 });
    vi.mocked(intakeDb.getIntake).mockResolvedValue(intake as never);
    vi.mocked(orchestrate.approveIntake).mockResolvedValue({ status: "generating", propertyId: "prop-1" });

    const req = makeReq({ body: callbackUpdate("approve:intake-1", OWNER_CHAT_ID, 556) });
    const res = makeRes();
    await handler(req, res);

    expect(intakeDb.markUpdateProcessed).toHaveBeenCalledWith(556);
    expect(orchestrate.approveIntake).toHaveBeenCalledWith("intake-1");
  });

  it("two concurrent deliveries of the SAME update_id: only the caller whose claim resolves true dispatches (closes the C1 TOCTOU gap)", async () => {
    // First call's insert lands (true); the concurrent retry's insert hits
    // the same primary key and gets the conflict (false) — no separate
    // "is it processed yet" read exists for a window to open in between.
    vi.mocked(intakeDb.markUpdateProcessed).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(orchestrate.approveIntake).mockResolvedValue({ status: "generating", propertyId: "prop-1" });
    vi.mocked(intakeDb.getIntake).mockResolvedValue(fakeIntake({ id: "intake-1" }) as never);

    const reqA = makeReq({ body: callbackUpdate("approve:intake-1", OWNER_CHAT_ID, 600) });
    const reqB = makeReq({ body: callbackUpdate("approve:intake-1", OWNER_CHAT_ID, 600) });
    await Promise.all([handler(reqA, makeRes()), handler(reqB, makeRes())]);

    expect(orchestrate.approveIntake).toHaveBeenCalledTimes(1);
  });

  it("still dispatches (fails open) when the idempotency ledger itself errors, logging loudly", async () => {
    vi.mocked(intakeDb.markUpdateProcessed).mockRejectedValue(new Error("ledger unavailable"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(refineConversation.handleRefineMessage).mockResolvedValue(undefined);

    const req = makeReq({ body: messageUpdate("hello", OWNER_CHAT_ID, OWNER_CHAT_ID, 557) });
    const res = makeRes();
    await handler(req, res);

    expect(refineConversation.handleRefineMessage).toHaveBeenCalledWith("hello");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[telegram/webhook] idempotency check failed:",
      expect.any(Error),
    );
    expect(res._calls[0].status).toBe(200);
    consoleErrorSpy.mockRestore();
  });

  it("does not run the idempotency gate at all when update_id is absent (tolerates a malformed/legacy payload)", async () => {
    const req = makeReq({ body: { message: { chat: { id: Number(OWNER_CHAT_ID) }, from: { id: Number(OWNER_CHAT_ID) }, text: "hi" } } });
    const res = makeRes();
    vi.mocked(refineConversation.handleRefineMessage).mockResolvedValue(undefined);

    await handler(req, res);

    expect(intakeDb.markUpdateProcessed).not.toHaveBeenCalled();
    expect(refineConversation.handleRefineMessage).toHaveBeenCalledWith("hi");
  });
});

describe("api/telegram/webhook — L1: constant-time secret compare", () => {
  it("rejects a same-length but different secret (exercises the actual timingSafeEqual byte comparison, not just the length guard)", async () => {
    // Same length as WEBHOOK_SECRET ("test-secret", 11 chars).
    const sameLengthWrong = "wrong-value";
    expect(sameLengthWrong.length).toBe(WEBHOOK_SECRET.length);

    const req = makeReq({ headers: { "x-telegram-bot-api-secret-token": sameLengthWrong } });
    const res = makeRes();
    await handler(req, res);

    expect(res._calls[0].status).toBe(401);
  });

  it("accepts the exact matching secret (constant-time compare does not itself break the happy path)", async () => {
    const req = makeReq({ body: callbackUpdate("approve:intake-1") });
    const res = makeRes();
    await handler(req, res);

    expect(res._calls[0].status).toBe(200);
  });

  it("rejects a shorter secret without throwing (length-mismatch guard precedes crypto.timingSafeEqual, which throws on unequal lengths)", async () => {
    const req = makeReq({ headers: { "x-telegram-bot-api-secret-token": "short" } });
    const res = makeRes();
    await expect(handler(req, res)).resolves.toBeDefined();
    expect(res._calls[0].status).toBe(401);
  });
});
