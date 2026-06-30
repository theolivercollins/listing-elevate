import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../lib/auth.js';
import { getSupabase } from '../../lib/db.js';

// Returns the full prompt revision history for every system prompt the
// pipeline uses, grouped by prompt_name. Used by the Learning dashboard
// to show a changelog of how the prompts have evolved over time.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('prompt_revisions')
      .select('id, prompt_name, version, body, note, created_at')
      .order('prompt_name', { ascending: true })
      .order('version', { ascending: false });
    if (error) throw error;

    type Row = {
      id: string;
      prompt_name: string;
      version: number;
      body: string;
      note: string | null;
      created_at: string;
    };

    const rows = (data ?? []) as Row[];
    const grouped = new Map<string, Row[]>();
    for (const r of rows) {
      const list = grouped.get(r.prompt_name) ?? [];
      list.push(r);
      grouped.set(r.prompt_name, list);
    }

    return res.status(200).json({
      prompts: Array.from(grouped.entries()).map(([name, revisions]) => ({
        prompt_name: name,
        revisions,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'prompt revisions fetch failed', detail: msg });
  }
}
