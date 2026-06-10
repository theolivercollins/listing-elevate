import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth.js';
import { getSupabase } from '../../../lib/client.js';
import { moodForPackage } from '../../../lib/assembly/music.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const videoType = typeof req.query.video_type === 'string' ? req.query.video_type : null;
  const mood = moodForPackage(videoType);
  const { data, error } = await getSupabase()
    .from('music_tracks')
    .select('id, name, file_url, mood_tag, source')
    .eq('mood_tag', mood)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(3);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ mood, tracks: data ?? [] });
}
