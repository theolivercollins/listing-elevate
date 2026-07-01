import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { deleteDraft } from '../../../../lib/studio/drafts.js';
import { purgeDraftStorageForOwner } from '../../../../lib/studio/draft-cleanup.js';

/**
 * DELETE /api/admin/studio/drafts/[id]
 *   Deletes the calling admin's own draft — deleteDraft() scopes the delete
 *   to (id AND submitted_by), so a mismatched id/owner pair silently no-ops
 *   rather than leaking a 404/403 distinction. Returns 204.
 *
 *   ?purge=1 additionally reclaims the draft's Storage objects (service-role),
 *   applying the SAME "skip any path still referenced by a live property's
 *   photos.file_url" guard as the cleanup cron. Discard sends ?purge=1; submit
 *   deletes the ROW ONLY (no purge) — fast, and safe because a just-submitted
 *   property still points at those SHARED objects.
 *
 * Gated by the standard prod-write guard (VERCEL_ENV==='production' ||
 * LE_ALLOW_NONPROD_WRITES==='true'), matching
 * api/admin/studio/creatives/[id].ts and api/admin/studio/drafts/index.ts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'method_not_allowed' });

  const writesAllowed =
    process.env.VERCEL_ENV === 'production' ||
    process.env.LE_ALLOW_NONPROD_WRITES === 'true';
  if (!writesAllowed) {
    return res.status(403).json({ error: 'writes disabled in this environment' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) return res.status(400).json({ error: 'id_required' });

  const purge =
    req.query.purge === '1' ||
    (typeof req.body === 'object' && req.body !== null && (req.body as { purge?: unknown }).purge === true);

  try {
    if (purge) {
      // Best-effort storage reclaim BEFORE the row delete. A failure here must
      // never block clearing the draft — Discard always has to remove the
      // resumable row — and the purge itself never deletes a referenced object.
      try {
        await purgeDraftStorageForOwner(id, admin.user.id);
      } catch (err) {
        console.warn(
          '[drafts/[id]] storage purge failed; deleting row anyway:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    await deleteDraft(id, admin.user.id);
    return res.status(204).json({});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
