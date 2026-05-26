import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import {
  refineDirectorPrompt,
  retrieveSimilarIterations,
  retrieveSimilarLosers,
  retrieveMatchingRecipes,
  getNextIterationNumber,
  autoPromoteIfWinning,
  DIRECTOR_PROMPT_HASH,
} from "../../../lib/prompt-lab.js";

// POST /api/admin/prompt-lab/refine
//   body: { iteration_id, rating?, tags?, comment?, chat_instruction }
// Saves feedback on the current iteration, then creates a new iteration with a
// refined director prompt produced by Claude.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const { iteration_id, rating, tags, comment, chat_instruction } = (req.body ?? {}) as {
    iteration_id?: string;
    rating?: number | null;
    tags?: string[] | null;
    comment?: string | null;
    chat_instruction?: string;
  };
  if (!iteration_id || !chat_instruction?.trim()) {
    return res.status(400).json({ error: "iteration_id and chat_instruction required" });
  }

  const supabase = getSupabase();
  const { data: prev, error: pErr } = await supabase
    .from("prompt_lab_iterations")
    .select()
    .eq("id", iteration_id)
    .single();
  if (pErr || !prev) return res.status(404).json({ error: "iteration not found" });
  if (!prev.analysis_json || !prev.director_output_json) {
    return res.status(400).json({ error: "previous iteration missing analysis or director output" });
  }

  // Save feedback onto the previous iteration. Prior code (2026-03
   // era) skipped tags + refinement_instruction writes because the plan
   // was to migrate off prompt_lab_iterations to the Listings Lab
   // tables — that plan was reversed, V1 Lab IS the primary surface,
   // and skipping these writes silently dropped user feedback on every
   // Refine click (observed 2026-04-24 on V1-00361 + sibling rows).
  await supabase
    .from("prompt_lab_iterations")
    .update({
      rating: typeof rating === "number" ? rating : prev.rating,
      tags: Array.isArray(tags) ? tags : prev.tags,
      user_comment: typeof comment === "string" ? comment : prev.user_comment,
      refinement_instruction: chat_instruction.trim(),
    })
    .eq("id", iteration_id);

  // Mirror rate.ts: if this refine included a 4★/5★ rating, grow the recipe
  // pool here too. Previously only /rate promoted, so every refine-and-rate
  // flow missed the promotion.
  const effectiveRating = typeof rating === "number" ? rating : (prev.rating as number | null);
  if (typeof effectiveRating === "number" && effectiveRating >= 4) {
    await autoPromoteIfWinning({
      iterationRow: {
        id: prev.id,
        analysis_json: prev.analysis_json,
        director_output_json: prev.director_output_json,
        embedding: prev.embedding,
        provider: prev.provider,
        pipeline_version: (prev as Record<string, unknown>).pipeline_version as string | null ?? null,
      },
      rating: effectiveRating,
      promotedBy: auth.user.id,
    });
  }

  // Parent embedding carries forward — retrieve similar winners + losers +
  // matching recipes. Previously this path skipped recipes, so every refine
  // replanned without the curated promoted-recipe pool (observed 2026-04-24:
  // iteration 1 had 75% recipe-hit; iteration 2+ dropped to 0-37%). Adding
  // recipe retrieval here means later iterations in a session finally benefit
  // from the wisdom the operator promoted on earlier iterations.
  let exemplars: Awaited<ReturnType<typeof retrieveSimilarIterations>> = [];
  let losers: Awaited<ReturnType<typeof retrieveSimilarLosers>> = [];
  let recipes: Awaited<ReturnType<typeof retrieveMatchingRecipes>> = [];
  let parentVec: number[] | null = null;
  if (Array.isArray(prev.embedding) && prev.embedding.length) {
    parentVec = prev.embedding as number[];
  } else if (typeof prev.embedding === "string" && prev.embedding.startsWith("[")) {
    try {
      parentVec = JSON.parse(prev.embedding) as number[];
    } catch { /* no-op */ }
  }
  if (parentVec) {
    const parentRoomType = (prev.analysis_json as { room_type?: string } | null)?.room_type ?? null;
    const parentPipelineVersion = (prev as Record<string, unknown>).pipeline_version as string | null ?? null;
    [exemplars, losers, recipes] = await Promise.all([
      retrieveSimilarIterations(parentVec, { minRating: 4, limit: 5, sessionId: prev.session_id }),
      retrieveSimilarLosers(parentVec, { maxRating: 2, limit: 3, sessionId: prev.session_id }),
      retrieveMatchingRecipes(parentVec, parentRoomType, {
        sessionId: prev.session_id,
        ...(parentPipelineVersion ? { pipelineVersion: parentPipelineVersion } : {}),
      }),
    ]);
  }

  try {
    const { scene, rationale, costCents } = await refineDirectorPrompt({
      analysis: prev.analysis_json,
      previousScene: prev.director_output_json,
      rating: typeof rating === "number" ? rating : null,
      tags: Array.isArray(tags) ? tags : null,
      comment: typeof comment === "string" ? comment : null,
      chatInstruction: chat_instruction,
      exemplars,
      losers,
      recipes,
    });

    const iterationNumber = await getNextIterationNumber(prev.session_id);
    // IMPORTANT: the refiner's rationale is Claude's own explanation of
    // what it changed, not user-authored feedback. Earlier versions
    // stashed it in `user_comment` with a "[refiner rationale]" prefix —
    // which meant the unified retrieval RPCs surfaced it to the director
    // as "admin note", contaminating the learning signal on the next
    // run. After migration 015 it lives in `refiner_rationale` and stays
    // out of loser-retrieval entirely.
    const { data: newIteration, error: nErr } = await supabase
      .from("prompt_lab_iterations")
      .insert({
        session_id: prev.session_id,
        iteration_number: iterationNumber,
        analysis_json: prev.analysis_json,
        analysis_prompt_hash: prev.analysis_prompt_hash,
        director_output_json: scene,
        director_prompt_hash: DIRECTOR_PROMPT_HASH,
        cost_cents: Math.round(costCents),
        refiner_rationale: rationale ? rationale : null,
        user_comment: null,
        embedding: prev.embedding ?? null,
        embedding_model: prev.embedding_model ?? null,
        retrieval_metadata: {
          parent_iteration_id: prev.id,
          exemplars: exemplars.map((e) => ({ id: e.id, prompt: e.prompt, rating: e.rating, distance: e.distance, room_type: e.room_type, camera_movement: e.camera_movement })),
          losers: losers.map((e) => ({ id: e.id, prompt: e.prompt, rating: e.rating, distance: e.distance, room_type: e.room_type, camera_movement: e.camera_movement })),
          recipe: recipes[0]
            ? {
                id: (recipes[0] as { id: string }).id,
                archetype: (recipes[0] as { archetype: string }).archetype,
                prompt_template: (recipes[0] as { prompt_template: string }).prompt_template,
                distance: (recipes[0] as { distance: number }).distance,
              }
            : null,
        },
      })
      .select()
      .single();
    if (nErr) return res.status(500).json({ error: nErr.message });

    return res.status(201).json({
      iteration: newIteration,
      retrieval: {
        exemplar_count: exemplars.length,
        loser_count: losers.length,
        exemplars: exemplars.map((e) => ({ id: e.id, prompt: e.prompt, rating: e.rating, distance: e.distance })),
        losers: losers.map((e) => ({ id: e.id, prompt: e.prompt, rating: e.rating, distance: e.distance })),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "refine failed", detail: msg });
  }
}
