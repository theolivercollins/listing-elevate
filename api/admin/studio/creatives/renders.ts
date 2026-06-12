import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getSupabase } from '../../../../lib/client.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('properties')
    .select('id,address,horizontal_video_url,vertical_video_url')
    .or('horizontal_video_url.not.is.null,vertical_video_url.not.is.null')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ renders: data ?? [] });
}
