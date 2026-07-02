/**
 * Drive→Telegram intake: shared detection logic.
 *
 * Three concerns live here so they can be unit-tested independently of the
 * HTTP surface:
 *
 *   reconcileWatchedFolder  — scan Drive, upsert intake rows
 *   settleAndPrompt         — prompt Telegram for settled (stable) rows
 *   renewChannelIfNeeded    — keep the Drive push-notification channel alive
 *   pollResults             — notify Telegram when a property finishes/fails
 */

import {
  listPropertyFolders,
  findFinalSubfolder,
  countFinalImages,
  getStartPageToken,
  watchChanges,
  stopChannel,
} from "./client.js";
import {
  getStableDetected,
  getByStatus,
  setStatus,
  setTelegramMessageId,
  getWatchState,
  upsertWatchState,
  upsertDetectedFolder,
  setLastPausedReason,
} from "./intake-db.js";
import { sendMessage, escapeMarkdown } from "../telegram/client.js";
import { getSupabase } from "../db.js";
import { getRun } from "../delivery/runs.js";
import type { Property } from "../types.js";

// ── reconcileWatchedFolder ────────────────────────────────────────────────────

/** Hard cap on folders processed per sweep to bound resource usage and abuse. */
const MAX_FOLDERS_PER_SWEEP = 200;

/**
 * Scan the watched Google Drive folder and upsert a drive_intake row for
 * every property sub-folder that has a populated Final sub-folder.
 *
 * Tolerate per-folder errors — a single bad folder must never abort the sweep.
 * Caps at MAX_FOLDERS_PER_SWEEP; logs a warning (never silent truncation).
 */
