import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getSupabase } from '../../../../lib/client.js';
import { generateShareToken } from '../../../../lib/operator-studio/creatives.js';
import type { CreativeRow } from '../../../../lib/types/creatives.js';

function publicBase(): string {
  return process.env.LE_PUBLIC_BASE_URL ?? 'https://listingelevate.com';
}

function withUrls(row: CreativeRow): CreativeRow & { shareUrl: string; embedUrl: string } {
  const base = publicBase();
  return {
    ...row,
    shareUrl: `${base}/v/${row.share_token}`,
    embedUrl: `${base}/embed/${row.share_token}`,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const writesAllowed =
    process.env.VERCEL_ENV === 'production' ||
    process.env.LE_ALLOW_NONPROD_WRITES === 'true';
  if (!writesAllowed && req.method !== 'GET') {
    return res.status(403).json({ error: 'writes disabled in this environment' });
  }

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('creatives')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const rows = (data ?? []).map((r) => withUrls(r as CreativeRow));
    return res.status(200).json({ creatives: rows });
  }

  if (req.method === 'POST') {
    const mode = req.body?.mode;

    if (mode === 'upload') {
      const { storage_path, title, kind } = req.body ?? {};
      if (!storage_path || !title || !kind) {
        return res.status(400).json({ error: 'storage_path, title, and kind are required' });
      }
      const insert = {
        source: 'upload' as const,
        kind,
        bucket: 'creatives',
        storage_path,
        title,
        description: req.body.description ?? null,
        mime_type: req.body.mime_type ?? null,
        file_size_bytes: req.body.file_size_bytes ?? null,
        width: req.body.width ?? null,
        height: req.body.height ?? null,
        duration_seconds: req.body.duration_seconds ?? null,
        share_token: generateShareToken(),
      };
      const { data, error } = await supabase
        .from('creatives')
        .insert(insert)
        .select('*')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ creative: withUrls(data as CreativeRow) });
    }

    if (mode === 'render') {
      const { property_id, orientation, title } = req.body ?? {};
      if (!property_id || !title) {
        return res.status(400).json({ error: 'property_id and title are required' });
      }
      if (orientation !== 'horizontal' && orientation !== 'vertical') {
        return res.status(400).json({ error: "orientation must be 'horizontal' or 'vertical'" });
      }
      const { data: property, error: propErr } = await supabase
        .from('properties')
        .select('horizontal_video_url,vertical_video_url,address')
        .eq('id', property_id)
        .maybeSingle();
      if (propErr) return res.status(500).json({ error: propErr.message });
      if (!property) return res.status(404).json({ error: 'property not found' });

      const url =
        orientation === 'horizontal'
          ? property.horizontal_video_url
          : property.vertical_video_url;
      if (!url) {
        return res.status(422).json({ error: `property has no ${orientation} video` });
      }

      const insert = {
        source: 'render' as const,
        kind: 'video' as const,
        bucket: 'property-videos',
        public_url: url,
        property_id,
        title,
        share_token: generateShareToken(),
      };
      const { data, error } = await supabase
        .from('creatives')
        .insert(insert)
        .select('*')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ creative: withUrls(data as CreativeRow) });
    }

    return res.status(400).json({ error: "mode must be 'upload' or 'render'" });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
