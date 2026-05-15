// Studio-local wrapper: returns latest 50 prompt_lab_listing_scene_iterations
// filtered by room_type. Created to avoid a dependency on the Lab listing-scoped
// API surface, which requires a listing_id + scene_id chain.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth.js';
import { getSupabase } from '../../../lib/client.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const roomType = req.query.room_type ? String(req.query.room_type) : null;
  const db = getSupabase();

  let data: unknown[] | null = null;
  let error: { message: string } | null = null;

  if (roomType) {
    // Join via scene to filter by room_type; filter null-joined rows afterwards
    const result = await db
      .from('prompt_lab_listing_scene_iterations')
      .select('id, scene_id, iteration_number, clip_url, rating, created_at, prompt, provider, sku, scene:scene_id(room_type)')
      .eq('scene.room_type', roomType)
      .order('created_at', { ascending: false })
      .limit(50);
    data = result.data as unknown[] | null;
    error = result.error as { message: string } | null;
    // Filter out rows where the join didn't match (scene is null or empty)
    if (data) {
      data = (data as Array<Record<string, unknown>>).filter((r) => {
        const scene = r.scene;
        return scene !== null && scene !== undefined && !(Array.isArray(scene) && scene.length === 0);
      });
    }
  } else {
    const result = await db
      .from('prompt_lab_listing_scene_iterations')
      .select('id, scene_id, iteration_number, clip_url, rating, created_at, prompt, provider, sku')
      .order('created_at', { ascending: false })
      .limit(50);
    data = result.data as unknown[] | null;
    error = result.error as { message: string } | null;
  }

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ iterations: data ?? [] });
}
