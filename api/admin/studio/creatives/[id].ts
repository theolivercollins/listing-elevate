import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getSupabase } from '../../../../lib/client.js';
import { hashPassword } from '../../../../lib/operator-studio/creatives.js';
import type { CreativeRow } from '../../../../lib/types/creatives.js';

const PATCHABLE = [
  'title',
  'description',
  'visibility',
  'allow_download',
  'allow_embed',
  'presentation_enabled',
  'expires_at',
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const writesAllowed =
    process.env.VERCEL_ENV === 'production' ||
    process.env.LE_ALLOW_NONPROD_WRITES === 'true';
  if (!writesAllowed && req.method !== 'GET') {
    return res.status(403).json({ error: 'writes disabled in this environment' });
  }

  const id = String(req.query.id);
  const supabase = getSupabase();

  if (req.method === 'PATCH') {
    const body = req.body ?? {};
    const update: Record<string, unknown> = {};
    for (const key of PATCHABLE) {
      if (key in body) update[key] = body[key];
    }
    // Never accept password_hash directly; derive it from `password`.
    if ('password' in body) {
      update.password_hash = body.password ? hashPassword(String(body.password)) : null;
    }
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('creatives')
      .update(update)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not found' });
    return res.status(200).json({ creative: data as CreativeRow });
  }

  if (req.method === 'DELETE') {
    const { data: row, error: loadErr } = await supabase
      .from('creatives')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (loadErr) return res.status(500).json({ error: loadErr.message });
    if (!row) return res.status(404).json({ error: 'not found' });

    const creative = row as CreativeRow;
    if (creative.source === 'upload' && creative.storage_path) {
      await supabase.storage.from(creative.bucket).remove([creative.storage_path]);
    }
    const { error: delErr } = await supabase.from('creatives').delete().eq('id', id);
    if (delErr) return res.status(500).json({ error: delErr.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
