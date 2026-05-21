import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../../../lib/auth.js';
import { swapClip } from '../../../../../../lib/operator-studio/clip-swap.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const propertyId = String(req.query.id);
  const sceneIdx = Number(req.query.idx);
  const iterationId = String(req.body?.iteration_id ?? '');
  if (!iterationId) return res.status(400).json({ error: 'iteration_id required' });
  if (!Number.isFinite(sceneIdx) || sceneIdx < 0) return res.status(400).json({ error: 'invalid scene idx' });

  try {
    await swapClip(propertyId, sceneIdx, iterationId);
    return res.status(202).json({ status: 'reassembling' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(/not found|mismatch|required|no clip_url/i.test(msg) ? 400 : 500).json({ error: msg });
  }
}
