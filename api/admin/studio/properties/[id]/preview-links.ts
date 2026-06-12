import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../../lib/auth.js';
import { getSupabase } from '../../../../../lib/client.js';

/** Returns newest client + public preview links for a property, with view stats.
 *  Rows are ordered newest-first by the DB; we pick the first of each kind. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const propertyId = String(req.query.id);

  const { data, error } = await getSupabase()
    .from('property_previews')
    .select('id, token, kind, allow_download, allow_approve, allow_revision, approved_at, viewed_count, last_viewed_at, created_at')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  type Row = {
    id: string;
    token: string;
    kind: string;
    allow_download: boolean;
    allow_approve: boolean;
    allow_revision: boolean;
    approved_at: string | null;
    viewed_count: number;
    last_viewed_at: string | null;
    created_at: string;
  };

  const rows = (data ?? []) as Row[];

  // Surface newest per kind (rows already ordered DESC by created_at)
  const clientLink = rows.find((r) => r.kind === 'client') ?? null;
  const publicLink = rows.find((r) => r.kind === 'public') ?? null;

  return res.status(200).json({ client: clientLink, public: publicLink });
}
