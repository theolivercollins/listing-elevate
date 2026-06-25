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
} from "../../lib/telegram/client.js";

// ── Minimal Telegram update types ─────────────────────────────────────────────

interface TelegramChat {
  id: number;
}

interface TelegramMessage {
  chat: TelegramChat;
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive the sender chat ID as a string from an update. */
function senderChatId(update: TelegramUpdate): string | undefined {
  const numericId =
    update.callback_query?.message?.chat?.id ?? update.message?.chat?.id;
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

  // Show in-progress state
  if (telegram_message_id !== null) {
    await editMessageText(telegram_message_id, `⏳ Generating *${address}*…`);
  }

  const r = await approveIntake(intakeId);

  if (telegram_message_id === null) {
    // No original message to edit — just notify via a new message
    if (r.status === "generating") {
      await sendMessage(`✅ Queued *${address}* for generation.`);
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
      `✅ Queued *${address}* for generation.`,
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
  const msgId = intake?.telegram_message_id ?? null;
  if (msgId !== null) {
    await editMessageText(msgId, `❌ Skipped *${address}*`);
  } else {
    await sendMessage(`❌ Skipped *${address}*`);
  }
}

async function handleRegen(cbId: string, intakeId: string): Promise<void> {
  const intake = await getIntake(intakeId);
  await answerCallback(cbId);
  await regenerateIntake(intakeId, "");

  const address = intake?.address ?? intakeId;
  await sendMessage(`🔁 Regenerating *${address}*…`);
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
      `Noted — will steer *${intake.address}* with: ${text}`,
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
      `🔁 Regenerating *${intake.address}* with your notes…`,
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

  // 1. Auth — secret token in header
  const incomingSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (incomingSecret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 2. Owner gate — discard updates from strangers silently
  const update = req.body as TelegramUpdate;
  const chatId = senderChatId(update);
  if (chatId !== process.env.TELEGRAM_OWNER_CHAT_ID) {
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
