// GET /api/gen2/lab/pair-queue?listingId=X&limit=20&mode=directors_cut|apprentice_review
// Auth-gated. Loads scene graph, generates candidates, optionally appends Apprentice predictions.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import type { PairCandidate, PropertySceneGraph, PairLabel } from "../../../lib/gen2-v21/types.js";
import { generateCandidates } from "../../../lib/gen2-v21/candidates/index.js";
import { predictLabel } from "../../../lib/gen2-v21/apprentice/index.js";

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
  const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10) || 20, 100);
  const mode = (req.query.mode as string) ?? "directors_cut";

  if (!listingId) {
    return res.status(400).json({ error: "listingId is required" });
  }

  const supabase = getSupabase();

  try {
    // Load persisted scene graph
    const { data: sgRow, error: sgErr } = await supabase
      .from("gen2_scene_graphs")
      .select("payload, model_version, extracted_at")
      .eq("listing_id", listingId)
      .single();

    if (sgErr || !sgRow) {
      return res.status(404).json({ error: "Scene graph not found. Run extract-scene-graph first." });
    }

    const sceneGraph = sgRow.payload as unknown as PropertySceneGraph;

    // Generate candidates (synchronous pure function)
    const allCandidates = generateCandidates(sceneGraph);

    // Sort by heuristic_score desc, apply limit
    const ranked = allCandidates
      .sort((a, b) => b.heuristic_score - a.heuristic_score)
      .slice(0, limit);

    if (mode !== "apprentice_review") {
      return res.status(200).json({
        candidates: ranked,
        mode,
        scene_graph_version: sgRow.model_version,
        total: allCandidates.length,
      });
    }

    // Apprentice Review mode: fetch recent operator labels for few-shot
    const { data: recentLabels } = await supabase
      .from("gen2_pair_labels")
      .select("*")
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false })
      .limit(10);

    const typedLabels = (recentLabels ?? []) as PairLabel[];

    // Fetch photo URLs for few-shot examples (all photo ids referenced by recent labels)
    const fewShotPhotoIds = [
      ...new Set(typedLabels.flatMap((l) => [l.photo_a_id, l.photo_b_id])),
    ];
    const { data: fewShotPhotos } = fewShotPhotoIds.length > 0
      ? await supabase.from("photos").select("id, file_url").in("id", fewShotPhotoIds)
      : { data: [] };
    const photoUrlMap = new Map(
      (fewShotPhotos ?? []).map((p: { id: string; file_url: string }) => [p.id, p.file_url])
    );

    // Build few-shot examples for predictLabel (candidate + photos required per example)
    // We don't have persisted candidate rows for old labels, so we build minimal stubs.
    const fewShotExamples = typedLabels
      .map((label) => {
        const aUrl = photoUrlMap.get(label.photo_a_id);
        const bUrl = photoUrlMap.get(label.photo_b_id);
        if (!aUrl || !bUrl) return null;
        // Stub candidate — only fields consumed by buildFewShotText are used
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

    // Run predictions in parallel (best-effort — predictLabel never throws)
    const candidatesWithPredictions = await Promise.all(
      ranked.map(async (candidate) => {
        // Fetch photo URLs for this candidate pair
        const { data: pairPhotos } = await supabase
          .from("photos")
          .select("id, file_url")
          .in("id", [candidate.photo_a_id, candidate.photo_b_id]);
        const pairMap = new Map(
          (pairPhotos ?? []).map((p: { id: string; file_url: string }) => [p.id, p.file_url])
        );
        const photoA = { url: pairMap.get(candidate.photo_a_id) ?? "" };
        const photoB = { url: pairMap.get(candidate.photo_b_id) ?? "" };
        const prediction = await predictLabel(candidate, photoA, photoB, fewShotExamples);
        return { ...candidate, apprentice_prediction: prediction };
      })
    );

    return res.status(200).json({
      candidates: candidatesWithPredictions,
      mode,
      scene_graph_version: sgRow.model_version,
      total: allCandidates.length,
    });
  } catch (err) {
    console.error("[pair-queue] error:", err);
    return res.status(500).json({ error: "Failed to generate pair queue", detail: String(err) });
  }
}
