import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../../lib/auth.js';
import { getSupabase } from '../../../../../lib/client.js';

/** Returns newest client + public preview links for a property, with view stats.
 *  Rows are ordered newest-first by the DB; we pick the first of each kind.
 *
 *  Pre-migration tolerant: show_branding is a migration-087 column. PostgREST
 *  returns error code 42703 (undefined_column) if we request it before the migration
 *  is applied. On that error we retry without show_branding and fall back to true
 *  (matching the DB default). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const propertyId = String(req.query.id);

  const PRIMARY_COLS =
    'id, token, kind, allow_download, allow_approve, allow_revision, approved_at, show_branding, viewed_count, last_viewed_at, created_at';
  const FALLBACK_COLS =
    'id, token, kind, allow_download, allow_approve, allow_revision, approved_at, viewed_count, last_viewed_at, created_at';

  type Row = {
    id: string;
    token: string;
    kind: string;
    allow_download: boolean;
    allow_approve: boolean;
    allow_revision: boolean;
    approved_at: string | null;
    show_branding?: boolean;
    viewed_count: number;
    last_viewed_at: string | null;
    created_at: string;
  };

  let rows: Row[];

  const primary = await getSupabase()
    .from('property_previews')
    .select(PRIMARY_COLS)
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });

  if (primary.error) {
    if ((primary.error as { code?: string }).code === '42703') {
      // Migration-087 column absent — retry without show_branding; falls back to true.
      const fallback = await getSupabase()
        .from('property_previews')
        .select(FALLBACK_COLS)
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false });
      if (fallback.error) return res.status(500).json({ error: fallback.error.message });
      rows = (fallback.data ?? []) as Row[];
    } else {
      return res.status(500).json({ error: primary.error.message });
    }
  } else {
    rows = (primary.data ?? []) as Row[];
  }

  // Surface newest per kind (rows already ordered DESC by created_at).
  // Normalise show_branding: absent (pre-087) → true (DB default).
  const normalize = (r: Row | undefined) =>
    r ? { ...r, show_branding: r.show_branding ?? true } : null;

  const clientLink = normalize(rows.find((r) => r.kind === 'client'));
  const publicLink = normalize(rows.find((r) => r.kind === 'public'));

  return res.status(200).json({ client: clientLink, public: publicLink });
}
