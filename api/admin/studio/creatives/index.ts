import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getSupabase } from '../../../../lib/client.js';
import { generateShareToken, getPlaybackUrl } from '../../../../lib/operator-studio/creatives.js';
import { bunnyEmbedUrl } from '../../../../lib/providers/bunny-stream.js';
import type { CreativeRow } from '../../../../lib/types/creatives.js';

function publicBase(): string {
  return process.env.LE_PUBLIC_BASE_URL ?? 'https://listingelevate.com';
}

type CreativeWithUrls = CreativeRow & {
  shareUrl: string;
  embedUrl: string;
  previewUrl: string | null;
  bunnyEmbedUrl: string | null;
};

// Resolve display URLs for the admin UI. `previewUrl` is a signed URL for
// private uploads (public_url is null for those) and the stored public URL for
// renders, so the operator can preview their own creatives in the studio.
async function withUrls(
  row: CreativeRow,
  supabase: ReturnType<typeof getSupabase>,
): Promise<CreativeWithUrls> {
  const base = publicBase();
  // For Bunny uploads the studio drawer renders the Bunny iframe (previewUrl is
  // an HLS URL that most browsers can't play in a bare <video>), so expose the
  // embed URL separately and skip the signed-preview work.
  const bunny = row.bunny_video_id ? bunnyEmbedUrl(row.bunny_video_id) : null;
  let previewUrl: string | null = null;
  if (!bunny) {
    try {
      previewUrl = await getPlaybackUrl(row, supabase);
    } catch {
      previewUrl = null; // never fail the list/create over a single bad asset
    }
  }
  return {
    ...row,
    shareUrl: `${base}/v/${row.share_token}`,
    embedUrl: `${base}/embed/${row.share_token}`,
    previewUrl,
    bunnyEmbedUrl: bunny,
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
    const rows = await Promise.all((data ?? []).map((r) => withUrls(r as CreativeRow, supabase)));
    return res.status(200).json({ creatives: rows });
  }

  if (req.method === 'POST') {
    const mode = req.body?.mode;

    if (mode === 'upload') {
      const { storage_path, bunny_video_id, title, kind } = req.body ?? {};
      if (!title || !kind) {
        return res.status(400).json({ error: 'title and kind are required' });
      }
      if (!storage_path && !bunny_video_id) {
        return res.status(400).json({ error: 'storage_path or bunny_video_id is required' });
      }
      const insert = {
        source: 'upload' as const,
        kind,
        bucket: bunny_video_id ? 'bunny' : 'creatives',
        storage_path: storage_path ?? null,
        bunny_video_id: bunny_video_id ?? null,
        title,
        description: req.body.description ?? null,
        mime_type: req.body.mime_type ?? null,
        file_size_bytes: req.body.file_size_bytes ?? null,
        width: req.body.width ?? null,
        height: req.body.height ?? null,
        duration_seconds: req.body.duration_seconds ?? null,
        share_token: generateShareToken(),
        created_by: admin.user.id,
      };
      const { data, error } = await supabase
        .from('creatives')
        .insert(insert)
        .select('*')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ creative: await withUrls(data as CreativeRow, supabase) });
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
        created_by: admin.user.id,
      };
      const { data, error } = await supabase
        .from('creatives')
        .insert(insert)
        .select('*')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ creative: await withUrls(data as CreativeRow, supabase) });
    }

    return res.status(400).json({ error: "mode must be 'upload' or 'render'" });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
