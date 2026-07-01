/**
 * GET /api/cron/studio-draft-cleanup
 *
 * Daily cron (04:00 UTC — vercel.json): deletes studio_drafts rows idle for
 * 14+ days and best-effort removes their uploaded photos from the
 * property-photos Storage bucket. See lib/studio/draft-cleanup.ts for the
 * testable core.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cleanupStaleDrafts } from '../../lib/studio/draft-cleanup.js';

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Cron auth — fail-closed: reject when CRON_SECRET is unset OR the header
  // doesn't match. Mirrors api/cron/drive-channel-renew.ts.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false });
  }

  // Prod-write guard — this cron deletes rows AND storage objects; only run
  // for real on production (or with the explicit non-prod opt-in), matching
  // api/admin/studio/creatives/[id].ts and api/admin/studio/drafts/*.
  const writesAllowed =
    process.env.VERCEL_ENV === 'production' ||
    process.env.LE_ALLOW_NONPROD_WRITES === 'true';
  if (!writesAllowed) {
    return res.status(200).json({ ok: true, skipped: 'nonprod' });
  }

  try {
    const result = await cleanupStaleDrafts();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/studio-draft-cleanup] failed:', msg);
    return res.status(500).json({ ok: false, error: msg });
  }
}
