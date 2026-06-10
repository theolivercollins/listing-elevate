import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth.js';
import { VOICES } from '../../../lib/voiceover/voices.js';
import { getSupabase } from '../../../lib/client.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : null;
  let clientVoiceId: string | null = null;
  if (clientId) {
    const { data } = await getSupabase()
      .from('clients')
      .select('voice_id')
      .eq('id', clientId)
      .maybeSingle();
    clientVoiceId = (data as { voice_id?: string | null } | null)?.voice_id ?? null;
  }
  return res.status(200).json({ voices: VOICES, client_voice_id: clientVoiceId });
}
