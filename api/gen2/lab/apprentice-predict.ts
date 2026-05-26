// POST /api/gen2/lab/apprentice-predict
// Body: { candidate_id: string }
// Loads candidate + photos + recent operator labels (last 10 few-shot).
// Calls predictLabel from apprentice module.
// Persists to gen2_apprentice_predictions.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import type { ApprenticePrediction, PairCandidate, PairLabel } from "../../../lib/gen2-v21/types.js";
import { predictLabel } from "../../../lib/gen2-v21/apprentice/index.js";

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
    const { data: candidateRow, error: candidateErr } = await supabase
      .from("gen2_pair_candidates")
      .select("*")
      .eq("candidate_id", candidate_id)
      .single();

    if (candidateErr || !candidateRow) {
      return res.status(404).json({ error: "candidate_id not found" });
    }

    const candidate = candidateRow as unknown as PairCandidate;

    // Load photos for both sides of the pair
    const { data: photos } = await supabase
      .from("photos")
      .select("id, file_url")
      .in("id", [candidate.photo_a_id, candidate.photo_b_id]);

    const photoMap = new Map(
      (photos ?? []).map((p: { id: string; file_url: string }) => [p.id, p.file_url])
    );
    const photoA = { url: photoMap.get(candidate.photo_a_id) ?? "" };
    const photoB = { url: photoMap.get(candidate.photo_b_id) ?? "" };

    // Load last 10 operator labels for this listing (few-shot examples)
    const { data: recentLabels } = await supabase
      .from("gen2_pair_labels")
      .select("*")
      .eq("listing_id", candidate.listing_id)
      .order("created_at", { ascending: false })
      .limit(10);

    const typedLabels = (recentLabels ?? []) as PairLabel[];

    // Fetch photo URLs for few-shot label pairs
    const fewShotPhotoIds = [
      ...new Set(typedLabels.flatMap((l) => [l.photo_a_id, l.photo_b_id])),
    ];
    const { data: fewShotPhotos } = fewShotPhotoIds.length > 0
      ? await supabase.from("photos").select("id, file_url").in("id", fewShotPhotoIds)
      : { data: [] };
    const fewShotPhotoMap = new Map(
      (fewShotPhotos ?? []).map((p: { id: string; file_url: string }) => [p.id, p.file_url])
    );

    // Build FewShotExample[] — predictLabel uses candidate+photoA/B+label per example
    const fewShotExamples = typedLabels
      .map((label) => {
        const aUrl = fewShotPhotoMap.get(label.photo_a_id);
        const bUrl = fewShotPhotoMap.get(label.photo_b_id);
        if (!aUrl || !bUrl) return null;
        const stubCandidate: PairCandidate = {
          candidate_id: label.label_id,
          listing_id: label.listing_id,
          photo_a_id: label.photo_a_id,
          photo_b_id: label.photo_b_id,
          candidate_type: "same_room_different_angle",
          heuristic_score: label.model_prediction_at_time ?? 0,
          reasoning: "",
          portal_id: null,
        };
        return {
          candidate: stubCandidate,
          photoA: { url: aUrl },
          photoB: { url: bUrl },
          label,
        };
      })
      .filter((ex): ex is NonNullable<typeof ex> => ex !== null);

    // predictLabel tracks its own cost_event internally (see lib/gen2-v21/apprentice/labeler.ts)
    const prediction = await predictLabel(candidate, photoA, photoB, fewShotExamples);

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
