import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase, updateScene, log } from "../../../lib/db.js";
import { selectProviderForScene, buildProviderFromDecision, getEnabledProviders } from "../../../lib/providers/router.js";
import { classifyProviderError } from "../../../lib/providers/errors.js";
import type { CameraMovement, PipelineMode, RoomType, VideoProvider } from "../../../lib/types.js";

export const maxDuration = 120;

// POST /api/scenes/:id/retry
// body: { prompt }
//
// Legacy endpoint kept for the Pipeline dashboard's "Retry with new
// prompt" button. Semantically this is `resubmit` with a required
// prompt change, so the logic is identical; the separate URL is kept
// to preserve the existing Pipeline.tsx button wiring.
//
// Previously this endpoint only updated `scenes.prompt` and flipped
// status back to `pending` with a `// TODO: trigger regeneration`
// comment — scenes stayed pending forever because nothing picked them
// up. That's what the docs meant by "Retry-scene endpoint for
// PRODUCTION — the stuck Kling scenes still need a manual retry. Not
// built yet." It is now.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const sceneId = req.query.id as string;
  const { prompt, provider: providerOverride, camera_movement } = (req.body ?? {}) as {
    prompt?: string;
    provider?: VideoProvider;
    camera_movement?: CameraMovement;
  };
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required" });
  }

  const supabase = getSupabase();
  const { data: scene, error } = await supabase
    .from("scenes")
    .select("id, property_id, photo_id, scene_number, camera_movement, duration_seconds, attempt_count, end_photo_id")
    .eq("id", sceneId)
    .single();
  if (error || !scene) return res.status(404).json({ error: "scene not found" });

  const { data: photo } = await supabase
    .from("photos")
    .select("file_url, room_type")
    .eq("id", scene.photo_id)
    .single();
  if (!photo) return res.status(404).json({ error: "source photo not found" });

  // Re-fetch pipeline_mode and video_model_sku so operator SKU pins and v1.1
  // routing are honored on retry exactly as on the original submission.
  // Non-fatal: default to v1 / no pin if the property lookup hiccups.
  let pipelineMode: PipelineMode = "v1";
  let listingSkuPin: string | null = null;
  try {
    const { data: property } = await supabase
      .from("properties")
      .select("pipeline_mode, video_model_sku")
      .eq("id", scene.property_id)
      .single();
    if (property) {
      pipelineMode = ((property as { pipeline_mode?: string }).pipeline_mode as PipelineMode | undefined) ?? "v1";
      listingSkuPin = (property as { video_model_sku?: string | null }).video_model_sku ?? null;
    }
  } catch {
    // Non-fatal: fall through with defaults.
  }

  const patch: Record<string, unknown> = { prompt: prompt.trim() };
  if (camera_movement) patch.camera_movement = camera_movement;
  await updateScene(sceneId, patch);

  await supabase
    .from("scenes")
    .update({
      provider_task_id: null,
      atlas_model_sku: null,
      clip_url: null,
      generation_cost_cents: null,
      generation_time_ms: null,
      qc_verdict: null,
      qc_confidence: null,
      status: "pending",
    })
    .eq("id", sceneId);

  // C.2 (base64→URL): providers all accept sourceImageUrl directly;
  // skip the buffer fetch that was the source of base64 payloads.
  const sourceImage = Buffer.alloc(0); // placeholder — providers use sourceImageUrl
  const roomType = (photo.room_type as RoomType) ?? "other";
  const movement = (camera_movement ?? (scene.camera_movement as CameraMovement)) ?? null;

  const excluded: VideoProvider[] = [];
  const maxFailovers = Math.max(getEnabledProviders().length - 1, 1);
  let lastError: { message: string; kind: string; provider: string } | null = null;

  for (let attempt = 0; attempt <= maxFailovers; attempt++) {
    // Precedence: listing pin (video_model_sku → skuOverride, RULE 0 in
    // selectProviderForScene) wins over the per-request providerOverride
    // (→ preference). This mirrors the main pipeline (runGenerationSubmit /
    // runResubmitScene). If the operator explicitly passes provider= in the
    // request body but the listing also has a pinned SKU, the pin wins because
    // the SKU-level choice is the operator's deliberate model selection for this
    // property, while provider= is a coarser, ad-hoc routing hint.
    const decision = selectProviderForScene(
      {
        endPhotoId: (scene as { end_photo_id?: string | null }).end_photo_id ?? null,
        movement,
        roomType,
        preference: providerOverride ?? null,
      },
      excluded,
      pipelineMode,
      listingSkuPin,
    );
    const provider = buildProviderFromDecision(decision);
    try {
      const genJob = await provider.generateClip({
        sourceImage,
        sourceImageUrl: photo.file_url,
        prompt: prompt.trim(),
        durationSeconds: scene.duration_seconds,
        aspectRatio: "16:9",
        modelOverride: decision.modelKey,
      });

      const nextAttemptCount = (scene.attempt_count ?? 0) + 1;
      await supabase
        .from("scenes")
        .update({
          provider: provider.name,
          provider_task_id: genJob.jobId,
          submitted_at: new Date().toISOString(),
          status: "generating",
          attempt_count: nextAttemptCount,
          // Persist the rendered Atlas SKU so the poll loop can reconstruct a
          // cost-accurate AtlasProvider instance (correct priceCentsPerClip).
          // Non-atlas providers use null — their cost doesn't come from ATLAS_MODELS.
          atlas_model_sku: decision.provider === "atlas" ? (decision.modelKey ?? null) : null,
        })
        .eq("id", sceneId);

      await log(scene.property_id, "generation", "info",
        `Scene ${scene.scene_number}: retried with new prompt on ${provider.name} (attempt ${nextAttemptCount})`,
        { jobId: genJob.jobId, attempt: nextAttemptCount, newPrompt: prompt.trim() }, sceneId);

      return res.status(200).json({ ok: true, provider: provider.name, jobId: genJob.jobId });
    } catch (err) {
      const classified = classifyProviderError(err);
      lastError = { message: classified.message, kind: classified.kind, provider: provider.name };

      if (!classified.shouldFailover) {
        await log(scene.property_id, "generation", "warn",
          `Scene ${scene.scene_number}: ${provider.name} ${classified.kind} on retry: ${classified.message}`,
          { status: classified.status, kind: classified.kind }, sceneId);
        return res.status(503).json({
          ok: false,
          kind: classified.kind,
          provider: provider.name,
          message: classified.message,
          willRetryViaCron: true,
        });
      }

      excluded.push(provider.name as VideoProvider);
      await log(scene.property_id, "generation", "warn",
        `Scene ${scene.scene_number}: ${provider.name} permanent on retry, failing over: ${classified.message}`,
        { status: classified.status, kind: classified.kind, excluded }, sceneId);
    }
  }

  await supabase
    .from("scenes")
    .update({ status: "needs_review" })
    .eq("id", sceneId);
  await log(scene.property_id, "generation", "error",
    `Scene ${scene.scene_number}: retry failed across ${excluded.length} provider(s): ${lastError?.message ?? "unknown"}`,
    { lastError, excluded }, sceneId);
  return res.status(502).json({
    ok: false,
    kind: lastError?.kind ?? "unknown",
    message: lastError?.message ?? "All providers failed",
    excluded,
  });
}
