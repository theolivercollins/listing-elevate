import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../../lib/auth.js';
import { getSupabase } from '../../../../../lib/client.js';

const VALID_ACTIONS = ['move', 'archive', 'restore', 'delete'] as const;
type LibraryAction = (typeof VALID_ACTIONS)[number];

function isValidAction(v: unknown): v is LibraryAction {
  return VALID_ACTIONS.includes(v as LibraryAction);
}

/**
 * POST /api/admin/studio/videos/[id]/library
 *
 * Per-video library action endpoint (spec §2 — library actions).
 * id (req.query.id) is the property_id.
 *
 * Body: { action: 'move'|'archive'|'restore'|'delete', folder_id?: string | null }
 *
 * Actions:
 *   move    → upsert video_library_meta.folder_id (null = unfile)
 *   archive → upsert archived_at = now()
 *   restore → upsert archived_at = null
 *   delete  → upsert library_deleted_at = now() AND delete property_previews rows
 *             (preview_view_events cascade via 084 FK). properties + cost_events untouched.
 *
 * Pre-migration tolerance: 42P01 (table absent) → 503 { error: 'migration_pending' }.
 * Admin-gated; service-role client; ESM .js imports.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const propertyId = String(req.query.id);
  const { action, folder_id } = req.body as {
    action?: unknown;
    folder_id?: string | null;
  };

  if (!isValidAction(action)) {
    return res.status(400).json({
      error: `invalid_action — must be one of: ${VALID_ACTIONS.join(', ')}`,
    });
  }

  const db = getSupabase();
  const now = new Date().toISOString();

  // Build the fields to upsert into video_library_meta based on the action.
  // Only set the fields relevant to this action — leave others untouched in
  // the existing row (upsert merges; we do not reset unrelated columns).
  let metaFields: Record<string, unknown>;

  switch (action) {
    case 'move':
      // folder_id may be explicitly null (unfile) or a uuid (file into folder).
      // Per spec: "folder_id may be null to unfile; move always sets folder_id
      // to the provided value." When the key is absent fall back to null (unfile).
      metaFields = {
        folder_id: Object.prototype.hasOwnProperty.call(req.body, 'folder_id')
          ? (folder_id ?? null)
          : null,
      };
      break;
    case 'archive':
      metaFields = { archived_at: now };
      break;
    case 'restore':
      metaFields = { archived_at: null };
      break;
    case 'delete':
      metaFields = { library_deleted_at: now };
      break;
  }

  // Upsert the video_library_meta row keyed by property_id.
  // A missing row is created; an existing row is updated. updated_at tracks the change.
  const { error: upsertError } = await db
    .from('video_library_meta')
    .upsert(
      { property_id: propertyId, ...metaFields, updated_at: now },
      { onConflict: 'property_id' },
    );

  if (upsertError) {
    // 42P01 = relation does not exist → migration has not been applied yet.
    // Return 503 so the caller knows to wait rather than seeing an opaque 500.
    if ((upsertError as { code?: string }).code === '42P01') {
      return res.status(503).json({ error: 'migration_pending' });
    }
    return res.status(500).json({ error: upsertError.message });
  }

  // For 'delete': remove the property's preview/share links so they 404 hereafter.
  // preview_view_events cascade via the ON DELETE CASCADE FK added in migration 084 —
  // do NOT manually delete preview_view_events here (cascade handles it).
  // ACCOUNTING RETENTION: properties row and cost_events are never touched here.
  if (action === 'delete') {
    const { error: deleteError } = await db
      .from('property_previews')
      .delete()
      .eq('property_id', propertyId);

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }
  }

  return res.status(200).json({ ok: true });
}
