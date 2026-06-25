/**
 * GET /api/cron/drive-settle
 *
 * Cron: runs on a schedule (see vercel.json) to promote drive_intake rows from
 * 'detected' → 'awaiting_approval' once their photo count has been stable for
 * DRIVE_SETTLE_MINUTES (default 10).
 *
 * Also runs reconcileWatchedFolder as a safety net in case a Drive push ping
 * was missed since the last cron tick.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { reconcileWatchedFolder, settleAndPrompt } from "../../lib/drive/detect.js";

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Global kill-switch
  if (process.env.DRIVE_INTAKE_ENABLED !== "true") {
    return res.status(200).json({ ok: true, skipped: "disabled" });
  }

  // Cron auth — Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false });
  }

  try {
    const reconcile = await reconcileWatchedFolder();
    const settle = await settleAndPrompt(
      Number(process.env.DRIVE_SETTLE_MINUTES ?? 10),
    );

    return res.status(200).json({
      ok: true,
      seen: reconcile.seen,
      prompted: settle.prompted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/drive-settle] failed:", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
}
