/**
 * GET /api/cron/drive-intake-poll
 *
 * Cron: polls drive_intake rows in 'generating' status and notifies Telegram
 * when the associated property pipeline has completed or failed.
 *
 * Also runs the stuck-ingesting reaper on every invocation. A serverless
 * timeout or OOM-kill during approveIntake bypasses the try/catch and leaves
 * the row pinned at status='ingesting' forever (claimForApproval already flipped
 * it before the long photo download). The reaper detects stale rows and resets
 * pre-property ones back to 'awaiting_approval' so the operator can retry.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { pollResults } from "../../lib/drive/detect.js";
import { reapStuckIngesting } from "../../lib/drive/intake-db.js";
import { sendMessage, escapeMarkdown } from "../../lib/telegram/client.js";

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Global kill-switch
  if (process.env.DRIVE_INTAKE_ENABLED !== "true") {
    return res.status(200).json({ ok: true, skipped: "disabled" });
  }

  // Cron auth — fail-closed: reject when CRON_SECRET is unset OR header
  // doesn't match.  The old `secret && ...` guard failed open when env was
  // missing.  Mirror the pattern in api/telegram/webhook.ts.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false });
  }

  try {
    // Reap rows stuck in 'ingesting' (pre-property only — see reapStuckIngesting
    // JSDoc for why post-property rows are excluded).  Best-effort Telegram
    // notification per reaped row so the operator knows to re-tap Generate.
    const staleMinutes = Number(process.env.DRIVE_INGEST_STALE_MINUTES ?? 30);
    const reaped = await reapStuckIngesting(staleMinutes);
    for (const row of reaped) {
      sendMessage(
        `⚠️ *${escapeMarkdown(row.address)}* intake was stuck in ingesting for >${staleMinutes}m — reset to awaiting\\_approval\\. Tap Generate to retry\\.`,
      ).catch(() => {});
    }

    const result = await pollResults();
    return res.status(200).json({ ok: true, notified: result.notified, reaped: reaped.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/drive-intake-poll] failed:", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
}
