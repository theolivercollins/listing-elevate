import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth.js';
import { VOICES, type Voice } from '../../../lib/voiceover/voices.js';
import { getSupabase } from '../../../lib/client.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : null;
  let clientVoiceId: string | null = null;
  let clientName: string | null = null;
  if (clientId) {
    const { data } = await getSupabase()
      .from('clients')
      .select('voice_id, name')
      .eq('id', clientId)
      .maybeSingle();
    const row = data as { voice_id?: string | null; name?: string | null } | null;
    clientVoiceId = row?.voice_id ?? null;
    clientName = row?.name ?? null;
  }
  // A client's custom ElevenLabs voice isn't in the hardcoded catalog —
  // synthesize an entry so the picker can show it (no ElevenLabs API call).
  let voices: Voice[] = VOICES;
  if (clientVoiceId && !VOICES.some((v) => v.id === clientVoiceId)) {
    const clientVoice: Voice = {
      id: clientVoiceId,
      name: clientName ? `${clientName} (client voice)` : 'Client voice',
      gender: 'custom',
      description: "Client's custom ElevenLabs voice",
    };
    voices = [clientVoice, ...VOICES];
  }
  return res.status(200).json({ voices, client_voice_id: clientVoiceId });
}
