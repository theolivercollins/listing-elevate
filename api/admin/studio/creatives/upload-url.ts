import crypto from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getSupabase } from '../../../../lib/client.js';

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 200) || 'file';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const writesAllowed =
    process.env.VERCEL_ENV === 'production' ||
    process.env.LE_ALLOW_NONPROD_WRITES === 'true';
  if (!writesAllowed && req.method !== 'GET') {
    return res.status(403).json({ error: 'writes disabled in this environment' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const filename = String(req.body?.filename ?? '');
  if (!filename) return res.status(400).json({ error: 'filename is required' });

  const path = `${crypto.randomUUID()}/${Date.now()}_${sanitize(filename)}`;
  const { data, error } = await getSupabase()
    .storage.from('creatives')
    .createSignedUploadUrl(path);
  if (error || !data) {
    return res.status(500).json({ error: error?.message ?? 'failed to create upload url' });
  }

  return res.status(200).json({ path, token: data.token, signedUrl: data.signedUrl });
}
