import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { embedTextSafe, buildAnalysisText, toPgVector } from "../../../lib/embeddings.js";
import { isNonProdEnv } from "../../../lib/env.js";

// GET    /api/admin/prompt-lab/recipes          — list recipes
// POST   /api/admin/prompt-lab/recipes          — promote an iteration
//          body: { iteration_id, archetype, prompt_template?, composition_signature? }
// PATCH  /api/admin/prompt-lab/recipes?id=...   — edit template/archetype/status
// DELETE /api/admin/prompt-lab/recipes?id=...

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("prompt_lab_recipes")
      .select()
      .eq("status", "active")
      .order("times_applied", { ascending: false })
      .order("promoted_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ recipes: data ?? [] });
  }

  if (req.method === "POST") {
    const { iteration_id, archetype, prompt_template, composition_signature } = (req.body ?? {}) as {
      iteration_id?: string;
      archetype?: string;
      prompt_template?: string;
      composition_signature?: Record<string, unknown>;
    };
    if (!iteration_id || !archetype?.trim()) {
      return res.status(400).json({ error: "iteration_id and archetype required" });
    }

    const { data: iteration, error: iErr } = await supabase
      .from("prompt_lab_iterations")
      .select()
      .eq("id", iteration_id)
      .single();
    if (iErr || !iteration) return res.status(404).json({ error: "iteration not found" });
    if (!iteration.analysis_json || !iteration.director_output_json) {
      return res.status(400).json({ error: "iteration missing analysis or director output" });
    }

    // Compute recipe embedding from the iteration's analysis.
    const analysis = iteration.analysis_json as { room_type: string; key_features: string[]; composition?: string | null; suggested_motion?: string | null };
    const director = iteration.director_output_json as { camera_movement: string; prompt: string };
    const embedded = await embedTextSafe(
      buildAnalysisText({
        roomType: analysis.room_type,
        keyFeatures: analysis.key_features,
        composition: analysis.composition,
        suggestedMotion: analysis.suggested_motion,
        cameraMovement: director.camera_movement,
      })
    );
    if (embedded) {
      const { error: costErr } = await supabase.from("cost_events").insert({
        property_id: null,
        scene_id: null,
        stage: "embedding",
        provider: "openai",
        units_consumed: embedded.usage.totalTokens,
        unit_type: "tokens",
        cost_cents: Math.round(embedded.usage.costCents),
        metadata: {
          scope: "lab_recipe_promotion_embedding",
          model: embedded.model,
          tokens: embedded.usage.totalTokens,
          iteration_id,
        },
        is_test: isNonProdEnv(),
      });
      if (costErr) console.error("[embeddings] cost_events insert failed:", costErr);
    }

    const { data: recipe, error: rErr } = await supabase
      .from("prompt_lab_recipes")
      .insert({
        archetype: archetype.trim(),
        room_type: analysis.room_type,
        camera_movement: director.camera_movement,
        provider: iteration.provider,
        composition_signature: composition_signature ?? null,
        prompt_template: (prompt_template?.trim()) || director.prompt,
        source_iteration_id: iteration_id,
        rating_at_promotion: iteration.rating,
        promoted_by: auth.user.id,
        embedding: embedded ? toPgVector(embedded.vector) : null,
      })
      .select()
      .single();
    if (rErr) return res.status(500).json({ error: rErr.message });
    return res.status(201).json(recipe);
  }

  const id = req.query.id as string | undefined;

  if (req.method === "PATCH") {
    if (!id) return res.status(400).json({ error: "id required" });
    const body = (req.body ?? {}) as Partial<{
      archetype: string;
      prompt_template: string;
      status: string;
      composition_signature: Record<string, unknown>;
    }>;
    const patch: Record<string, unknown> = {};
    if (body.archetype !== undefined) patch.archetype = body.archetype.trim();
    if (body.prompt_template !== undefined) patch.prompt_template = body.prompt_template.trim();
    if (body.status !== undefined && ["active", "archived", "pending"].includes(body.status)) {
      patch.status = body.status;
    }
    if (body.composition_signature !== undefined) patch.composition_signature = body.composition_signature;
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "no fields to update" });
    const { data, error } = await supabase
      .from("prompt_lab_recipes")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === "DELETE") {
    if (!id) return res.status(400).json({ error: "id required" });
    const { error } = await supabase.from("prompt_lab_recipes").delete().eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
