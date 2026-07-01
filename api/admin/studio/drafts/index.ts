import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getLatestDraft, upsertDraft } from '../../../../lib/studio/drafts.js';

/**
 * GET /api/admin/studio/drafts
 *   Returns { draft: StudioDraftRow | null } — the calling admin's own
 *   in-progress New Order draft (there is at most one; migration 099
 *   enforces unique(submitted_by)). Always allowed, including on non-prod
 *   deploys without the write opt-in, so the resume-banner check never
 *   breaks on preview.
 *
 * PUT/POST /api/admin/studio/drafts
 *   Upserts the calling admin's single draft row. Body is the current
 *   StudioNew form snapshot (see lib/studio/drafts.ts StudioDraftInput).
 *   Returns 200 { draft }.
 *
 * Both mutating verbs are gated by the standard prod-write guard
 * (VERCEL_ENV==='production' || LE_ALLOW_NONPROD_WRITES==='true'), matching
 * api/admin/studio/creatives/[id].ts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    try {
      const draft = await getLatestDraft(admin.user.id);
      return res.status(200).json({ draft });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const writesAllowed =
      process.env.VERCEL_ENV === 'production' ||
      process.env.LE_ALLOW_NONPROD_WRITES === 'true';
    if (!writesAllowed) {
      return res.status(403).json({ error: 'writes disabled in this environment' });
    }
    try {
      const draft = await upsertDraft(admin.user.id, req.body ?? {});
      return res.status(200).json({ draft });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
