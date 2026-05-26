// /api/gen2/lab/extract-scene-graph
// POST { listingId } — extract via Gemini + upsert to gen2_scene_graphs
// GET  ?check=1&listingId= — return { exists: boolean }
// Auth-gated.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase, recordCostEvent } from "../../../lib/db.js";
import { getPhotosForV21Listing } from "../../../lib/gen2-v21/photo-source.js";
import { extractSceneGraph } from "../../../lib/gen2-v21/scene-graph/index.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.GEN2_V21_ENABLED !== "true") {
    return res.status(404).json({ error: "Not found" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const supabase = getSupabase();

  // GET ?check=1&listingId=... → existence check, no extraction
  if (req.method === "GET") {
    const listingId = (req.query?.listingId as string | undefined) ?? "";
    if (!listingId) {
      return res.status(400).json({ error: "listingId is required" });
    }
    const { data, error } = await supabase
      .from("gen2_scene_graphs")
      .select("listing_id")
      .eq("listing_id", listingId)
      .maybeSingle();
    if (error) {
      console.error("[extract-scene-graph] check error:", error);
      return res.status(500).json({ error: "Check failed" });
    }
    return res.status(200).json({ exists: Boolean(data) });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { listingId } = (req.body ?? {}) as { listingId?: string };
  if (!listingId) {
    return res.status(400).json({ error: "listingId is required" });
  }

  try {
    const photoRefs = await getPhotosForV21Listing(listingId);
    if (photoRefs.length === 0) {
      return res.status(400).json({ error: "No photos found for listing" });
    }
    const sceneGraph = await extractSceneGraph(listingId, photoRefs);

    // Record Gemini cost (estimate: ~500 tokens per photo)
    await recordCostEvent({
      propertyId: listingId,
      stage: "qc",
      provider: "google",
      unitType: "tokens",
      unitsConsumed: photoRefs.length * 500,
      costCents: Math.round(photoRefs.length * 0.05),
      metadata: { step: "extract-scene-graph", photo_count: photoRefs.length, model: sceneGraph.model_version },
    }).catch((err) => console.error("[extract-scene-graph] cost_events insert failed:", err));

    // Upsert into gen2_scene_graphs
    const { data, error } = await supabase
      .from("gen2_scene_graphs")
      .upsert(
        {
          listing_id: listingId,
          payload: sceneGraph as unknown as Record<string, unknown>,
          model_version: sceneGraph.model_version,
          extracted_at: sceneGraph.extracted_at,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "listing_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("[extract-scene-graph] db upsert error:", error);
      return res.status(500).json({ error: "Failed to persist scene graph" });
    }

    return res.status(200).json({ scene_graph: data, listing_id: listingId });
  } catch (err) {
    console.error("[extract-scene-graph] error:", err);
    return res.status(500).json({ error: "Scene graph extraction failed", detail: String(err) });
  }
}
