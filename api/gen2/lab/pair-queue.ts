// GET /api/gen2/lab/pair-queue?listingId=X&limit=20&mode=directors_cut|apprentice_review
// Auth-gated. Loads scene graph, generates candidates, optionally appends Apprentice predictions.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import type { PairCandidate, PropertySceneGraph, ApprenticePrediction } from "../../../lib/gen2-v21/types.js";

// TODO: import { generateCandidates } from "../../../lib/gen2-v21/candidates/index.js";
// Stub until candidates subagent ships:
async function generateCandidates(
  _sceneGraph: PropertySceneGraph
): Promise<PairCandidate[]> {
  throw new Error("TODO: candidates subagent not yet integrated — import from lib/gen2-v21/candidates/index.js");
}

// TODO: import { predictLabel } from "../../../lib/gen2-v21/apprentice/index.js";
// Stub until apprentice subagent ships:
async function predictLabel(
  _candidate: PairCandidate,
  _recentLabels: unknown[]
): Promise<ApprenticePrediction> {
  throw new Error("TODO: apprentice subagent not yet integrated — import from lib/gen2-v21/apprentice/index.js");
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

    // Generate candidates
    const allCandidates = await generateCandidates(sceneGraph);

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

    // Run predictions in parallel (best-effort — don't fail if apprentice throws)
    const candidatesWithPredictions = await Promise.all(
      ranked.map(async (candidate) => {
        try {
          const prediction = await predictLabel(candidate, recentLabels ?? []);
          return { ...candidate, apprentice_prediction: prediction };
        } catch (err) {
          console.warn("[pair-queue] apprentice prediction failed for candidate", candidate.candidate_id, err);
          return { ...candidate, apprentice_prediction: null };
        }
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
