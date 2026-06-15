import type { VercelRequest, VercelResponse } from '@vercel/node';
import { upsertSceneRating, getSupabase } from '../../../lib/db.js';

type SupabaseAuthWithGetUser = {
  getUser(token: string): Promise<{
    data: { user: { id: string } | null };
    error: { message: string } | null;
  }>;
};

// Admin-only rating endpoint. Upserts one rating per scene (unique
// constraint on scene_id) with rating 1-5, free-text comment, and
// optional tags array. Used by the admin dashboard Deliverables card.
//
// Auth: verified server-side via the caller's bearer JWT against
// user_profiles.role. Every rating is attributed to the admin's
// user_id in rated_by for audit trail.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sceneId = req.query.id as string;
    const { rating, comment, tags } = (req.body ?? {}) as {
      rating?: number;
      comment?: string | null;
      tags?: string[] | null;
    };

    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be an integer 1-5' });
    }

    // Auth: require a bearer token and verify the caller is an admin.
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing bearer token' });
    }
    const token = auth.slice(7);
    const supabase = getSupabase();
    const { data: userData, error: userErr } = await (
      supabase.auth as unknown as SupabaseAuthWithGetUser
    ).getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'invalid token' });
    }
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', userData.user.id)
      .single();
    if (!profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'admin only' });
    }

    // Look up the scene to get its property_id (denormalized onto the rating).
    const { data: scene, error: sceneErr } = await supabase
      .from('scenes')
      .select('id, property_id')
      .eq('id', sceneId)
      .single();
    if (sceneErr || !scene) {
      return res.status(404).json({ error: 'scene not found' });
    }

    const row = await upsertSceneRating({
      scene_id: scene.id,
      property_id: scene.property_id,
      rating: Math.round(rating),
      comment: typeof comment === 'string' && comment.trim().length > 0 ? comment.trim() : null,
      tags: Array.isArray(tags) && tags.length > 0 ? tags.filter(t => typeof t === 'string') : null,
      rated_by: userData.user.id,
    });

    return res.status(200).json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'rating failed', detail: msg });
  }
}
