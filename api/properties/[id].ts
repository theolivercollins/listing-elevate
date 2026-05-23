import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProperty, getPhotosForProperty, getScenesForProperty, getSupabase, getRatingsForProperty } from '../../lib/db.js';
import type { PipelineMode } from '../../lib/types.js';

const VALID_PIPELINE_MODES: PipelineMode[] = ['v1', 'v1.1'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
  try {
    const id = req.query.id as string;
    const property = await getProperty(id);
    const photos = await getPhotosForProperty(id);
    const scenes = await getScenesForProperty(id);
    const ratings = await getRatingsForProperty(id);
    const { data: costEvents } = await getSupabase()
      .from('cost_events')
      .select('id, scene_id, stage, provider, units_consumed, unit_type, cost_cents, metadata, created_at')
      .eq('property_id', id)
      .order('created_at', { ascending: true });

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
      costEvents: costEvents ?? [],
    });
  } catch {
    return res.status(404).json({ error: 'Property not found' });
  }
}

async function handlePatch(req: VercelRequest, res: VercelResponse) {
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
