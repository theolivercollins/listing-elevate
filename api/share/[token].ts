import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/client.js';
import {
  evaluateShareAccess,
  buildSharePayload,
  getPlaybackUrl,
  getDownloadUrl,
} from '../../lib/operator-studio/creatives.js';
import type { CreativeRow } from '../../lib/types/creatives.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token ?? '');
  if (!token) return res.status(400).json({ error: 'missing token' });

  const password =
    req.method === 'POST'
      ? (req.body?.password != null ? String(req.body.password) : null)
      : req.query.password != null
        ? String(req.query.password)
        : null;

  const supabase = getSupabase();
  const { data: row } = await supabase
    .from('creatives')
    .select('*')
    .eq('share_token', token)
    .maybeSingle();
  if (!row) return res.status(404).json({ error: 'not found' });

  const creative = row as CreativeRow;
  const ctx = req.query.ctx;

  if (ctx === 'embed' && !creative.allow_embed) {
    return res.status(403).json({ error: 'embedding disabled' });
  }
  if (ctx !== 'embed' && !creative.presentation_enabled) {
    return res.status(404).json({ error: 'not available' });
  }

  const access = evaluateShareAccess(creative, { now: new Date(), password });
  if (access.status === 'expired') return res.status(410).json({ error: 'expired' });
  if (access.status === 'password_required') {
    return res.status(401).json({ requiresPassword: true });
  }

  const playbackUrl = await getPlaybackUrl(creative, getSupabase());
  const downloadUrl = creative.allow_download
    ? await getDownloadUrl(creative, getSupabase())
    : null;

  try {
    await getSupabase().rpc('increment_creative_view', { p_token: token });
  } catch {
    // View tracking is best-effort; never fail the request on counter errors.
  }

  return res.status(200).json(buildSharePayload(creative, playbackUrl, downloadUrl));
}