export async function reconcileWatchedFolder(): Promise<{ seen: number }> {
  const parentId = process.env.DRIVE_WATCHED_FOLDER_ID;
  if (!parentId) {
    console.warn("[drive/detect] DRIVE_WATCHED_FOLDER_ID not set — skipping reconcile");
    return { seen: 0 };
  }

  const allFolders = await listPropertyFolders(parentId);
  let folders = allFolders;
  if (allFolders.length > MAX_FOLDERS_PER_SWEEP) {
    console.warn(
      `[drive/detect] reconcileWatchedFolder: ${allFolders.length} folders returned; processing first ${MAX_FOLDERS_PER_SWEEP} only`,
    );
    folders = allFolders.slice(0, MAX_FOLDERS_PER_SWEEP);
  }
  let seen = 0;

  for (const folder of folders) {
    try {
      const finalSubfolder = await findFinalSubfolder(folder.id);
      if (!finalSubfolder) continue;

      const photoCount = await countFinalImages(finalSubfolder.id);
      if (photoCount === 0) continue;

      await upsertDetectedFolder({
        driveFolderId: folder.id,
        address: folder.name,
        finalFolderId: finalSubfolder.id,
        photoCount,
      });
      seen++;
    } catch (err) {
      console.error(
        `[drive/detect] reconcile error for folder ${folder.id} (${folder.name}):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { seen };
}

// ── settleAndPrompt ───────────────────────────────────────────────────────────

/**
 * For every "detected" intake row that has been stable for at least
 * `settleMinutes`, send a Telegram approval prompt and flip the row to
 * 'awaiting_approval'.
 *
 * Tolerate per-row errors.
 */
export async function settleAndPrompt(
  settleMinutes: number,
): Promise<{ prompted: number }> {
  const rows = await getStableDetected(settleMinutes);
  let prompted = 0;

  for (const row of rows) {
    try {
      const { messageId } = await sendMessage(
        `🏠 New property detected: *${escapeMarkdown(row.address)}* — ${row.photo_count} photos in Final.\nGenerate a video?`,
        {
          buttons: [
            [
              { text: "✅ Generate", callbackData: `approve:${row.id}` },
              { text: "❌ Skip", callbackData: `skip:${row.id}` },
            ],
          ],
        },
      );
      await setTelegramMessageId(row.id, messageId);
      await setStatus(row.id, "awaiting_approval");
      prompted++;
    } catch (err) {
      console.error(
        `[drive/detect] settleAndPrompt error for intake ${row.id} (${row.address}):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { prompted };
}

// ── renewChannelIfNeeded ──────────────────────────────────────────────────────

/** 24 hours in ms — renew channel when expiration is within this window. */
const RENEW_WITHIN_MS = 24 * 60 * 60 * 1_000;

function getBaseUrl(): string {
  return process.env.LE_PUBLIC_BASE_URL ?? "https://listingelevate.com";
}

/**
 * Ensure a valid Drive push-notification channel exists.
 * Registers a new channel when none exists or the current one expires within 24 h.
 * Stops the old channel after the new one is registered.
 */
export async function renewChannelIfNeeded(): Promise<{ renewed: boolean }> {
  const watchState = await getWatchState();
  const now = Date.now();

  const hasChannel =
    watchState?.channel_id != null && watchState?.resource_id != null;
  const expirationMs = watchState?.expiration ?? 0;
  const expiringSoon = expirationMs - now < RENEW_WITHIN_MS;

  if (hasChannel && !expiringSoon) {
    return { renewed: false };
  }

  // Ensure we have a start page token
  let startPageToken = watchState?.start_page_token ?? null;
  if (!startPageToken) {
    startPageToken = await getStartPageToken();
  }

  const webhookUrl = `${getBaseUrl()}/api/drive/webhook`;
  const secret = process.env.DRIVE_WEBHOOK_SECRET ?? "";

  const { channelId, resourceId, expiration } = await watchChanges(
    startPageToken,
    webhookUrl,
    secret,
  );

  // Stop old channel if one existed
  if (hasChannel && watchState?.channel_id && watchState?.resource_id) {
    try {
      await stopChannel(watchState.channel_id, watchState.resource_id);
    } catch (err) {
      // Non-fatal — old channel may already be expired
      console.warn(
        "[drive/detect] stopChannel failed (may be already expired):",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  await upsertWatchState({ channel_id: channelId, resource_id: resourceId, expiration, start_page_token: startPageToken });

  return { renewed: true };
}

// ── pollResults ───────────────────────────────────────────────────────────────

/**
 * C2 — mirrors REFINING_LOCK_REASON in lib/telegram/refine-conversation.ts:
 * the internal sentinel the Telegram refine executor CAS-writes to
 * delivery_runs.paused_reason for the duration of a single conversational
 * edit, so the auto-run cron sweep skips the run while it's being mutated.
 * It is NOT a genuine human pause and must never surface as one here.
 * Duplicated as a literal (rather than imported) to avoid a drive/ -> telegram/
 * module dependency for one shared string constant; kept in sync by the
 * cross-reference comments on both sides.
 */
const REFINING_LOCK_SENTINEL = "refining";

/**
 * Map a raw delivery_runs.paused_reason (machine-oriented — see the
 * pauseForHuman call sites in lib/delivery/auto-run.ts) to a short, friendly,
 * operator-facing phrase for the Telegram pause notification. Matched by
 * prefix since most reasons are dynamically interpolated (scene ids, field
 * names, scores, provider error text). Falls back to a generic phrase for any
 * reason this map doesn't recognize (future gates, provider errors) so a raw
 * internal reason string never leaks into a Telegram message.
 */
function humanizePausedReason(reason: string): string {
  const missingField = reason.match(/^missing listing field: (price|beds|baths)/);
  if (missingField) {
    return `I couldn't find the ${missingField[1]}`;
  }
  if (reason.startsWith("photo_selection:")) {
    // Covers both 'no AI-recommended photos' and 'only N photos selected… thin coverage'.
    return "not enough strong photos to work with";
  }
  if (reason.startsWith("low judge margin")) {
    return "unsure which clip is best for a scene";
  }
  if (reason.startsWith("quality below threshold:")) {
    return "the result looked weak";
  }
  if (reason.startsWith("voiceover:")) {
    return "trouble generating the voiceover";
  }
  if (reason.startsWith("music:")) {
    return "couldn't pick a music track";
  }
  if (reason.startsWith("assembling:") || reason.startsWith("assembly failed:")) {
    return "trouble assembling the final video";
  }
  return "something needs a look";
}

/**
 * Poll drive_intake rows in 'generating' status and notify Telegram when the
 * routed delivery_runs row (or, for legacy/flag-off intakes, the property)
 * has reached a terminal or human-gated state.
 *
 * Delivery-pipeline path (intake.delivery_run_id set — see approveIntake in
 * lib/drive/orchestrate.ts): polls the EXPLICIT run by id — never
 * getRunByProperty, since a property can carry more than one delivery_runs
 * row and resolving "the" run for a property risks reporting on the wrong one.
 *   - run.paused_reason === 'refining' → the internal Telegram-refine-executor
 *                                  lock (REFINING_LOCK_SENTINEL / see C2): NOT
 *                                  a genuine pause. Skipped entirely — no
 *                                  notification, no last_paused_reason write.
 *   - run.stage === 'delivered' → "✅ ready" notification + status 'rendered'.
 *   - run.paused_reason set (any other value) → "⏸️ paused for review"
 *                                  notification, deduped against
 *                                  intake.last_paused_reason so a
 *                                  still-paused run is only announced once.
 *   - run.error set              → existing failure notification + status
 *                                  'error'. Checked BEFORE the "resumed"
 *                                  clear below so a run that resumes AND
 *                                  errors in the same interval notifies
 *                                  immediately, not a tick late.
 *   - paused_reason cleared but last_paused_reason was set (and no error) →
 *     run resumed cleanly; clear last_paused_reason, no message.
 *   - none of the above          → still in-flight, nothing to do yet.
 *
 * Legacy / DRIVE_INTAKE_USE_DELIVERY_PIPELINE='false' path (no
 * delivery_run_id on the row): unchanged properties.status IN
 * ('complete','delivered') logic.
 *
 * Tolerate per-row errors.
 */
export async function pollResults(): Promise<{ notified: number }> {
  const rows = await getByStatus("generating");
  let notified = 0;

  for (const row of rows) {
    if (!row.property_id) continue;

    try {
      if (row.delivery_run_id) {
        const run = await getRun(row.delivery_run_id);
        if (!run) {
          console.warn(
            `[drive/detect] pollResults: delivery_run_id ${row.delivery_run_id} not found for intake ${row.id} (${row.address}) — skipping`,
          );
          continue;
        }

        if (run.stage === "delivered") {
          const { data, error } = await getSupabase()
            .from("properties")
            .select("horizontal_video_url")
            .eq("id", row.property_id)
            .maybeSingle();
          if (error) throw error;

          const videoUrl =
            (data as { horizontal_video_url?: string | null } | null)
              ?.horizontal_video_url ?? "(no video URL)";
          await sendMessage(
            `✅ *${escapeMarkdown(row.address)}* is ready: ${videoUrl}`,
            {
              buttons: [
                [{ text: "🔁 Regenerate", callbackData: `regen:${row.id}` }],
              ],
            },
          );
          await setStatus(row.id, "rendered");
          notified++;
        } else if (run.paused_reason === REFINING_LOCK_SENTINEL) {
          // C2 — internal refine-executor lock (see REFINING_LOCK_REASON in
          // lib/telegram/refine-conversation.ts), not a genuine human pause.
          // The run is mid-refine: skip this row entirely this tick — no
          // pause notification, no last_paused_reason write, no status
          // change. Whatever this batch resolves to (re-render / genuine
          // pause / resume) will be visible on a later poll once the
          // executor releases the lock.
        } else if (run.paused_reason) {
          if (run.paused_reason !== row.last_paused_reason) {
            await sendMessage(
              `⏸️ *${escapeMarkdown(row.address)}*: paused for review — ${humanizePausedReason(run.paused_reason)}. Reply and I'll handle it.`,
            );
            await setLastPausedReason(row.id, run.paused_reason);
            notified++;
          }
          // Same reason as the last poll — already notified once, skip (dedupe).
        } else if (run.error) {
          // Checked BEFORE the last_paused_reason-clear branch below (nit):
          // a run that resumed AND errored within the same poll interval
          // must notify immediately, not wait a tick for the "resumed"
          // clear to consume this branch first.
          await sendMessage(`⚠️ *${escapeMarkdown(row.address)}* failed: render pipeline error`);
          await setStatus(row.id, "error");
          notified++;
        } else if (row.last_paused_reason) {
          // paused_reason cleared since the last poll (and no error) — the run resumed cleanly.
          await setLastPausedReason(row.id, null);
        }
        // Still in-flight — nothing to do yet.
        continue;
      }

      // Legacy / flag-off path — unchanged.
      const { data, error } = await getSupabase()
        .from("properties")
        .select("id, address, status, horizontal_video_url")
        .eq("id", row.property_id)
        .maybeSingle();

      if (error) throw error;
      if (!data) continue;

      const property = data as Pick<
        Property,
        "id" | "address" | "status" | "horizontal_video_url"
      >;

      const isComplete =
        property.status === "complete" || property.status === "delivered";
      const isFailed = property.status === "failed";

      if (isComplete) {
        const videoUrl = property.horizontal_video_url ?? "(no video URL)";
        await sendMessage(
          `✅ *${escapeMarkdown(row.address)}* is ready: ${videoUrl}`,
          {
            buttons: [
              [{ text: "🔁 Regenerate", callbackData: `regen:${row.id}` }],
            ],
          },
        );
        await setStatus(row.id, "rendered");
        notified++;
      } else if (isFailed) {
        await sendMessage(`⚠️ *${escapeMarkdown(row.address)}* failed: render pipeline error`);
        await setStatus(row.id, "error");
        notified++;
      }
      // Still generating — nothing to do yet
    } catch (err) {
      console.error(
        `[drive/detect] pollResults error for intake ${row.id} (${row.address}):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { notified };
}
