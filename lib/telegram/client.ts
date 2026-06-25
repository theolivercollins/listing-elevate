/**
 * Thin Telegram Bot HTTP API client.
 *
 * Config via env:
 *   TELEGRAM_BOT_TOKEN       — the Listing Elevate product bot token
 *   TELEGRAM_OWNER_CHAT_ID   — default recipient chat id
 *
 * Uses global `fetch` only; no npm dependencies.
 */

// ── Error types ─────────────────────────────────────────────────────────────

// Mirrors MlsProviderUnconfiguredError in lib/mls/lookup.ts.
export class TelegramUnconfiguredError extends Error {
  constructor() {
    super("Telegram bot not configured — set TELEGRAM_BOT_TOKEN");
    this.name = "TelegramUnconfiguredError";
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export type InlineButton = { text: string; callbackData: string };

type ParseMode = "Markdown" | "MarkdownV2" | "HTML";

interface SendOpts {
  chatId?: string;
  buttons?: InlineButton[][];
  parseMode?: ParseMode;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramUnconfiguredError();
  return token;
}

function getDefaultChatId(): string {
  return process.env.TELEGRAM_OWNER_CHAT_ID ?? "";
}

function buildUrl(method: string): string {
  return `https://api.telegram.org/bot${getToken()}/${method}`;
}

function buildReplyMarkup(
  buttons: InlineButton[][] | undefined,
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } | undefined {
  if (!buttons) return undefined;
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.callbackData })),
    ),
  };
}

async function post<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const url = buildUrl(method);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) {
    throw new Error(
      `Telegram API error [${method}]: ${json.description ?? "unknown error"}`,
    );
  }
  return json.result as T;
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Send a message to a chat.
 * Defaults to TELEGRAM_OWNER_CHAT_ID when chatId is omitted.
 */
export async function sendMessage(
  text: string,
  opts: SendOpts = {},
): Promise<{ messageId: number }> {
  const { chatId, buttons, parseMode = "Markdown" } = opts;
  const result = await post<{ message_id: number }>("sendMessage", {
    chat_id: chatId ?? getDefaultChatId(),
    text,
    parse_mode: parseMode,
    ...(buttons !== undefined && { reply_markup: buildReplyMarkup(buttons) }),
  });
  return { messageId: result.message_id };
}

/**
 * Edit an already-sent message in place.
 */
export async function editMessageText(
  messageId: number,
  text: string,
  opts: SendOpts = {},
): Promise<void> {
  const { chatId, buttons, parseMode = "Markdown" } = opts;
  await post<unknown>("editMessageText", {
    chat_id: chatId ?? getDefaultChatId(),
    message_id: messageId,
    text,
    parse_mode: parseMode,
    ...(buttons !== undefined && { reply_markup: buildReplyMarkup(buttons) }),
  });
}

/**
 * Acknowledge a callback_query (required within 10 s of receiving it).
 */
export async function answerCallback(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await post<unknown>("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text !== undefined && { text }),
  });
}

/**
 * Escape legacy-Markdown special characters so attacker-controlled strings
 * (e.g. folder names) cannot inject links or break formatting in Telegram
 * messages that use parse_mode:'Markdown'.
 *
 * Escaped characters: _ * ` [
 * Each is prefixed with a backslash.
 */
export function escapeMarkdown(s: string): string {
  return s.replace(/([_*`[])/g, "\\$1");
}

/**
 * Register the webhook URL with Telegram.
 * Called once during initial setup / re-deployment.
 */
export async function setWebhook(url: string, secretToken: string): Promise<void> {
  await post<unknown>("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
  });
}
