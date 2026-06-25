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
} from "./intake-db.js";
import { sendMessage } from "../telegram/client.js";
import { getSupabase } from "../db.js";
import type { Property } from "../types.js";

// ── reconcileWatchedFolder ────────────────────────────────────────────────────

/**
 * Scan the watched Google Drive folder and upsert a drive_intake row for
 * every property sub-folder that has a populated Final sub-folder.
 *
 * Tolerate per-folder errors — a single bad folder must never abort the sweep.
 */
export async function reconcileWatchedFolder(): Promise<{ seen: number }> {
  const parentId = process.env.DRIVE_WATCHED_FOLDER_ID;
  if (!parentId) {
    console.warn("[drive/detect] DRIVE_WATCHED_FOLDER_ID not set — skipping reconcile");
    return { seen: 0 };
  }

  const folders = await listPropertyFolders(parentId);
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
        `🏠 New property detected: *${row.address}* — ${row.photo_count} photos in Final.\nGenerate a video?`,
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
 * Poll drive_intake rows in 'generating' status and notify Telegram when the
 * associated property has reached a terminal state (complete / delivered / failed).
 *
 * Tolerate per-row errors.
 */
export async function pollResults(): Promise<{ notified: number }> {
  const rows = await getByStatus("generating");
  let notified = 0;

  for (const row of rows) {
    if (!row.property_id) continue;

    try {
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
          `✅ *${row.address}* is ready: ${videoUrl}`,
          {
            buttons: [
              [{ text: "🔁 Regenerate", callbackData: `regen:${row.id}` }],
            ],
          },
        );
        await setStatus(row.id, "rendered");
        notified++;
      } else if (isFailed) {
        await sendMessage(`⚠️ *${row.address}* failed: render pipeline error`);
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
