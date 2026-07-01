import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin, setNoStore } from '../../../../lib/auth.js';
import { submitWalkthrough, pollWalkthrough } from '../../../../lib/walkthrough/generate.js';

// Default maxDuration (no export override): neither handler blocks on the
// Atlas render (~500s). POST only submits the job; GET only checks status.
// Registered in vercel.json as /api/admin/studio/walkthrough/([^/]+) — see
// lib/__tests__/vercel-routes.test.ts GUARDED_PATHS for the regression guard.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setNoStore(res);

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const propertyId = req.query.propertyId as string | undefined;
  if (!propertyId) {
    return res.status(400).json({ error: 'propertyId required' });
  }

  if (req.method === 'POST') {
    try {
      const result = await submitWalkthrough(propertyId);
      return res.status(200).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin/studio/walkthrough] submit failed:', propertyId, msg, err);
      return res.status(500).json({ error: msg });
    }
  }

  if (req.method === 'GET') {
    try {
      const result = await pollWalkthrough(propertyId);
      return res.status(200).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[admin/studio/walkthrough] poll failed:', propertyId, msg, err);
      return res.status(500).json({ error: msg });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
}
