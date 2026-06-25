/**
 * POST /api/drive/webhook
 *
 * Google Drive push-notification receiver. Drive sends a POST whenever files
 * change inside the watched folder hierarchy.
 *
 * Auth: `x-goog-channel-token` header must match DRIVE_WEBHOOK_SECRET.
 * Sync ping: `x-goog-resource-state: sync` → 200 immediately (channel handshake).
 * Change ping: drain listChanges from the stored start_page_token to advance
 *              the change cursor, then kick off reconcileWatchedFolder so any
 *              new photos are immediately detected without waiting for the cron.
 *
 * Always responds 200 fast — Drive retries on any non-2xx.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { listChanges } from "../../lib/drive/client.js";
import { getWatchState, upsertWatchState } from "../../lib/drive/intake-db.js";
import { reconcileWatchedFolder } from "../../lib/drive/detect.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Global kill-switch
  if (process.env.DRIVE_INTAKE_ENABLED !== "true") {
    return res.status(200).json({ ok: true, skipped: "disabled" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Authenticate the Drive channel token
  const channelToken = req.headers["x-goog-channel-token"] as string | undefined;
  const expectedSecret = process.env.DRIVE_WEBHOOK_SECRET;
  if (!expectedSecret || channelToken !== expectedSecret) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Channel handshake sync ping — acknowledge immediately, nothing to process
  const resourceState = req.headers["x-goog-resource-state"] as string | undefined;
  if (resourceState === "sync") {
    return res.status(200).json({ ok: true, sync: true });
  }

  // Advance the change-feed cursor so we don't re-process the same changes
  try {
    const watchState = await getWatchState();
    const startPageToken = watchState?.start_page_token;
    if (startPageToken) {
      const result = await listChanges(startPageToken);
      if (result.newStartPageToken) {
        await upsertWatchState({ startPageToken: result.newStartPageToken });
      }
    }
  } catch (err) {
    // Non-fatal — cursor advancement failing is not worth a non-200 response
    // (Drive would retry the entire ping). Detection still runs below.
    console.error(
      "[drive/webhook] cursor advance failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Kick off folder reconciliation so new photos are detected immediately
  try {
    await reconcileWatchedFolder();
  } catch (err) {
    console.error(
      "[drive/webhook] reconcileWatchedFolder failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  return res.status(200).json({ ok: true });
}
