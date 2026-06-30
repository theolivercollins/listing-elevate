import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../lib/auth.js';
import { getSupabase } from '../../lib/db.js';

// Aggregated rating data for the admin Learning dashboard.
// Returns:
//   - top winners (highest-rated scenes, last 30 days)
//   - top losers (lowest-rated scenes with comments, last 30 days)
//   - averages by room_type + camera_movement combo
//   - rating count + average trend over time (last 14 days)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  try {
    const supabase = getSupabase();
    const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString();

    // Pull all ratings + joined scene/photo/property fields.
    const { data: ratingsRaw, error } = await supabase
      .from('scene_ratings')
      .select(`
        id,
        rating,
        comment,
        tags,
        created_at,
        scene:scenes(
          id,
          scene_number,
          room_type:photos(room_type),
          camera_movement,
          prompt,
          provider,
          clip_url,
          duration_seconds
        ),
        property:properties(id, address)
      `)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false });

    if (error) throw error;

    type Row = {
      id: string;
      rating: number;
      comment: string | null;
      tags: string[] | null;
      created_at: string;
      scene: {
        id: string;
        scene_number: number;
        room_type: { room_type: string } | null;
        camera_movement: string;
        prompt: string;
        provider: string | null;
        clip_url: string | null;
        duration_seconds: number | null;
      } | null;
      property: { id: string; address: string } | null;
    };

    const ratings = (ratingsRaw ?? []) as unknown as Row[];

    // Flatten for downstream calcs
    const flat = ratings
      .filter(r => r.scene)
      .map(r => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        tags: r.tags,
        created_at: r.created_at,
        scene_id: r.scene!.id,
        scene_number: r.scene!.scene_number,
        room_type: r.scene!.room_type?.room_type ?? 'other',
        camera_movement: r.scene!.camera_movement,
        prompt: r.scene!.prompt,
        provider: r.scene!.provider,
        clip_url: r.scene!.clip_url,
        duration_seconds: r.scene!.duration_seconds,
        property_id: r.property?.id ?? null,
        property_address: r.property?.address ?? null,
      }));

    // Top 10 winners (rating >= 4, sorted by rating desc then recency)
    const winners = flat
      .filter(r => r.rating >= 4)
      .sort((a, b) => b.rating - a.rating || (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 10);

    // Top 10 losers (rating <= 2, must have a comment)
    const losers = flat
      .filter(r => r.rating <= 2 && r.comment)
      .sort((a, b) => a.rating - b.rating || (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 10);

    // Average rating by (room_type + camera_movement) combo
    const comboMap = new Map<string, { sum: number; count: number }>();
    for (const r of flat) {
      const key = `${r.room_type}|${r.camera_movement}`;
      const existing = comboMap.get(key) ?? { sum: 0, count: 0 };
      existing.sum += r.rating;
      existing.count += 1;
      comboMap.set(key, existing);
    }
    const combos = Array.from(comboMap.entries())
      .map(([key, v]) => {
        const [room_type, camera_movement] = key.split('|');
        return {
          room_type,
          camera_movement,
          avg_rating: Number((v.sum / v.count).toFixed(2)),
          count: v.count,
        };
      })
      .sort((a, b) => a.avg_rating - b.avg_rating); // worst first

    // Average rating by provider
    const providerMap = new Map<string, { sum: number; count: number }>();
    for (const r of flat) {
      if (!r.provider) continue;
      const existing = providerMap.get(r.provider) ?? { sum: 0, count: 0 };
      existing.sum += r.rating;
      existing.count += 1;
      providerMap.set(r.provider, existing);
    }
    const providers = Array.from(providerMap.entries()).map(([provider, v]) => ({
      provider,
      avg_rating: Number((v.sum / v.count).toFixed(2)),
      count: v.count,
    }));

    // 14-day rating trend (daily average)
    const trendMap = new Map<string, { sum: number; count: number }>();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);
    for (const r of flat) {
      const d = new Date(r.created_at);
      if (d < fourteenDaysAgo) continue;
      const day = d.toISOString().slice(0, 10);
      const existing = trendMap.get(day) ?? { sum: 0, count: 0 };
      existing.sum += r.rating;
      existing.count += 1;
      trendMap.set(day, existing);
    }
    const trend = Array.from(trendMap.entries())
      .map(([day, v]) => ({ day, avg_rating: Number((v.sum / v.count).toFixed(2)), count: v.count }))
      .sort((a, b) => (a.day < b.day ? -1 : 1));

    const totalRatings = flat.length;
    const avgAll = totalRatings > 0
      ? Number((flat.reduce((s, r) => s + r.rating, 0) / totalRatings).toFixed(2))
      : null;

    return res.status(200).json({
      totalRatings,
      avgAll,
      winners,
      losers,
      combos,
      providers,
      trend,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: 'learning fetch failed', detail: msg });
  }
}
