/**
 * GET /api/cron/drive-intake-poll
 *
 * Cron: polls drive_intake rows in 'generating' status and notifies Telegram
 * when the associated property pipeline has completed or failed.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { pollResults } from "../../lib/drive/detect.js";

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Global kill-switch
  if (process.env.DRIVE_INTAKE_ENABLED !== "true") {
    return res.status(200).json({ ok: true, skipped: "disabled" });
  }

  // Cron auth
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false });
  }

  try {
    const result = await pollResults();
    return res.status(200).json({ ok: true, notified: result.notified });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/drive-intake-poll] failed:", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
}
