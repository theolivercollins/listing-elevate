import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../../lib/auth.js';
import { getSupabase } from '../../../../lib/client.js';
import { deriveBunnyGuid, bunnyEmbedUrl, isBunnyConfigured } from '../../../../lib/providers/bunny-stream.js';

interface FinalVideoEntry {
  embed_url: string | null;
  mp4_url: string;
  hls_url: string | null;
}

/**
 * Build the single-source-of-truth final-video descriptor for one
 * orientation. Returns null when the persisted URL isn't a Bunny-hosted
 * video (e.g. a Creatomate/Shotstack provider-URL fallback — see
 * lib/assembly/finalize.ts) — callers fall back to the pre-existing raw
 * mp4/HLS player in that case. `embed_url` is the Bunny iframe player (built-
 * in adaptive-quality menu up to 1080p — the "load full quality" affordance);
 * it's null only if the guid resolves but Bunny env isn't configured on this
 * deployment, which should not happen in prod.
 */
function buildFinalVideo(mp4Url: string | null, hlsUrl: string | null): FinalVideoEntry | null {
  const guid = deriveBunnyGuid(mp4Url) ?? deriveBunnyGuid(hlsUrl);
  if (!guid || !mp4Url) return null;
  return {
    embed_url: isBunnyConfigured() ? bunnyEmbedUrl(guid) : null,
    mp4_url: mp4Url,
    hls_url: hlsUrl,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const id = String(req.query.id);

  const db = getSupabase();
  const [pRes, sRes, nRes, cRes, pvRes, dRes] = await Promise.all([
    db.from('properties').select('*, client:client_id(*)').eq('id', id).maybeSingle(),
    db.from('scenes').select('*').eq('property_id', id).order('scene_number', { ascending: true }),
    db.from('property_revision_notes').select('*').eq('property_id', id).order('created_at', { ascending: false }),
    db.from('cost_events').select('stage, provider, cost_cents, metadata').eq('property_id', id),
    db.from('property_previews').select('token, expires_at, viewed_count, last_viewed_at, created_at').eq('property_id', id).order('created_at', { ascending: false }).limit(5),
    db.from('delivery_runs').select('*').eq('property_id', id).neq('stage', 'delivered').order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!pRes.data) return res.status(404).json({ error: 'not_found' });

  const property = pRes.data as {
    horizontal_video_url?: string | null;
    vertical_video_url?: string | null;
    horizontal_hls_url?: string | null;
    vertical_hls_url?: string | null;
  };
  const finalVideo = {
    horizontal: buildFinalVideo(property.horizontal_video_url ?? null, property.horizontal_hls_url ?? null),
    vertical: buildFinalVideo(property.vertical_video_url ?? null, property.vertical_hls_url ?? null),
  };

  const costByProvider: Record<string, number> = {};
  let costTotal = 0;
  const deliveryByStage: Record<string, number> = {};
  let deliveryTotal = 0;
  const activeRunId = (dRes.data as { id: string } | null)?.id ?? null;
  for (const r of (cRes.data ?? []) as Array<{ stage: string; provider: string; cost_cents: number; metadata: { delivery_run_id?: string } | null }>) {
    costByProvider[r.provider] = (costByProvider[r.provider] ?? 0) + (r.cost_cents ?? 0);
    costTotal += r.cost_cents ?? 0;
    if (activeRunId && r.metadata?.delivery_run_id === activeRunId) {
      deliveryByStage[r.stage] = (deliveryByStage[r.stage] ?? 0) + (r.cost_cents ?? 0);
      deliveryTotal += r.cost_cents ?? 0;
    }
  }

  return res.status(200).json({
    property: pRes.data,
    scenes: sRes.data ?? [],
    revision_notes: nRes.data ?? [],
    previews: pvRes.data ?? [],
    cost: {
      total_cents: costTotal,
      by_provider: costByProvider,
      delivery: activeRunId ? { total_cents: deliveryTotal, by_stage: deliveryByStage } : null,
    },
    delivery_run: dRes.data ?? null,
    final_video: finalVideo,
  });
}
