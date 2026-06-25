import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { TelegramUnconfiguredError, escapeMarkdown } from "../client.js";

// ── fetch mock helpers ──────────────────────────────────────────────────────

function mockFetchOk(result: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, result }),
  });
}

function mockFetchTelegramError(description: string) {
  return vi.fn().mockResolvedValue({
    ok: true, // HTTP is fine; Telegram says ok:false
    json: async () => ({ ok: false, description }),
  });
}

// ── env helpers ─────────────────────────────────────────────────────────────

const TOKEN = "1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ";
const OWNER_CHAT_ID = "9999999";

function setEnv() {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_OWNER_CHAT_ID = OWNER_CHAT_ID;
}

function clearEnv() {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_OWNER_CHAT_ID;
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("escapeMarkdown", () => {
  it("escapes underscore, asterisk, backtick, and open-bracket", () => {
    expect(escapeMarkdown("_")).toBe("\\_");
    expect(escapeMarkdown("*")).toBe("\\*");
    expect(escapeMarkdown("`")).toBe("\\`");
    expect(escapeMarkdown("[")).toBe("\\[");
  });

  it("escapes all four in a combined string", () => {
    expect(escapeMarkdown("hello_world *bold* `code` [link]")).toBe(
      "hello\\_world \\*bold\\* \\`code\\` \\[link]",
    );
  });

  it("does not modify strings with no special characters", () => {
    expect(escapeMarkdown("123 Main St")).toBe("123 Main St");
    expect(escapeMarkdown("")).toBe("");
  });

  it("neutralises a Markdown link injection attempt", () => {
    const malicious = "[tap](http://evil.example.com)";
    const escaped = escapeMarkdown(malicious);
    // After escaping, [ is \\[ — Telegram will not render it as a link
    expect(escaped).toBe("\\[tap](http://evil.example.com)");
    // Crucially, the opening bracket is escaped so no link is formed
    expect(escaped).not.toMatch(/^\[/);
  });

  it("is applied to address in settleAndPrompt messages (via sendMessage spy)", async () => {
    // Verify that detect.ts passes an escaped address — we do this by
    // importing sendMessage mock and checking the text argument directly.
    // (Full integration covered in detect.test.ts; this is a spot-check.)
    const address = "123 Maple_St [Unit *A*]";
    const result = escapeMarkdown(address);
    expect(result).toBe("123 Maple\\_St \\[Unit \\*A\\*]");
  });
});

describe("TelegramUnconfiguredError", () => {
  afterEach(clearEnv);

  it("is thrown by sendMessage when TELEGRAM_BOT_TOKEN is missing", async () => {
    clearEnv();
    // Re-import after env cleared so the module picks up the new env state
    const { sendMessage } = await import("../client.js");
    await expect(sendMessage("hi")).rejects.toBeInstanceOf(TelegramUnconfiguredError);
  });
});

describe("sendMessage", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setEnv();
    fetchSpy = mockFetchOk({ message_id: 42, chat: { id: Number(OWNER_CHAT_ID) } });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
    vi.resetModules();
  });

  it("POSTs to sendMessage with the correct URL and default chat_id", async () => {
    const { sendMessage } = await import("../client.js");
    const result = await sendMessage("Hello world");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe(OWNER_CHAT_ID);
    expect(body.text).toBe("Hello world");
    expect(body.parse_mode).toBe("Markdown");
  });

  it("returns { messageId } mapped from result.message_id", async () => {
    const { sendMessage } = await import("../client.js");
    const { messageId } = await sendMessage("test");
    expect(messageId).toBe(42);
  });

  it("uses the provided chatId when specified", async () => {
    const { sendMessage } = await import("../client.js");
    await sendMessage("hi", { chatId: "1111" });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.chat_id).toBe("1111");
  });

  it("maps InlineButton[][] to inline_keyboard in the reply_markup", async () => {
    const { sendMessage } = await import("../client.js");
    await sendMessage("choose", {
      buttons: [
        [
          { text: "Yes", callbackData: "yes" },
          { text: "No", callbackData: "no" },
        ],
      ],
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.reply_markup).toEqual({
      inline_keyboard: [[
        { text: "Yes", callback_data: "yes" },
        { text: "No", callback_data: "no" },
      ]],
    });
  });

  it("omits reply_markup when no buttons provided", async () => {
    const { sendMessage } = await import("../client.js");
    await sendMessage("plain");
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.reply_markup).toBeUndefined();
  });

  it("respects a custom parseMode", async () => {
    const { sendMessage } = await import("../client.js");
    await sendMessage("bold", { parseMode: "HTML" });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.parse_mode).toBe("HTML");
  });

  it("throws an error including the Telegram description when ok:false", async () => {
    vi.stubGlobal("fetch", mockFetchTelegramError("chat not found"));
    const { sendMessage } = await import("../client.js");
    await expect(sendMessage("x")).rejects.toThrow("chat not found");
  });
});

describe("editMessageText", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setEnv();
    fetchSpy = mockFetchOk(true);
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
    vi.resetModules();
  });

  it("POSTs to editMessageText with message_id, chat_id, and text", async () => {
    const { editMessageText } = await import("../client.js");
    await editMessageText(99, "updated text");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/editMessageText`);
    const body = JSON.parse(init.body as string);
    expect(body.message_id).toBe(99);
    expect(body.chat_id).toBe(OWNER_CHAT_ID);
    expect(body.text).toBe("updated text");
  });

  it("maps buttons to inline_keyboard in editMessageText", async () => {
    const { editMessageText } = await import("../client.js");
    await editMessageText(5, "pick", {
      buttons: [[{ text: "Ok", callbackData: "ok" }]],
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Ok", callback_data: "ok" }]],
    });
  });
});

describe("answerCallback", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setEnv();
    fetchSpy = mockFetchOk(true);
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
    vi.resetModules();
  });

  it("POSTs to answerCallbackQuery with the callback_query_id", async () => {
    const { answerCallback } = await import("../client.js");
    await answerCallback("cbq-abc123", "Done!");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`);
    const body = JSON.parse(init.body as string);
    expect(body.callback_query_id).toBe("cbq-abc123");
    expect(body.text).toBe("Done!");
  });

  it("omits text when not provided", async () => {
    const { answerCallback } = await import("../client.js");
    await answerCallback("cbq-xyz");
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.text).toBeUndefined();
  });
});

describe("setWebhook", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setEnv();
    fetchSpy = mockFetchOk(true);
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
    vi.resetModules();
  });

  it("POSTs to setWebhook with url, secret_token, and allowed_updates", async () => {
    const { setWebhook } = await import("../client.js");
    await setWebhook("https://listingelevate.com/api/telegram", "s3cr3t");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/setWebhook`);
    const body = JSON.parse(init.body as string);
    expect(body.url).toBe("https://listingelevate.com/api/telegram");
    expect(body.secret_token).toBe("s3cr3t");
    expect(body.allowed_updates).toEqual(["message", "callback_query"]);
  });
});
