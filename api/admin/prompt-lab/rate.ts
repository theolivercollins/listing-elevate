import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { autoPromoteIfWinning } from "../../../lib/prompt-lab.js";

// POST /api/admin/prompt-lab/rate
//   body: { iteration_id, rating?, tags?, comment? }
// Saves a rating on an existing iteration. If rating=5 AND no active recipe
// within 0.2 cosine distance + same room_type exists, auto-promotes to a
// recipe using a generated archetype name (room_camera_YYMMDD-abc).

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const { iteration_id, rating, tags, comment } = (req.body ?? {}) as {
    iteration_id?: string;
    rating?: number | null;
    tags?: string[] | null;
    comment?: string | null;
  };
  if (!iteration_id) return res.status(400).json({ error: "iteration_id required" });

  const patch: Record<string, unknown> = {};
  if (rating === null || typeof rating === "number") patch.rating = rating;
  if (tags === null || Array.isArray(tags)) patch.tags = tags;
  if (comment === null || typeof comment === "string") patch.user_comment = comment;

  const supabase = getSupabase();
  const { data: updated, error } = await supabase
    .from("prompt_lab_iterations")
    .update(patch)
    .eq("id", iteration_id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Auto-promote on rating >= 4 via the shared helper. Same logic fires from
  // refine.ts so every rating path grows the recipe pool.
  const auto_promoted = typeof rating === "number" && rating >= 4
    ? await autoPromoteIfWinning({
        iterationRow: {
          id: updated.id,
          analysis_json: updated.analysis_json,
          director_output_json: updated.director_output_json,
          embedding: updated.embedding,
          provider: updated.provider,
          pipeline_version: (updated as Record<string, unknown>).pipeline_version as string | null ?? null,
        },
        rating,
        promotedBy: auth.user.id,
      })
    : null;

  return res.status(200).json({ iteration: updated, auto_promoted });
}
