// POST /api/gen2/lab/extract-scene-graph
// Body: { listingId: string }
// Auth-gated. Extracts scene graph via Gemini, persists to gen2_scene_graphs.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getPhotosForProperty, getSupabase, recordCostEvent } from "../../../lib/db.js";
import type { PropertySceneGraph } from "../../../lib/gen2-v21/types.js";

// TODO: import { extractSceneGraph } from "../../../lib/gen2-v21/scene-graph/index.js";
// Stub until scene-graph subagent ships:
async function extractSceneGraph(
  photos: Awaited<ReturnType<typeof getPhotosForProperty>>,
  listingId: string
): Promise<PropertySceneGraph> {
  throw new Error("TODO: scene-graph subagent not yet integrated — import from lib/gen2-v21/scene-graph/index.js");
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

  const { listingId } = (req.body ?? {}) as { listingId?: string };
  if (!listingId) {
    return res.status(400).json({ error: "listingId is required" });
  }

  const supabase = getSupabase();

  try {
    const photos = await getPhotosForProperty(listingId);
    if (photos.length === 0) {
      return res.status(400).json({ error: "No photos found for listing" });
    }

    const sceneGraph = await extractSceneGraph(photos, listingId);

    // Record Gemini cost (estimate: ~500 tokens per photo at $0.00 → track as qc/google)
    await recordCostEvent({
      propertyId: listingId,
      stage: "qc",
      provider: "google",
      unitType: "tokens",
      unitsConsumed: photos.length * 500,
      costCents: Math.round(photos.length * 0.05), // ~$0.0005/photo placeholder
      metadata: { step: "extract-scene-graph", photo_count: photos.length, model: sceneGraph.model_version },
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
