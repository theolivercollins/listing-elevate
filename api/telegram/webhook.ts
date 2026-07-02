/**
 * POST /api/telegram/webhook
 *
 * Receives Telegram Bot API updates and routes them to:
 *   - the Drive-intake approval flow (approve:/skip:/regen: callbacks)
 *   - the conversational refine agent (free-text messages, and the
 *     apply:/adjust:/cancel: confirm-plan callbacks) — see
 *     lib/telegram/refine-conversation.ts, which owns all of that logic so
 *     this file stays a thin router.
 *
 * Auth:  x-telegram-bot-api-secret-token header must match
 *        TELEGRAM_WEBHOOK_SECRET → 401 otherwise. Compared with a
 *        constant-time byte comparison (crypto.timingSafeEqual), not `!==`
 *        (L1) — a length mismatch is rejected before ever calling
 *        timingSafeEqual (it throws on unequal-length buffers).
 *
 * Owner gate: updates from chats other than TELEGRAM_OWNER_CHAT_ID are
 *             silently discarded (200 no-op) to prevent strangers from
 *             triggering intake actions.
 *
 * Feature flag: DRIVE_INTAKE_ENABLED !== 'true' → 200 no-op, no side effects.
 *
 * Idempotency (C1): Telegram retries delivery on timeout/non-2xx, and several
 * dispatch paths here have non-repeatable side effects (re-renders, AI music
 * generation, cost events, a Haiku planner call). Every update_id is claimed
 * via a single ATOMIC insert — markUpdateProcessed(updateId) in
 * lib/drive/intake-db.ts returns true iff THIS request's insert is the one
 * that landed. This replaces a former check-then-act pair
 * (isUpdateProcessed() then markUpdateProcessed()) that had a TOCTOU gap:
 * two concurrent retries of the same update_id could both pass the "not yet
 * processed" check before either insert landed, and BOTH would dispatch —
 * a double render, or (per the security audit's L4 finding) a replayed
 * free-text message re-charging the Haiku planner a second time. This is the
 * SECONDARY guard; the staged refine plan's own single-use consumePlan CAS
 * (lib/drive/intake-db.ts) is the authoritative guard against a duplicate
 * money/render side effect on the apply:<planId> path specifically.
 *
 * maxDuration: raised to 280s (matching api/cron/auto-run-sweep.ts's own
 * choice for the identical underlying operation) because the apply:<planId>
 * callback kicks executeRefinement in the background without awaiting it in
 * the response path, and its render step (runAssembleStage) polls a
 * Creatomate render to completion synchronously — the wider budget is
 * headroom for that background work, not something the response path itself
 * blocks on (see refine-conversation.ts's own docblock: never await a render
 * inline; kick + return, the poller notifies).
 *
 * Always returns 200 on handled requests so Telegram does not retry.
 * The sole exception is a bad secret → 401.
 */

import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  approveIntake,
  regenerateIntake,
} from "../../lib/drive/orchestrate.js";
import {
  getIntake,
  setStatus,
  markUpdateProcessed,
} from "../../lib/drive/intake-db.js";
import {
  sendMessage,
  editMessageText,
  answerCallback,
  escapeMarkdown,
} from "../../lib/telegram/client.js";
import {
  handleRefineMessage,
  handleRefineCallback,
} from "../../lib/telegram/refine-conversation.js";

export const maxDuration = 280;

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
  /** Monotonic per-bot, globally unique — the idempotency dedupe key. */
  update_id?: number;
  callback_query?: TelegramCallbackQuery;
  message?: TelegramMessage;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * L1 — constant-time secret comparison. `!==` on the raw strings leaks
 * timing information proportional to the length of the matching prefix,
 * which is a viable (if slow) side channel for guessing the webhook secret.
 * crypto.timingSafeEqual requires equal-length buffers (it throws otherwise),
 * so a length mismatch is checked first and treated as an immediate,
 * unambiguous fail — never fed into timingSafeEqual.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

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
      // Plain-text — r.reason may contain Markdown special chars (e.g. "[")
      // that crash Telegram's entity parser if sent with parse_mode:'Markdown'.
      await sendMessage(`⚠️ Failed: ${r.reason ?? "unknown error"}`, {
        parseMode: "none",
      });
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
    // Plain-text for same reason — error text must not be Markdown-parsed.
    await editMessageText(
      telegram_message_id,
      `⚠️ Failed: ${r.reason ?? "unknown error"}`,
      { parseMode: "none" },
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
  } else if (
    data.startsWith("apply:") ||
    data.startsWith("adjust:") ||
    data.startsWith("cancel:")
  ) {
    // Refine-plan confirm callbacks — ack immediately (Telegram requires
    // answerCallbackQuery within ~10s), then hand the opaque planId off to
    // the conversational agent. It never trusts callback data beyond that
    // planId — the plan itself lives server-side and is re-validated +
    // single-use (lib/telegram/refine-conversation.ts).
    await answerCallback(cbId);
    await handleRefineCallback(data);
  }
  // Unknown callback data — no-op (already ack'd by sub-handlers, but if we
  // fall through without a handler, at minimum don't crash Telegram).
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

  // 1. Auth — secret token in header, constant-time compare (L1).
  // Reject when TELEGRAM_WEBHOOK_SECRET is unset (falsy) to avoid failing
  // open when env is not configured — checked first so an unconfigured
  // environment never reaches the byte comparison at all.
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const incomingSecretHeader = req.headers["x-telegram-bot-api-secret-token"];
  const incomingSecret = Array.isArray(incomingSecretHeader) ? incomingSecretHeader[0] : incomingSecretHeader;
  if (!expectedSecret || typeof incomingSecret !== "string" || !timingSafeEqualStrings(incomingSecret, expectedSecret)) {
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

  // 3. Idempotency (C1) — a single ATOMIC claim, not check-then-act. Telegram
  // retries delivery on timeout/non-2xx, and several dispatch paths below
  // have non-repeatable side effects (a re-render, an AI music-gen call, or
  // — the security-audit L4 finding this also closes — a Haiku planner
  // charge on a replayed free-text message). markUpdateProcessed's insert is
  // the race-free gate itself: `claimed === false` means a concurrent/
  // duplicate delivery's insert landed first, so THIS request must return a
  // no-op WITHOUT dispatching — never a check first, then a separate act.
  // This is the SECONDARY guard; the staged refine plan's own single-use
  // consumePlan CAS is authoritative for the money/render apply:<planId>
  // path specifically (see lib/telegram/refine-conversation.ts). A dedupe-
  // ledger hiccup must never block a legitimate update — log loudly and
  // fail OPEN (claimed=true) only for a genuinely unexpected DB error, never
  // for the expected 23505 conflict path (that resolves `false` cleanly,
  // no exception).
  const updateId = update.update_id;
  let claimed = true;
  if (typeof updateId === "number") {
    try {
      claimed = await markUpdateProcessed(updateId);
    } catch (err) {
      console.error("[telegram/webhook] idempotency check failed:", err);
      claimed = true;
    }
  }
  if (!claimed) {
    return res.status(200).json({ ok: true });
  }

  // 4. Dispatch
  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.message?.text) {
      await handleRefineMessage(update.message.text);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[telegram/webhook] Handler error:", msg, err);
  }

  return res.status(200).json({ ok: true });
}
