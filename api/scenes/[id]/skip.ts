import type { VercelRequest, VercelResponse } from '@vercel/node';
import { updateScene, log, getSupabase } from '../../../lib/db.js';
import { requireAdmin } from '../../../lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // F4: admin-only gate — operator QC action, not customer-facing
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  // Env write-guard — prevents accidental QC state mutations on non-prod
  if (process.env.VERCEL_ENV !== 'production' && process.env.LE_ALLOW_NONPROD_WRITES !== 'true') {
    return res.status(200).json({ ok: true, skipped: 'non-prod' });
  }

  try {
    const id = req.query.id as string;

    const { data: scene } = await getSupabase()
      .from('scenes')
      .select('property_id, scene_number')
      .eq('id', id)
      .single();

    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    await updateScene(id, { status: 'qc_pass', clip_url: null });
    await log(scene.property_id, 'qc', 'info',
      `Scene ${scene.scene_number} skipped`, undefined, id);

    return res.status(200).json({ message: 'Scene skipped' });
  } catch {
    return res.status(500).json({ error: 'Failed to skip' });
  }
}
