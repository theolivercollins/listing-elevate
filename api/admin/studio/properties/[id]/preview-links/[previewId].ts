import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../../../lib/auth.js';
import { getSupabase } from '../../../../../../lib/client.js';

const CAPABILITY_FIELDS = ['allow_download', 'allow_approve', 'allow_revision'] as const;
type CapabilityField = typeof CAPABILITY_FIELDS[number];

const LABEL_MAX_LEN = 200;

/** PATCH /api/admin/studio/properties/[id]/preview-links/[previewId]
 *  Accepts a subset of capability booleans, an optional `label` (string|null),
 *  and an optional `revoked` boolean (true → stamp revoked_at=now(), false → clear).
 *  Pre-migration tolerant: label/revoked_at are only included in the patch object
 *  when the caller actually supplied them, so a column-missing DB error only occurs
 *  when those fields were intentionally provided.
 *  Returns the full updated row on success. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'method_not_allowed' });

  const propertyId = String(req.query.id);
  const previewId = String(req.query.previewId);

  const body = req.body ?? {};

  // ── capability fields ───────────────────────────────────────────────────────
  const patch: Record<string, unknown> = {};

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

  // ── label (string|null) — only included when supplied ──────────────────────
  if ('label' in body) {
    const raw = body.label;
    if (raw !== null && typeof raw !== 'string') {
      return res.status(400).json({
        error: 'invalid_field',
        message: 'label must be a string or null',
      });
    }
    // Clamp to LABEL_MAX_LEN characters; null passes through unchanged.
    patch.label = raw !== null ? (raw as string).slice(0, LABEL_MAX_LEN) : null;
  }

  // ── revoked (boolean) — true stamps revoked_at=now(), false clears ─────────
  if ('revoked' in body) {
    const raw = body.revoked;
    if (typeof raw !== 'boolean') {
      return res.status(400).json({
        error: 'invalid_field',
        message: 'revoked must be a boolean',
      });
    }
    patch.revoked_at = raw ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({
      error: 'no_fields',
      message: `body must include at least one of: ${CAPABILITY_FIELDS.join(', ')}, label, revoked`,
    });
  }

  const { data, error } = await getSupabase()
    .from('property_previews')
    .update(patch)
    .eq('property_id', propertyId)
    .eq('id', previewId)
    .select('id, token, kind, allow_download, allow_approve, allow_revision, approved_at, label, revoked_at, viewed_count, last_viewed_at, created_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data);
}
