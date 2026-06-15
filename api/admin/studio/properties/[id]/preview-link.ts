import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../../lib/auth.js';
import { createPreviewLink } from '../../../../../lib/operator-studio/preview.js';
import { generateListingSeoForProperty } from '../../../../../lib/seo/generate.js';

const VALID_KINDS = ['client', 'public'] as const;
type PreviewKind = typeof VALID_KINDS[number];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const propertyId = String(req.query.id);
  const expiresAt = req.body?.expires_at ?? null;
  const rawKind = req.body?.kind ?? 'client';
  // label is optional; null when absent. createPreviewLink already handles pre-migration
  // by only inserting the column when label is non-null.
  const label: string | null = req.body?.label ?? null;

  if (!VALID_KINDS.includes(rawKind as PreviewKind)) {
    return res.status(400).json({ error: 'invalid_kind', message: `kind must be one of: ${VALID_KINDS.join(', ')}` });
  }

  const kind = rawKind as PreviewKind;

  try {
    const row = await createPreviewLink(propertyId, expiresAt, kind, label);
    const base = process.env.LE_PUBLIC_BASE_URL ?? 'https://listingelevate.com';
    if (kind !== 'public') {
      return res.status(201).json({ token: row.token, url: `${base}/preview/${row.token}` });
    }

    try {
      const seo = await generateListingSeoForProperty({ propertyId, useAi: true });
      return res.status(201).json({ token: row.token, url: `${base}/preview/${row.token}`, seo });
    } catch (seoErr) {
      return res.status(201).json({
        token: row.token,
        url: `${base}/preview/${row.token}`,
        seo_error: seoErr instanceof Error ? seoErr.message : String(seoErr),
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
