#!/usr/bin/env tsx
/**
 * scripts/autonomy/notify.ts
 *
 * Sends a plain-text message to the configured Telegram chat.
 * Reads TELEGRAM_BOT_TOKEN from config.telegram.envFile (a KEY=VALUE .env file).
 *
 * Telegram hard-limits a sendMessage body to 4096 characters; long messages are
 * chunked automatically, with each chunk posted as a separate message.
 *
 * Usage (CLI):
 *   tsx notify.ts "your message here"
 *
 * Usage (module):
 *   import { sendTelegram } from "./notify.js";
 *   await sendTelegram("hello from the autonomy loop");
 *
 * Security: the bot token is NEVER written to stdout, stderr, or any log.
 */

import * as fs from "node:fs";
import { loadConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Telegram's maximum text length for a single sendMessage call. */
const TELEGRAM_MAX_CHARS = 4096;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a .env file (KEY=VALUE lines) into a Map.
 * Lines beginning with # and blank lines are ignored.
 * Values may optionally be wrapped in single or double quotes.
 */
function parseEnvFile(filePath: string): Map<string, string> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(
      `notify: cannot read envFile "${filePath}": ${(err as Error).message}`,
    );
  }

  const map = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip optional surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) map.set(key, value);
  }
  return map;
}

/**
 * Split `text` into chunks of at most `maxLen` characters.
 * Splitting prefers newline boundaries within the last 200 characters of each
 * chunk to avoid mid-sentence cuts, falling back to a hard character split.
 */
function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Look for the last newline within the allowed window.
    const window = remaining.slice(0, maxLen);
    const nlIdx = window.lastIndexOf("\n", maxLen - 1);
    const splitAt = nlIdx > maxLen - 200 ? nlIdx + 1 : maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/**
 * POST a single sendMessage call to the Telegram Bot API.
 * The token must remain out of all logs — callers supply it opaquely.
 */
async function postMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  // Construct URL without interpolating token into user-visible strings.
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const body = JSON.stringify({ chat_id: chatId, text });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!response.ok) {
    // Surface the Telegram error without echoing the URL (which carries the token).
    let detail = "";
    try {
      const json = (await response.json()) as { description?: string };
      detail = json.description ?? "";
    } catch {
      // ignore parse failures
    }
    throw new Error(
      `notify: Telegram API error ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send `text` to the Telegram chat configured in AutonomyConfig.
 *
 * Long messages (>4096 chars) are automatically chunked into multiple posts.
 * The bot token is read from config.telegram.envFile and never logged.
 */
export async function sendTelegram(text: string): Promise<void> {
  const config = loadConfig();

  const env = parseEnvFile(config.telegram.envFile);
  const token = env.get("TELEGRAM_BOT_TOKEN");
  if (!token) {
    throw new Error(
      `notify: TELEGRAM_BOT_TOKEN not found in "${config.telegram.envFile}"`,
    );
  }

  const chunks = chunkText(text, TELEGRAM_MAX_CHARS);
  for (const chunk of chunks) {
    await postMessage(token, config.telegram.chatId, chunk);
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.error('Usage: tsx notify.ts "message text"');
    process.exit(args.length === 0 ? 1 : 0);
  }

  const text = args.join(" ");

  try {
    await sendTelegram(text);
    console.log("[notify] Message sent.");
  } catch (err) {
    console.error(`[notify] Failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

// Run when invoked directly (tsx notify.ts ...) but not when imported as a module.
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("notify.ts") ||
    process.argv[1].endsWith("notify.js"));

if (isMain) {
  void main();
}
