// POST /api/gen2/lab/render-pair
// Body: { pair_label_id: string }
// Creates a gen2_render_outcomes row in status='pending' and returns outcome_id.
// The outcome-feedback worker polls and completes the render asynchronously.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.GEN2_V21_ENABLED !== "true") {
    return res.status(404).json({ error: "Not found" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const { pair_label_id } = (req.body ?? {}) as { pair_label_id?: string };
  if (!pair_label_id) {
    return res.status(400).json({ error: "pair_label_id is required" });
  }

  const supabase = getSupabase();

  try {
    // Verify the pair_label exists
    const { data: label, error: labelErr } = await supabase
      .from("gen2_pair_labels")
      .select("label_id, listing_id, photo_a_id, photo_b_id, operator_verdict")
      .eq("label_id", pair_label_id)
      .single();

    if (labelErr || !label) {
      return res.status(404).json({ error: "pair_label_id not found" });
    }

    // Check for an existing non-failed outcome to avoid duplicate renders
    const { data: existing } = await supabase
      .from("gen2_render_outcomes")
      .select("outcome_id, status")
      .eq("pair_label_id", pair_label_id)
      .neq("status", "failed")
      .maybeSingle();

    if (existing) {
      return res.status(200).json({
        outcome_id: existing.outcome_id,
        status: existing.status,
        already_exists: true,
      });
    }

    // Insert a pending outcome row; outcome-feedback worker picks this up
    const { data: outcome, error: insertErr } = await supabase
      .from("gen2_render_outcomes")
      .insert({
        pair_label_id,
        atlas_job_id: null,
        video_url: null,
        judge_score: null,
        judge_reasoning: null,
        status: "pending",
        cost_cents: 0,
        retry_count: 0,
        created_at: new Date().toISOString(),
        completed_at: null,
        initiated_by: auth.user.id,
      })
      .select("outcome_id, status")
      .single();

    if (insertErr) {
      console.error("[render-pair] insert error:", insertErr);
      return res.status(500).json({ error: "Failed to create render outcome", detail: insertErr.message });
    }

    return res.status(201).json({
      outcome_id: outcome!.outcome_id,
      status: outcome!.status,
      already_exists: false,
    });
  } catch (err) {
    console.error("[render-pair] error:", err);
    return res.status(500).json({ error: "Failed to enqueue render", detail: String(err) });
  }
}
