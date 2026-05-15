import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth';
import { manualIngest } from '../../../lib/operator-studio/ingest';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const id = await manualIngest(req.body);
    return res.status(201).json({ property_id: id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/required|at least|invalid/i.test(msg)) return res.status(400).json({ error: msg });
    console.error('[admin/studio/ingest]', err);
    return res.status(500).json({ error: msg });
  }
}
