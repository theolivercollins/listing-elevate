import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getSupabase } from '../../../../lib/client.js';

/**
 * Returns true when a Supabase/PostgREST error indicates the table does not
 * exist yet — the 085 migration has not been applied.
 */
function isMigrationPending(error: unknown): boolean {
  return (error as { code?: string }).code === '42P01';
}

/**
 * PATCH /api/admin/studio/video-folders/[id]
 *   Body: { name?: string; position?: number }
 *   Updates folder name and/or position. Returns 200 { folder }.
 *
 * DELETE /api/admin/studio/video-folders/[id]
 *   Deletes the folder row. The FK ON DELETE SET NULL in migration 085
 *   automatically un-files any videos in this folder (sets their
 *   video_library_meta.folder_id to NULL). Returns 204.
 *
 * Both routes are admin-gated. Returns 503 { error: 'migration_pending' }
 * when the video_folders table does not exist yet (42P01).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) {
    return res.status(400).json({ error: 'id_required' });
  }

  const db = getSupabase();

  // -------------------------------------------------------------------------
  // PATCH — update name and/or position
  // -------------------------------------------------------------------------
  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const patch: { name?: string; position?: number } = {};
    if (typeof body.name === 'string') patch.name = body.name.trim();
    if (typeof body.position === 'number') patch.position = body.position;

    // Reject empty payloads early.
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'nothing_to_update' });
    }

    const { data, error } = await db
      .from('video_folders')
      .update(patch)
      .eq('id', id)
      .select('id, name, position')
      .single();

    if (error) {
      if (isMigrationPending(error)) {
        return res.status(503).json({ error: 'migration_pending' });
      }
      return res.status(500).json({ error: (error as { message: string }).message });
    }

    return res.status(200).json({ folder: data });
  }

  // -------------------------------------------------------------------------
  // DELETE — remove the folder row
  // -------------------------------------------------------------------------

  const { error } = await db
    .from('video_folders')
    .delete()
    .eq('id', id);

  if (error) {
    if (isMigrationPending(error)) {
      return res.status(503).json({ error: 'migration_pending' });
    }
    return res.status(500).json({ error: (error as { message: string }).message });
  }

  return res.status(204).json({});
}
