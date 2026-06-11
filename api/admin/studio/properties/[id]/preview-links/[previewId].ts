import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../../../lib/auth.js';
import { getSupabase } from '../../../../../../lib/client.js';

const CAPABILITY_FIELDS = ['allow_download', 'allow_approve', 'allow_revision'] as const;
type CapabilityField = typeof CAPABILITY_FIELDS[number];

/** PATCH /api/admin/studio/properties/[id]/preview-links/[previewId]
 *  Accepts a subset of {allow_download, allow_approve, allow_revision} booleans.
 *  Returns the full updated row on success. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'method_not_allowed' });

  const propertyId = String(req.query.id);
  const previewId = String(req.query.previewId);

  const body = req.body ?? {};

  // Build the patch — only recognized capability fields, all must be boolean
  const patch: Partial<Record<CapabilityField, boolean>> = {};
  for (const field of CAPABILITY_FIELDS) {
    if (field in body) {
      if (typeof body[field] !== 'boolean') {
        return res.status(400).json({
          error: 'invalid_field',
          message: `${field} must be a boolean`,
        });
      }
      patch[field] = body[field] as boolean;
    }
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({
      error: 'no_fields',
      message: `body must include at least one of: ${CAPABILITY_FIELDS.join(', ')}`,
    });
  }

  const { data, error } = await getSupabase()
    .from('property_previews')
    .update(patch)
    .eq('property_id', propertyId)
    .eq('id', previewId)
    .select('id, token, kind, allow_download, allow_approve, allow_revision, approved_at, viewed_count, last_viewed_at, created_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data);
}
