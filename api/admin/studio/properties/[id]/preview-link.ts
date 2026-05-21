import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../../lib/auth.js';
import { createPreviewLink } from '../../../../../lib/operator-studio/preview.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const propertyId = String(req.query.id);
  const expiresAt = req.body?.expires_at ?? null;
  try {
    const row = await createPreviewLink(propertyId, expiresAt);
    const base = process.env.LE_PUBLIC_BASE_URL ?? 'https://listingelevate.com';
    return res.status(201).json({ token: row.token, url: `${base}/preview/${row.token}` });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
