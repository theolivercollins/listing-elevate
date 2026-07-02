import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProperty, getPhotosForProperty, getScenesForProperty, getSupabase, getRatingsForProperty } from '../../lib/db.js';
import { verifyAuth, setNoStore } from '../../lib/auth.js';
import type { PipelineMode } from '../../lib/types.js';

const VALID_PIPELINE_MODES: PipelineMode[] = ['v1', 'v1.1'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Cache-safety (§8): this endpoint calls verifyAuth directly (not via
  // requireAuth) so it must set no-store/Vary itself. Set before auth
  // resolution so it applies to every response path, including errors —
  // the same URL can return different bodies per impersonation token.
  setNoStore(res);

  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'PATCH') {
    return handlePatch(req, res);
  }
  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  // Auth gate — property detail requires a valid session; caller must be the
  // property owner or an admin. Internal margin data (costEvents) is stripped
  // for non-admins to prevent cost exposure to customers.
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const id = req.query.id as string;
    const property = await getProperty(id);

    const isOwner = property.submitted_by === auth.user.id;
    const isAdmin = auth.profile.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Run all independent reads concurrently after the ownership check.
    // Cost events contain internal margin data — admins only.
    const [photos, scenes, ratings, costEvents] = await Promise.all([
      getPhotosForProperty(id),
      getScenesForProperty(id),
      getRatingsForProperty(id),
      isAdmin
        ? getSupabase()
            .from('cost_events')
            .select('id, scene_id, stage, provider, units_consumed, unit_type, cost_cents, metadata, created_at')
            .eq('property_id', id)
            .order('created_at', { ascending: true })
            .then((r): unknown[] => r.data ?? [])
        : Promise.resolve<unknown[]>([]),
    ]);

    // Denormalize ratings onto scenes so the frontend has one object per scene.
    const ratingByScene = new Map(ratings.map(r => [r.scene_id, r]));
    const scenesWithRating = scenes.map(s => ({
      ...s,
      rating: ratingByScene.get(s.id) ?? null,
    }));

    return res.status(200).json({
      ...property,
      photos,
      scenes: scenesWithRating,
      costEvents,
    });
  } catch {
    return res.status(404).json({ error: 'Property not found' });
  }
}

async function handlePatch(req: VercelRequest, res: VercelResponse) {
  // Auth gate — only the property owner or an admin may write pipeline_mode.
  const auth = await verifyAuth(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const id = req.query.id as string;
    const { pipeline_mode } = req.body as { pipeline_mode?: unknown };

    if (pipeline_mode !== undefined) {
      if (!VALID_PIPELINE_MODES.includes(pipeline_mode as PipelineMode)) {
        return res.status(400).json({
          error: `Invalid pipeline_mode. Must be one of: ${VALID_PIPELINE_MODES.join(', ')}`,
        });
      }
    }

    let property;
    try {
      property = await getProperty(id);
    } catch {
      // getProperty throws (Supabase single()) when no row matches — return 404.
      return res.status(404).json({ error: 'Property not found' });
    }

    // Only the property owner (submitted_by) or an admin may mutate pipeline_mode.
    const isOwner = property.submitted_by === auth.user.id;
    const isAdmin = auth.profile.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (pipeline_mode !== undefined) updates.pipeline_mode = pipeline_mode;

    const { data, error } = await getSupabase()
      .from('properties')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.status(200).json(data);
  } catch {
    return res.status(500).json({ error: 'Failed to update property' });
  }
}
