/**
 * GET /api/cron/drive-channel-renew
 *
 * Cron: ensures the Drive push-notification channel stays alive.
 * Drive channels expire after ~7 days. This cron runs daily and renews
 * the channel when it will expire within 24 hours.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { renewChannelIfNeeded } from "../../lib/drive/detect.js";

export const maxDuration = 30;

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
    const result = await renewChannelIfNeeded();
    return res.status(200).json({ ok: true, renewed: result.renewed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/drive-channel-renew] failed:", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
}
