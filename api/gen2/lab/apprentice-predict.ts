// POST /api/gen2/lab/apprentice-predict
// Body: { candidate_id: string }
// Loads candidate + photos + recent operator labels (last 10 few-shot).
// Calls predictLabel from apprentice module.
// Persists to gen2_apprentice_predictions.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase, recordCostEvent } from "../../../lib/db.js";
import type { ApprenticePrediction } from "../../../lib/gen2-v21/types.js";

// TODO: import { predictLabel } from "../../../lib/gen2-v21/apprentice/index.js";
// Stub until apprentice subagent ships:
async function predictLabel(
  _candidate: unknown,
  _photos: unknown[],
  _recentLabels: unknown[]
): Promise<ApprenticePrediction> {
  throw new Error("TODO: apprentice subagent not yet integrated — import from lib/gen2-v21/apprentice/index.js");
}

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

  const { candidate_id } = (req.body ?? {}) as { candidate_id?: string };
  if (!candidate_id) {
    return res.status(400).json({ error: "candidate_id is required" });
  }

  const supabase = getSupabase();

  try {
    // Load the candidate
    const { data: candidate, error: candidateErr } = await supabase
      .from("gen2_pair_candidates")
      .select("*")
      .eq("candidate_id", candidate_id)
      .single();

    if (candidateErr || !candidate) {
      return res.status(404).json({ error: "candidate_id not found" });
    }

    // Load photos for both sides of the pair
    const { data: photos } = await supabase
      .from("photos")
      .select("*")
      .in("id", [candidate.photo_a_id, candidate.photo_b_id]);

    // Load last 10 operator labels for this listing (few-shot examples)
    const { data: recentLabels } = await supabase
      .from("gen2_pair_labels")
      .select("*")
      .eq("listing_id", candidate.listing_id)
      .order("created_at", { ascending: false })
      .limit(10);

    const prediction = await predictLabel(candidate, photos ?? [], recentLabels ?? []);

    // Track Gemini cost (few-shot labeling)
    await recordCostEvent({
      propertyId: candidate.listing_id,
      stage: "qc",
      provider: "google",
      unitType: "tokens",
      unitsConsumed: 1000, // rough per-prediction estimate
      costCents: 1, // ~$0.01 per prediction placeholder
      metadata: {
        step: "apprentice-predict",
        candidate_id,
        model: prediction.model_version,
        few_shot_count: prediction.few_shot_label_ids.length,
      },
    }).catch((err) => console.error("[apprentice-predict] cost_events insert failed:", err));

    // Persist the prediction
    const { data: inserted, error: insertErr } = await supabase
      .from("gen2_apprentice_predictions")
      .insert({
        candidate_id,
        listing_id: candidate.listing_id,
        predicted_verdict: prediction.predicted_verdict,
        predicted_transition_tag: prediction.predicted_transition_tag,
        confidence: prediction.confidence,
        reasoning: prediction.reasoning,
        model_version: prediction.model_version,
        few_shot_label_ids: prediction.few_shot_label_ids,
        agreement_with_operator: null, // set later when operator labels
        created_by: auth.user.id,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("[apprentice-predict] insert error:", insertErr);
      return res.status(500).json({ error: "Failed to persist prediction", detail: insertErr.message });
    }

    return res.status(200).json({
      prediction_id: inserted!.id,
      prediction,
    });
  } catch (err) {
    console.error("[apprentice-predict] error:", err);
    return res.status(500).json({ error: "Prediction failed", detail: String(err) });
  }
}
