import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 60;

import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import {
  submitLabRender,
  ProviderCapacityError,
  getNextIterationNumber,
  ANALYSIS_PROMPT_HASH,
  DIRECTOR_PROMPT_HASH,
} from "../../../lib/prompt-lab.js";
import { V1_ATLAS_SKUS, type V1AtlasSku } from "../../../lib/providers/atlas.js";

// Audit A C2: wrap critical UPDATE calls that follow a remote POST (Atlas charge).
// If the UPDATE fails, the provider has already billed us but we can't retrieve
// the result. Retry 3× with exponential backoff so transient Supabase errors
// don't create orphaned-billed renders.
async function updateWithRetry<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
  label: string,
): Promise<{ ok: boolean; data?: T | null; error?: any }> {
  const delays = [100, 500, 2000];
  for (let i = 0; i <= delays.length; i++) {
    const res = await fn();
    if (!res.error) return { ok: true, data: res.data };
    if (i < delays.length) await new Promise((r) => setTimeout(r, delays[i]));
    else {
      console.error(`[${label}] update failed after ${delays.length + 1} attempts:`, res.error);
      return { ok: false, error: res.error };
    }
  }
  return { ok: false };
}

// POST /api/admin/prompt-lab/rerender
//   body: { source_iteration_id, provider }
// Clones analysis + director from source iteration into a new iteration,
// then submits to the specified provider. Each provider attempt gets its
// own iteration → its own rating → recipe captures the winning provider.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const { source_iteration_id, provider, sku: skuParam } = (req.body ?? {}) as {
    source_iteration_id?: string;
    provider?: "kling" | "runway";
    sku?: string | null;
  };
  if (!source_iteration_id || !provider) {
    return res.status(400).json({ error: "source_iteration_id and provider required" });
  }

  // Validate sku if explicitly provided.
  let explicitSku: V1AtlasSku | null = null;
  if (skuParam != null) {
    if (!(V1_ATLAS_SKUS as readonly string[]).includes(skuParam)) {
      return res.status(400).json({
        error: `sku="${skuParam}" is not a valid V1 Atlas SKU. Valid: ${V1_ATLAS_SKUS.join(", ")}`,
      });
    }
    explicitSku = skuParam as V1AtlasSku;
  }

  const supabase = getSupabase();
  const { data: source, error: sErr } = await supabase
    .from("prompt_lab_iterations")
    .select("*, prompt_lab_sessions(image_url, pipeline_version)")
    .eq("id", source_iteration_id)
    .single();
  if (sErr || !source) return res.status(404).json({ error: "source iteration not found" });

  // Read pipeline_version from the parent session. Defaults to 'v1' for
  // sessions created before migration 067.
  const pipelineVersion: "v1" | "v1.1" =
    ((source.prompt_lab_sessions as { pipeline_version?: string } | null)?.pipeline_version ?? "v1") === "v1.1"
      ? "v1.1"
      : "v1";
  if (!source.director_output_json) {
    return res.status(400).json({ error: "source iteration has no director output" });
  }

  const imageUrl = (source.prompt_lab_sessions as { image_url: string })?.image_url;
  if (!imageUrl) return res.status(400).json({ error: "session image url missing" });

  const iterationNumber = await getNextIterationNumber(source.session_id);

  const { data: newIteration, error: iErr } = await supabase
    .from("prompt_lab_iterations")
    .insert({
      session_id: source.session_id,
      iteration_number: iterationNumber,
      analysis_json: source.analysis_json,
      analysis_prompt_hash: source.analysis_prompt_hash ?? ANALYSIS_PROMPT_HASH,
      director_output_json: source.director_output_json,
      director_prompt_hash: source.director_prompt_hash ?? DIRECTOR_PROMPT_HASH,
      cost_cents: 0,
      embedding: source.embedding ?? null,
      embedding_model: source.embedding_model ?? null,
      retrieval_metadata: source.retrieval_metadata ?? null,
      user_comment: `[rerender] Same prompt, trying ${provider} (source: iteration ${source.iteration_number})`,
      pipeline_version: pipelineVersion,
    })
    .select()
    .single();
  if (iErr) return res.status(500).json({ error: iErr.message });

  try {
    const scene = source.director_output_json as any;
    const roomType = (source.analysis_json as any)?.room_type ?? "other";
    // v1.1: user-supplied provider/sku are ignored entirely — Seedance push-in
    // is the only render path. effectiveSku is passed as null so submitLabRender's
    // pipelineVersion='v1.1' branch takes full control.
    // v1: "rerender with same SKU" is frictionless: explicit body sku wins, else
    // fall back to the source iteration's model_used, then null (router default).
    const effectiveSku: V1AtlasSku | null = pipelineVersion === "v1.1"
      ? null
      : (explicitSku ?? ((source.model_used as V1AtlasSku | null | undefined) ?? null));
    const { jobId, provider: usedProvider, sku: resolvedSku, thompson, staticSku } = await submitLabRender({
      imageUrl,
      scene,
      roomType,
      // v1.1: providerOverride is intentionally null — Atlas is forced internally.
      providerOverride: pipelineVersion === "v1.1" ? null : provider,
      sku: effectiveSku,
      pipelineVersion,
    });

    // Audit A C2: Atlas POST has already fired (account charged). Retry the
    // UPDATE so a transient Supabase error doesn't orphan the jobId.
    const updateResult = await updateWithRetry(
      async () =>
        await supabase
          .from("prompt_lab_iterations")
          .update({
            provider: usedProvider,
            provider_task_id: jobId,
            render_submitted_at: new Date().toISOString(),
            render_error: null,
            model_used: resolvedSku,
            sku_source: "captured_at_render",
            pipeline_version: pipelineVersion,
          })
          .eq("id", newIteration.id)
          .select()
          .single(),
      `rerender persist [iter=${newIteration.id} job=${jobId}]`,
    );
    if (!updateResult.ok) {
      console.error(
        `[rerender] ORPHAN: iteration_id=${newIteration.id} jobId=${jobId} provider_task_id=${jobId} — check Atlas task within 7d`,
      );
      try {
        await supabase
          .from("prompt_lab_iterations")
          .update({
            render_error: `persist failed; orphan — check Atlas task ${jobId} within 7d`,
          })
          .eq("id", newIteration.id);
      } catch { /* best-effort */ }
      return res.status(500).json({ error: "Failed to persist provider_task_id after Atlas submit; orphan logged" });
    }

    try {
      await supabase.from("router_shadow_log").insert({
        iteration_id: newIteration.id,
        thompson_decision_json: thompson
          ? {
              sku: thompson.sku,
              reason: thompson.reason,
              sampled_theta: thompson.sampled_theta ?? null,
              arm_state: thompson.arm_state,
            }
          : { sku: resolvedSku, reason: "flag_off" },
        static_decision_json: { sku: staticSku },
        divergence_reason:
          thompson && thompson.sku !== staticSku
            ? `thompson.${thompson.reason}(theta=${thompson.sampled_theta ?? "n/a"})`
            : null,
      });
    } catch (err) {
      console.error("[router_shadow_log] insert failed:", err);
    }

    return res.status(201).json({
      iteration: { ...newIteration, provider: usedProvider, provider_task_id: jobId, sku: resolvedSku },
      source_iteration_id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ProviderCapacityError) {
      await supabase
        .from("prompt_lab_iterations")
        .update({
          provider: (err as ProviderCapacityError).provider,
          render_queued_at: new Date().toISOString(),
          render_error: null,
        })
        .eq("id", newIteration.id);
      return res.status(200).json({
        iteration: newIteration,
        queued: true,
        provider,
        message: `${provider} is full. Queued — will auto-submit when a slot opens.`,
      });
    }
    await supabase
      .from("prompt_lab_iterations")
      .update({ render_error: msg })
      .eq("id", newIteration.id);
    return res.status(500).json({ error: "rerender submit failed", detail: msg });
  }
}
