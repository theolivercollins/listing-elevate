import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getSupabase } from '../../../../lib/client.js';

interface FolderRow {
  id: string;
  name: string;
  position: number;
}

interface MetaRow {
  folder_id: string | null;
  archived_at: string | null;
  library_deleted_at: string | null;
}

/**
 * Returns true when a Supabase/PostgREST error indicates the table does not
 * exist yet — i.e. the 085 migration has not been applied.
 */
function isMigrationPending(error: unknown): boolean {
  return (error as { code?: string }).code === '42P01';
}

/**
 * GET /api/admin/studio/video-folders
 *   Returns { folders: [{id, name, position, video_count}] } ordered by position.
 *   video_count = count of video_library_meta rows in this folder where
 *   archived_at IS NULL AND library_deleted_at IS NULL.
 *
 * POST /api/admin/studio/video-folders
 *   Body: { name: string }
 *   Inserts a folder with position = max(existing position) + 1.
 *   Returns 201 { folder }.
 *
 * Both routes are admin-gated. Returns 503 { error: 'migration_pending' }
 * when the video_folders table does not exist yet (42P01).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const db = getSupabase();

  // -------------------------------------------------------------------------
  // GET — list all folders with computed video_count
  // -------------------------------------------------------------------------
  if (req.method === 'GET') {
    const { data: foldersData, error: foldersError } = await db
      .from('video_folders')
      .select('id, name, position')
      .order('position', { ascending: true });

    if (foldersError) {
      if (isMigrationPending(foldersError)) {
        return res.status(503).json({ error: 'migration_pending' });
      }
      return res.status(500).json({ error: (foldersError as { message: string }).message });
    }

    const folders = (foldersData ?? []) as FolderRow[];

    // Bucket video_count per folder from video_library_meta in JS (mirrors
    // how videos/index.ts buckets property_previews — no PostgREST aggregate).
    const countByFolder = new Map<string, number>();
    if (folders.length > 0) {
      const folderIds = folders.map((f) => f.id);
      const { data: metaData } = await db
        .from('video_library_meta')
        .select('folder_id, archived_at, library_deleted_at')
        .in('folder_id', folderIds);

      for (const row of ((metaData ?? []) as MetaRow[])) {
        // Count only active (non-archived, non-deleted) videos.
        if (row.archived_at !== null || row.library_deleted_at !== null) continue;
        const fid = row.folder_id;
        if (fid == null) continue;
        countByFolder.set(fid, (countByFolder.get(fid) ?? 0) + 1);
      }
    }

    const result = folders.map((f) => ({
      id: f.id,
      name: f.name,
      position: f.position,
      video_count: countByFolder.get(f.id) ?? 0,
    }));

    return res.status(200).json({ folders: result });
  }

  // -------------------------------------------------------------------------
  // POST — create a new folder
  // -------------------------------------------------------------------------

  const rawName: unknown = (req.body as Record<string, unknown>).name;
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) {
    return res.status(400).json({ error: 'name_required' });
  }

  // Determine next position: fetch existing folders ordered desc by position,
  // take the first row's position value, add 1. If none exist, use 1.
  const { data: existing, error: existingError } = await db
    .from('video_folders')
    .select('position')
    .order('position', { ascending: false })
    .limit(1);

  if (existingError) {
    if (isMigrationPending(existingError)) {
      return res.status(503).json({ error: 'migration_pending' });
    }
    return res.status(500).json({ error: (existingError as { message: string }).message });
  }

  const rows = (existing ?? []) as Array<{ position: number }>;
  const nextPosition = rows.length > 0 ? rows[0].position + 1 : 1;

  const { data: insertData, error: insertError } = await db
    .from('video_folders')
    .insert({ name, position: nextPosition })
    .select('id, name, position')
    .single();

  if (insertError) {
    if (isMigrationPending(insertError)) {
      return res.status(503).json({ error: 'migration_pending' });
    }
    return res.status(500).json({ error: (insertError as { message: string }).message });
  }

  return res.status(201).json({ folder: insertData });
}
