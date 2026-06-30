import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuth } from '../../lib/auth.js';
import { getProperty } from '../../lib/db.js';

export const maxDuration = 300;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const propertyId = req.query.propertyId as string;
  if (!propertyId) {
    return res.status(400).json({ error: 'Missing propertyId' });
  }

  // ── Auth gate (security fix F2): caller must be the property owner or an admin.
  // Before this fix the endpoint was fully unauthenticated — any anonymous caller
  // could trigger unbounded paid provider spend (Gemini/Anthropic/Kling/Runway/
  // ElevenLabs/Creatomate) for any property id. Now mirrors the owner-or-admin
  // pattern from api/properties/[id]/status.ts.
  const auth = await verifyAuth(req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });

  let property;
  try {
    property = await getProperty(propertyId);
  } catch {
    return res.status(404).json({ error: 'Property not found' });
  }

  const isOwner = property.submitted_by === auth.user.id;
  const isAdmin = auth.profile.role === 'admin';
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // ── Non-prod write guard: prevents accidental paid-provider spend outside
  // production (mirrors api/cron/post-subscription-charges.ts:29).
  if (process.env.VERCEL_ENV !== 'production' && process.env.LE_ALLOW_NONPROD_WRITES !== 'true') {
    return res.status(200).json({ ok: true, skipped: 'non-prod' });
  }

  try {
    // Dynamic import to load pipeline only when needed
    const { runPipeline } = await import('../../lib/pipeline.js');

    // Run the pipeline synchronously — this function stays alive for up to 300s
    await runPipeline(propertyId);

    return res.status(200).json({ status: 'complete', propertyId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Pipeline failed for ${propertyId}:`, msg);
    return res.status(500).json({ status: 'failed', propertyId, error: msg });
  }
}
