// POST /api/admin/prompt-lab/model-feedback
//   body: { iteration_id, comment }
//   → reads iteration row to fill denormalized fields, inserts into
//     prompt_lab_model_feedback, fires-and-forgets embedding backfill.
//
// GET /api/admin/prompt-lab/model-feedback?iteration_id=<>
//   → all feedback rows for one iteration, ordered by created_at ASC.
//
// GET /api/admin/prompt-lab/model-feedback?model=<>&pipeline_version=<>&limit=<>
//   → recent feedback for a model+version, ordered by created_at DESC.
//
// Spec: docs/specs/2026-05-24-v1.1-quality-veo-feedback-design.md §3

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { embedTextSafe, toPgVector } from "../../../lib/embeddings.js";
import type { PromptLabModelFeedback } from "../../../lib/types.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  if (req.method === "POST") {
    return handlePost(req, res, auth.user.id);
  }
  if (req.method === "GET") {
    return handleGet(req, res);
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}

async function handlePost(
  req: VercelRequest,
  res: VercelResponse,
  authorUserId: string
) {
  const body = (req.body ?? {}) as { iteration_id?: string; comment?: string };
  const { iteration_id, comment } = body;

  if (!iteration_id) {
    return res.status(400).json({ error: "iteration_id required" });
  }
  if (!comment || !comment.trim()) {
    return res.status(400).json({ error: "comment must be a non-empty string" });
  }

  const supabase = getSupabase();

  // Read the parent iteration to fill denormalized fields.
  const { data: iteration, error: iterErr } = await supabase
    .from("prompt_lab_iterations")
    .select("id, session_id, model_used, pipeline_version, resolution_used, prompt_lab_sessions(pipeline_version)")
    .eq("id", iteration_id)
    .maybeSingle();

  if (iterErr || !iteration) {
    return res.status(400).json({ error: "iteration not found" });
  }

  // Resolve pipeline_version from the parent session row (the iteration row
  // inherited it at creation time; read from both for resilience).
  const sessionPv =
    (iteration.prompt_lab_sessions as { pipeline_version?: string } | null)
      ?.pipeline_version ?? null;
  const pipelineVersion: string =
    (iteration.pipeline_version as string | null) ??
    sessionPv ??
    "v1";

  const modelUsed: string =
    (iteration.model_used as string | null) ?? "unknown";

  const { data: row, error: insertErr } = await supabase
    .from("prompt_lab_model_feedback")
    .insert({
      iteration_id,
      session_id: iteration.session_id as string,
      model_used: modelUsed,
      pipeline_version: pipelineVersion,
      resolution_used: (iteration.resolution_used as string | null) ?? null,
      author: authorUserId,
      comment: comment.trim(),
    })
    .select()
    .single();

  if (insertErr || !row) {
    console.error("[model-feedback] insert failed:", insertErr);
    return res.status(500).json({ error: "Failed to save feedback" });
  }

  // Fire-and-forget embedding backfill — embedding failure must NOT block
  // the response. We don't await this promise.
  void (async () => {
    try {
      const result = await embedTextSafe(comment.trim());
      if (result) {
        const vector = toPgVector(result.vector);
        await supabase
          .from("prompt_lab_model_feedback")
          .update({ embedding: vector })
          .eq("id", (row as { id: string }).id);
      }
    } catch (err) {
      console.error("[model-feedback] embedding backfill failed (non-fatal):", err);
    }
  })();

  const feedback: PromptLabModelFeedback = {
    id: (row as { id: string }).id,
    iteration_id: (row as { iteration_id: string }).iteration_id,
    session_id: (row as { session_id: string }).session_id,
    model_used: (row as { model_used: string }).model_used,
    pipeline_version: (row as { pipeline_version: string }).pipeline_version,
    resolution_used: (row as { resolution_used: string | null }).resolution_used,
    author: (row as { author: string }).author,
    comment: (row as { comment: string }).comment,
    created_at: (row as { created_at: string }).created_at,
  };

  return res.status(201).json(feedback);
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase();
  const q = req.query as Record<string, string | undefined>;

  // Branch A: by iteration_id
  if (q.iteration_id) {
    const { data, error } = await supabase
      .from("prompt_lab_model_feedback")
      .select("id, iteration_id, session_id, model_used, pipeline_version, resolution_used, author, comment, created_at")
      .eq("iteration_id", q.iteration_id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[model-feedback] GET by iteration_id failed:", error);
      return res.status(500).json({ error: "Failed to fetch feedback" });
    }

    return res.status(200).json((data ?? []) as PromptLabModelFeedback[]);
  }

  // Branch B: by model + pipeline_version
  if (q.model && q.pipeline_version) {
    const limit = Math.min(Number(q.limit ?? 20), 100);

    const { data, error } = await supabase
      .from("prompt_lab_model_feedback")
      .select("id, iteration_id, session_id, model_used, pipeline_version, resolution_used, author, comment, created_at")
      .eq("model_used", q.model)
      .eq("pipeline_version", q.pipeline_version)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[model-feedback] GET by model failed:", error);
      return res.status(500).json({ error: "Failed to fetch feedback" });
    }

    return res.status(200).json((data ?? []) as PromptLabModelFeedback[]);
  }

  return res.status(400).json({
    error: "Supply ?iteration_id=<> OR ?model=<>&pipeline_version=<>",
  });
}
