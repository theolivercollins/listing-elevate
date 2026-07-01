/**
 * POST /api/telegram/webhook
 *
 * Receives Telegram Bot API updates and routes them to the Drive-intake
 * approval / feedback flow.
 *
 * Auth:  x-telegram-bot-api-secret-token header must match
 *        TELEGRAM_WEBHOOK_SECRET → 401 otherwise.
 *
 * Owner gate: updates from chats other than TELEGRAM_OWNER_CHAT_ID are
 *             silently discarded (200 no-op) to prevent strangers from
 *             triggering intake actions.
 *
 * Feature flag: DRIVE_INTAKE_ENABLED !== 'true' → 200 no-op, no side effects.
 *
 * Always returns 200 on handled requests so Telegram does not retry.
 * The sole exception is a bad secret → 401.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  approveIntake,
  regenerateIntake,
} from "../../lib/drive/orchestrate.js";
import {
  getIntake,
  setStatus,
  appendFeedback,
  getByStatus,
} from "../../lib/drive/intake-db.js";
import {
  sendMessage,
  editMessageText,
  answerCallback,
  escapeMarkdown,
} from "../../lib/telegram/client.js";

// ── Minimal Telegram update types ─────────────────────────────────────────────

interface TelegramChat {
  id: number;
}

interface TelegramMessage {
  chat: TelegramChat;
  from?: { id: number }; // the authenticated sender (absent in channel posts)
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from?: { id: number }; // the user who actually clicked
  data?: string;
  message?: TelegramMessage;
}

interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive the sender ID from an update.
 *
 * For callback_query updates, use `from.id` — the user who actually clicked
 * the button — rather than `message.chat.id`, which is the chat the original
 * message lives in (could be a group, not necessarily the button-presser).
 *
 * For plain message updates, prefer `from.id` (the authenticated sender's
 * user id). In a private chat, from.id === chat.id, so the fallback to
 * chat.id is correct for that case too. This prevents a group-chat member
 * from triggering intake actions simply because the message lands in a chat
 * that shares its id with the owner.
 */
function senderChatId(update: TelegramUpdate): string | undefined {
  if (update.callback_query) {
    const numericId = update.callback_query.from?.id;
    return numericId !== undefined ? String(numericId) : undefined;
  }
  // from.id is the authenticated sender; chat.id is the conversation container.
  const numericId =
    update.message?.from?.id ?? update.message?.chat?.id;
  return numericId !== undefined ? String(numericId) : undefined;
}

// ── callback_query handlers ───────────────────────────────────────────────────

async function handleApprove(cbId: string, intakeId: string): Promise<void> {
  await answerCallback(cbId);

  const intake = await getIntake(intakeId);
  if (!intake) {
    await sendMessage(`⚠️ Intake \`${intakeId}\` not found.`);
    return;
  }

  const { address, telegram_message_id } = intake;
  const safeAddress = escapeMarkdown(address);

  // Show in-progress state
  if (telegram_message_id !== null) {
    await editMessageText(telegram_message_id, `⏳ Generating *${safeAddress}*…`);
  }

  const r = await approveIntake(intakeId);

  if (telegram_message_id === null) {
    // No original message to edit — just notify via a new message
    if (r.status === "generating") {
      await sendMessage(`✅ Queued *${safeAddress}* for generation.`);
    } else if (r.status === "skipped") {
      await sendMessage(`⚠️ Skipped (non-prod environment)`);
    } else {
      await sendMessage(`⚠️ Failed: ${r.reason ?? "unknown error"}`);
    }
    return;
  }

  if (r.status === "generating") {
    await editMessageText(
      telegram_message_id,
      `✅ Queued *${safeAddress}* for generation.`,
    );
  } else if (r.status === "skipped") {
    await editMessageText(
      telegram_message_id,
      `⚠️ Skipped (non-prod environment)`,
    );
  } else {
    await editMessageText(
      telegram_message_id,
      `⚠️ Failed: ${r.reason ?? "unknown error"}`,
    );
  }
}

async function handleSkip(cbId: string, intakeId: string): Promise<void> {
  const intake = await getIntake(intakeId);
  await answerCallback(cbId);
  await setStatus(intakeId, "skipped");

  const address = intake?.address ?? intakeId;
  const safeAddress = escapeMarkdown(address);
  const msgId = intake?.telegram_message_id ?? null;
  if (msgId !== null) {
    await editMessageText(msgId, `❌ Skipped *${safeAddress}*`);
  } else {
    await sendMessage(`❌ Skipped *${safeAddress}*`);
  }
}

async function handleRegen(cbId: string, intakeId: string): Promise<void> {
  const intake = await getIntake(intakeId);
  await answerCallback(cbId);
  await regenerateIntake(intakeId, "");

  const address = intake?.address ?? intakeId;
  await sendMessage(`🔁 Regenerating *${escapeMarkdown(address)}*…`);
}

async function handleCallbackQuery(cq: TelegramCallbackQuery): Promise<void> {
  const { id: cbId, data } = cq;
  if (!data) return;

  if (data.startsWith("approve:")) {
    await handleApprove(cbId, data.slice("approve:".length));
  } else if (data.startsWith("skip:")) {
    await handleSkip(cbId, data.slice("skip:".length));
  } else if (data.startsWith("regen:")) {
    await handleRegen(cbId, data.slice("regen:".length));
  }
  // Unknown callback data — no-op (already ack'd by sub-handlers, but if we
  // fall through without a handler, at minimum don't crash Telegram).
}

// ── message handler ───────────────────────────────────────────────────────────

async function handleFreeText(text: string): Promise<void> {
  // Prefer the most recent awaiting_approval row.
  const awaitingRows = await getByStatus("awaiting_approval");
  if (awaitingRows.length > 0) {
    const intake = awaitingRows.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
    await appendFeedback(intake.id, text);
    await sendMessage(
      `Noted — will steer *${escapeMarkdown(intake.address)}* with: ${text}`,
    );
    return;
  }

  // Fall back to most recent rendered row.
  const renderedRows = await getByStatus("rendered");
  if (renderedRows.length > 0) {
    const intake = renderedRows.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
    await regenerateIntake(intake.id, text);
    await sendMessage(
      `🔁 Regenerating *${escapeMarkdown(intake.address)}* with your notes…`,
    );
    return;
  }

  await sendMessage("No pending property to apply that to.");
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  // Feature flag — 200 no-op
  if (process.env.DRIVE_INTAKE_ENABLED !== "true") {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 1. Auth — secret token in header.
  // Reject when TELEGRAM_WEBHOOK_SECRET is unset (falsy) to avoid failing
  // open when env is not configured: undefined !== undefined evaluates false
  // without this guard.
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const incomingSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!expectedSecret || incomingSecret !== expectedSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 2. Owner gate — discard updates from strangers silently.
  // Also reject when TELEGRAM_OWNER_CHAT_ID is unset (falsy) so an
  // unconfigured environment never silently processes updates.
  const expectedOwner = process.env.TELEGRAM_OWNER_CHAT_ID;
  const update = req.body as TelegramUpdate;
  const chatId = senderChatId(update);
  if (!expectedOwner || chatId !== expectedOwner) {
    return res.status(200).json({ ok: true });
  }

  // 3. Dispatch
  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.message?.text) {
      await handleFreeText(update.message.text);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[telegram/webhook] Handler error:", msg, err);
  }

  return res.status(200).json({ ok: true });
}
