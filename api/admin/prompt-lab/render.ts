import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 60;

import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { submitLabRender, ProviderCapacityError } from "../../../lib/prompt-lab.js";
import { resolveEndFrameUrl } from "../../../lib/services/end-frame.js";
import { V1_ATLAS_SKUS, type V1AtlasSku, V1_1_LAB_SKUS } from "../../../lib/providers/atlas.js";

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

// POST /api/admin/prompt-lab/render
//   body: { iteration_id, provider? }
// Submits a clip generation job to the provider and records the task_id.
// Does NOT poll — the cron at /api/cron/poll-lab-renders finalizes.
// Returns immediately so client can navigate away safely.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const { iteration_id, provider: providerOverride, sku: skuParam } = (req.body ?? {}) as {
    iteration_id?: string;
    provider?: "kling" | "runway" | null;
    sku?: string | null;
  };
  if (!iteration_id) return res.status(400).json({ error: "iteration_id required" });

  // Validate sku if provided — must be in either the V1 or V1.1 allow-list.
  // We don't yet know the session's pipeline_version (fetched below), so we
  // accept both catalogs here. The v1.1-specific resolution block below then
  // checks V1_1_LAB_SKUS membership and defaults to seedance when unrecognised.
  // v1 sessions hit the normal router path and only V1_ATLAS_SKUS are routable.
  let sku: V1AtlasSku | null = null;
  if (skuParam != null) {
    const allValidSkus = [...(V1_ATLAS_SKUS as readonly string[]), ...(V1_1_LAB_SKUS as readonly string[])];
    if (!allValidSkus.includes(skuParam)) {
      return res.status(400).json({
        error: `sku="${skuParam}" is not a recognised Lab SKU. V1: ${V1_ATLAS_SKUS.join(", ")}; V1.1: ${V1_1_LAB_SKUS.join(", ")}`,
      });
    }
    sku = skuParam as V1AtlasSku;
  }

  const supabase = getSupabase();
  const { data: iteration, error: iErr } = await supabase
    .from("prompt_lab_iterations")
    .select("*, prompt_lab_sessions(image_url, pipeline_version)")
    .eq("id", iteration_id)
    .single();
  if (iErr || !iteration) return res.status(404).json({ error: "iteration not found" });

  // Read the pipeline_version from the parent session. Defaults to 'v1' for
  // sessions created before migration 067 (ADD COLUMN IF NOT EXISTS DEFAULT 'v1').
  const pipelineVersion: "v1" | "v1.1" =
    ((iteration.prompt_lab_sessions as { pipeline_version?: string } | null)?.pipeline_version ?? "v1") === "v1.1"
      ? "v1.1"
      : "v1";

  // v1.1 SKU resolution:
  //   - If user-supplied sku is in V1_1_LAB_SKUS → honour it.
  //   - Else (missing / not in the catalog) → default to seedance-pro-pushin.
  // V1_ATLAS_SKUS validation above only runs for v1; v1.1 has its own catalog.
  if (pipelineVersion === "v1.1") {
    const userSku = skuParam ?? null;
    sku = (userSku && (V1_1_LAB_SKUS as readonly string[]).includes(userSku))
      ? (userSku as V1AtlasSku)
      : ("seedance-pro-pushin" as V1AtlasSku);
  }
  if (!iteration.director_output_json) {
    return res.status(400).json({ error: "iteration has no director output to render" });
  }
  if (iteration.clip_url) {
    return res.status(200).json({ ...iteration, alreadyRendered: true });
  }
  if (iteration.provider_task_id) {
    return res.status(200).json({ ...iteration, alreadySubmitted: true });
  }

  const imageUrl = (iteration.prompt_lab_sessions as { image_url: string })?.image_url;
  if (!imageUrl) return res.status(400).json({ error: "session image url missing" });

  // Only synthesize an end-frame when the director EXPLICITLY paired another
  // session (via director_output_json.end_photo_id). Single-image Prompt Lab
  // renders — the V1 default — must NOT get a synthetic center-crop, because
  // submitLabRender treats any non-null endImageUrl as a paired render and
  // forces model_used = "kling-v2-1-pair" regardless of the user's SKU
  // selection. That routes Atlas through its paired-image endpoint and stalls
  // on single-photo sessions (2026-04-23 bug: 3 iterations stuck 85+ min on
  // kling-v2-1-pair with no real end photo).
  const director = iteration.director_output_json as { end_photo_id?: string } | null;
  let endImageUrl: string | null = null;
  if (director?.end_photo_id) {
    const { data: endSession } = await supabase
      .from("prompt_lab_sessions")
      .select("image_url")
      .eq("id", director.end_photo_id)
      .maybeSingle();
    if (endSession?.image_url) {
      endImageUrl = await resolveEndFrameUrl({
        startPhotoUrl: imageUrl,
        endPhotoUrl: endSession.image_url,
      });
    }
  }

  // Persist onto the iteration so the dashboard can display the
  // resolved URL and audit the end-frame decision.
  await supabase
    .from("prompt_lab_iterations")
    .update({
      end_photo_id: director?.end_photo_id ?? null,
      end_image_url: endImageUrl,
    })
    .eq("id", iteration_id);

  try {
    const { jobId, provider, sku: resolvedSku, thompson, staticSku } = await submitLabRender({
      imageUrl,
      scene: iteration.director_output_json,
      roomType: iteration.analysis_json?.room_type ?? "other",
      // v1.1 Seedance: force Atlas by nulling providerOverride (Seedance is Atlas-only).
      // v1.1 non-Seedance (Kling 3, etc.): pass user's provider choice through normally.
      // v1: pass user's provider choice through as before.
      providerOverride: (pipelineVersion === "v1.1" && sku === ("seedance-pro-pushin" as V1AtlasSku))
        ? null
        : (providerOverride === "kling" || providerOverride === "runway" ? providerOverride : null),
      endImageUrl,
      sku,
      pipelineVersion,
    });

    // Audit A C2: Atlas POST has already fired (account charged). Retry the
    // UPDATE so a transient Supabase error doesn't orphan the jobId.
    const updateResult = await updateWithRetry(
      async () =>
        await supabase
          .from("prompt_lab_iterations")
          .update({
            provider,
            provider_task_id: jobId,
            render_submitted_at: new Date().toISOString(),
            render_error: null,
            model_used: resolvedSku,
            sku_source: "captured_at_render",
            pipeline_version: pipelineVersion,
          })
          .eq("id", iteration_id)
          .select()
          .single(),
      `render persist [iter=${iteration_id} job=${jobId}]`,
    );
    if (!updateResult.ok) {
      // Final-failure: stamp a recoverable error so the UI surfaces the state,
      // and log the orphan details for manual recovery via Atlas dashboard
      // (7-day clip retention window).
      console.error(
        `[render] ORPHAN: iteration_id=${iteration_id} jobId=${jobId} provider_task_id=${jobId} — check Atlas task within 7d`,
      );
      try {
        await supabase
          .from("prompt_lab_iterations")
          .update({
            render_error: `persist failed; orphan — check Atlas task ${jobId} within 7d`,
          })
          .eq("id", iteration_id);
      } catch { /* best-effort */ }
      return res.status(500).json({ error: "Failed to persist provider_task_id after Atlas submit; orphan logged" });
    }
    const updated = updateResult.data;

    try {
      await supabase.from("router_shadow_log").insert({
        iteration_id,
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

    return res.status(200).json({ ...(updated ?? {}), sku: resolvedSku });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ProviderCapacityError) {
      // Queue instead of erroring — cron will submit when a slot opens.
      await supabase
        .from("prompt_lab_iterations")
        .update({
          provider: err.provider,
          render_queued_at: new Date().toISOString(),
          render_error: null,
        })
        .eq("id", iteration_id);
      return res.status(200).json({
        queued: true,
        provider: err.provider,
        in_flight: err.inFlight,
        limit: err.limit,
        message: `${err.provider} is full (${err.inFlight}/${err.limit}). Queued — will auto-submit when a slot opens.`,
      });
    }
    await supabase
      .from("prompt_lab_iterations")
      .update({ render_error: msg })
      .eq("id", iteration_id);
    return res.status(500).json({ error: "render submit failed", detail: msg });
  }
}
