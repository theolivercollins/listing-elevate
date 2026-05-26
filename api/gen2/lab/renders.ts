// GET /api/gen2/lab/renders?listingId=X
// Returns gen2_render_outcomes joined with gen2_pair_labels for a listing,
// including photo URLs resolved from either photos or prompt_lab_listing_photos.
// Auth: requireAdmin

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";

export interface RendersRow {
  outcome_id: string;
  pair_label_id: string;
  listing_id: string;
  photo_a_id: string;
  photo_b_id: string;
  photo_a_url: string;
  photo_b_url: string;
  video_url: string | null;
  status: string;
  judge_score: number | null;
  judge_reasoning: string | null;
  cost_cents: number;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
}

export interface RendersResponse {
  rows: RendersRow[];
  total_cost_cents: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.GEN2_V21_ENABLED !== "true") {
    return res.status(404).json({ error: "Not found" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const listingId = req.query.listingId as string | undefined;
  if (!listingId) {
    return res.status(400).json({ error: "listingId is required" });
  }

  const supabase = getSupabase();

  try {
    // Fetch outcomes joined with pair labels for this listing
    const { data: labels, error: labelsErr } = await supabase
      .from("gen2_pair_labels")
      .select("label_id, listing_id, photo_a_id, photo_b_id")
      .eq("listing_id", listingId);

    if (labelsErr) {
      return res.status(500).json({ error: "Failed to fetch pair labels", detail: labelsErr.message });
    }

    if (!labels || labels.length === 0) {
      return res.status(200).json({ rows: [], total_cost_cents: 0 });
    }

    const labelIds = labels.map((l: { label_id: string }) => l.label_id);
    const labelMap = new Map(
      labels.map((l: { label_id: string; listing_id: string; photo_a_id: string; photo_b_id: string }) => [
        l.label_id,
        { listing_id: l.listing_id, photo_a_id: l.photo_a_id, photo_b_id: l.photo_b_id },
      ])
    );

    // Fetch outcomes for those label IDs
    const { data: outcomes, error: outcomesErr } = await supabase
      .from("gen2_render_outcomes")
      .select("outcome_id, pair_label_id, video_url, status, judge_score, judge_reasoning, cost_cents, retry_count, created_at, completed_at")
      .in("pair_label_id", labelIds)
      .order("created_at", { ascending: false });

    if (outcomesErr) {
      return res.status(500).json({ error: "Failed to fetch render outcomes", detail: outcomesErr.message });
    }

    if (!outcomes || outcomes.length === 0) {
      return res.status(200).json({ rows: [], total_cost_cents: 0 });
    }

    // Collect all unique photo IDs
    const allPhotoIds = new Set<string>();
    for (const outcome of outcomes) {
      const label = labelMap.get(outcome.pair_label_id);
      if (label) {
        allPhotoIds.add(label.photo_a_id);
        allPhotoIds.add(label.photo_b_id);
      }
    }
    const photoIdList = Array.from(allPhotoIds);

    // Resolve photo URLs from real photos first, then lab photos
    const [realPhotos, labPhotos] = await Promise.all([
      supabase
        .from("photos")
        .select("id, file_url")
        .in("id", photoIdList)
        .then(({ data }: { data: Array<{ id: string; file_url: string }> | null }) => data ?? []),
      supabase
        .from("prompt_lab_listing_photos")
        .select("id, image_url")
        .in("id", photoIdList)
        .then(({ data }: { data: Array<{ id: string; image_url: string }> | null }) => data ?? []),
    ]);

    const photoUrlMap = new Map<string, string>();
    for (const p of labPhotos) photoUrlMap.set(p.id, p.image_url);
    // Real photos override lab photos
    for (const p of realPhotos) photoUrlMap.set(p.id, p.file_url);

    // Build rows
    const rows: RendersRow[] = outcomes
      .map((outcome: {
        outcome_id: string;
        pair_label_id: string;
        video_url: string | null;
        status: string;
        judge_score: number | null;
        judge_reasoning: string | null;
        cost_cents: number;
        retry_count: number;
        created_at: string;
        completed_at: string | null;
      }) => {
        const label = labelMap.get(outcome.pair_label_id);
        if (!label) return null;
        return {
          outcome_id: outcome.outcome_id,
          pair_label_id: outcome.pair_label_id,
          listing_id: label.listing_id,
          photo_a_id: label.photo_a_id,
          photo_b_id: label.photo_b_id,
          photo_a_url: photoUrlMap.get(label.photo_a_id) ?? "",
          photo_b_url: photoUrlMap.get(label.photo_b_id) ?? "",
          video_url: outcome.video_url,
          status: outcome.status,
          judge_score: outcome.judge_score,
          judge_reasoning: outcome.judge_reasoning,
          cost_cents: outcome.cost_cents,
          retry_count: outcome.retry_count,
          created_at: outcome.created_at,
          completed_at: outcome.completed_at,
        };
      })
      .filter((r): r is RendersRow => r !== null);

    const total_cost_cents = rows.reduce((sum, r) => sum + (r.cost_cents ?? 0), 0);

    return res.status(200).json({ rows, total_cost_cents });
  } catch (err) {
    console.error("[renders] error:", err);
    return res.status(500).json({ error: "Failed to fetch renders", detail: String(err) });
  }
}
