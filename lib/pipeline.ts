import Anthropic from "@anthropic-ai/sdk";
import {
  getSupabase,
  getPhotosForProperty,
  updatePropertyStatus,
  updatePhotoAnalysis,
  getSelectedPhotos,
  insertScenes,
  embedScene,
  updateSceneStatus,
  updateScene,
  getScenesForProperty,
  getProperty,
  addPropertyCost,
  recordCostEvent,
  recordPromptRevisionIfChanged,
  log,
} from "./db.js";
import { computeClaudeCost } from "./utils/claude-cost.js";
import type { Photo, RoomType, DepthRating, VideoProvider, CameraMovement, PipelineMode } from "./types.js";
import {
  PHOTO_ANALYSIS_SYSTEM,
  buildAnalysisUserPrompt,
  type PhotoAnalysisResult,
} from "./prompts/photo-analysis.js";
import {
  DIRECTOR_SYSTEM,
  buildDirectorUserPrompt,
  DURATION_PRESETS,
  type DirectorOutput,
  type DurationTarget,
} from "./prompts/director.js";
import {
  STYLE_GUIDE_SYSTEM,
  buildStyleGuideUserPrompt,
  type PropertyStyleGuide,
} from "./prompts/style-guide.js";
import {
  QC_SYSTEM,
  buildQCUserPrompt,
  buildPromptModification,
  type QCResult,
} from "./prompts/qc-evaluator.js";
import { resolveProductionPrompt } from "./prompts/resolve.js";
import { rewritePromptForNewMotion } from "./prompts/rewrite-on-motion-override.js";
import {
  fetchPerPhotoRetrievalBundle,
  renderPerPhotoBlock,
} from "./prompts/per-photo-retrieval.js";
import { resolveEndFrameUrl } from "./services/end-frame.js";
import { selectProviderForScene, buildProviderFromDecision, getEnabledProviders, forceSeedancePushInPrompt } from "./providers/router.js";
import { pollUntilComplete } from "./providers/provider.interface.js";
import { classifyProviderError } from "./providers/errors.js";
import { orderScenesForAssembly } from "./assembly/scene-ordering.js";
import { fitScenesToDuration } from "./assembly/duration-fit.js";
import { fetchPropertyBranding } from "./assembly/branding.js";
import { selectMusicTrackForProperty } from "./assembly/music.js";
import { resolveTemplateId } from "./assembly/template-resolver.js";
import { buildTemplateModifications } from "./assembly/template-modifications.js";
import { applyRealtorSuffix, brandKitFromClient, mergeBrandVars } from "./operator-studio/brand-kit.js";
import type { ClientRow } from "./types/operator-studio.js";
import {
  analyzePhotoWithGemini,
  type ExtendedPhotoAnalysis,
  type MotionHeadroom,
} from "./providers/gemini-analyzer.js";
import { mapCameraMovementToHeadroomKey } from "./prompt-lab-listings.js";
import {
  selectPhotos,
  TARGET_SCENE_COUNT,
  MAX_PER_ROOM_TYPE,
  REQUIRED_ROOM_TYPES,
} from "./pipeline/selection.js";
import { tryClaimPipelineRun } from "./pipeline-claim.js";

// Used by analyzer batching; keep here since it's only a concern of this file.
const BATCH_SIZE = 8;

// Re-export for any downstream importer that pulls these via lib/pipeline.
export { TARGET_SCENE_COUNT, MAX_PER_ROOM_TYPE, REQUIRED_ROOM_TYPES };

// ─── HELPERS ───────────────────────────────────────────────────

/**
 * Coerce `camera_movement` to `'push_in'` for every non-paired scene when the
 * property is in v1.1 pipeline mode.
 *
 * Motivation: v1.1 routes ALL non-paired scenes to a Seedance push-in SKU at
 * render time, so the value stored in the `scenes` table should reflect that
 * reality rather than whatever 11-verb movement the director planned. Paired
 * scenes (`end_photo_id` set) are routed to `kling-v3-pro` and keep their
 * original movement untouched.
 *
 * Pure — inputs are never mutated; new objects are returned.
 */
export function coerceToPushInForV11<
  T extends { camera_movement: string; end_photo_id?: string | null },
>(scenes: T[], pipelineMode: string): T[] {
  if (pipelineMode !== "v1.1") return scenes;
  return scenes.map((s) => {
    if (s.end_photo_id) return s; // paired — leave untouched
    return { ...s, camera_movement: "push_in" };
  });
}

// ─── ROUTING PREFERENCE RESOLVER ───────────────────────────────
//
// Pure function extracted from runGenerationSubmit and resubmitScene so the
// "prefers director intent, ignores actual-ran provider" rule has a single
// authoritative implementation and can be unit-tested without mocking Supabase.
//
// Logic:
// 1. opts.providerOverride always wins (explicit caller intent).
// 2. scene.provider_preference (the director's original intent, stored at
//    scene-insert time) wins when set.
// 3. provider_preference=null or undefined → null (router decides).
// 4. scene.provider is NEVER consulted here — it is the pure what-actually-ran
//    audit record that poll-scenes.ts uses to reconstruct a provider instance
//    for polling; reading it for routing re-introduces the pollution it caused.
//
// Guard: if the migration 084 hasn't been applied yet, provider_preference will
// be absent from the row (TypeScript sees it as possibly undefined). The
// optional-chain + nullish-coalesce to null makes the call site null-safe.

export function resolveRoutingPreference(
  scene: { provider: string | null; provider_preference?: string | null },
  providerOverride?: string | null,
): string | null {
  if (providerOverride != null) return providerOverride;
  return scene.provider_preference ?? null;
}

// ─── MAIN PIPELINE ─────────────────────────────────────────────

// Snapshot every system prompt to prompt_revisions on each pipeline run so
// the Learning dashboard can show a changelog. No-ops if the body is
// unchanged from the last recorded version. For `director` we snapshot
// the EFFECTIVE body (lab-promoted revision if present, code constant
// otherwise) so the changelog reflects what actually ran.
async function snapshotPromptRevisions(): Promise<void> {
  try {
    const effectiveDirector = await resolveProductionPrompt("director", DIRECTOR_SYSTEM);
    await Promise.all([
      recordPromptRevisionIfChanged("photo-analysis", PHOTO_ANALYSIS_SYSTEM),
      recordPromptRevisionIfChanged("director", effectiveDirector.body),
recordPromptRevisionIfChanged("style-guide", STYLE_GUIDE_SYSTEM),
      recordPromptRevisionIfChanged("qc-evaluator", QC_SYSTEM),
    ]);
  } catch {
    // Best-effort; never block a pipeline run on changelog recording.
  }
}

export async function runPipeline(propertyId: string): Promise<void> {
  try {
    // Atomic pipeline-run claim — prevents the duplicate-execution race that
    // shipped duplicate scenes on the 13fe5a96 rerun (2026-05-18). The Re-run
    // UI fires triggerPipeline as fire-and-forget; any second POST (browser
    // retry, double-click, second tab) lands a parallel runPipeline before
    // the first has progressed past 'queued'. The CAS pattern below — update
    // properties SET status='analyzing', pipeline_started_at=NOW() WHERE id=?
    // AND status IN (queued, failed, needs_review) — returns the matched row
    // exactly once; the loser sees 0 rows and bails. Side effect: stamps
    // pipeline_started_at so downstream processing_time_ms measures this
    // RUN, not the property's original creation date.
    const claimed = await tryClaimPipelineRun(getSupabase(), propertyId);
    if (!claimed) {
      await log(propertyId, "intake", "warn",
        "Pipeline already in flight or in a non-rerunnable state; ignoring duplicate runPipeline() invocation");
      return;
    }

    // Pull operator-context fields so every log line in this run carries them.
    // Distinguishes operator-mode work (order_mode='operator', client_id set)
    // from customer self-serve runs in production logs. Pure read — no behavior fork.
    let orderMode: string | null = null;
    let clientId: string | null = null;
    try {
      const { data: propCtx } = await getSupabase()
        .from("properties")
        .select("order_mode, client_id")
        .eq("id", propertyId)
        .maybeSingle();
      orderMode = (propCtx as { order_mode?: string | null } | null)?.order_mode ?? null;
      clientId = (propCtx as { client_id?: string | null } | null)?.client_id ?? null;
    } catch {
      // Best-effort; never block a pipeline run on context read.
    }
    // Shared log context threaded through every top-level log call in this run.
    const opCtx: Record<string, unknown> = { order_mode: orderMode, client_id: clientId };

    await log(propertyId, "intake", "info", "Pipeline started", opCtx);
    // Best-effort prompt changelog snapshot (no-op if unchanged).
    snapshotPromptRevisions();

    // Stage 1: Intake (photos already uploaded by the API route)
    // Just verify photos exist
    const photos = await getPhotosForProperty(propertyId);
    if (photos.length < 5) {
      await updatePropertyStatus(propertyId, "failed");
      await log(propertyId, "intake", "error", `Only ${photos.length} photos. Need at least 5.`, opCtx);
      return;
    }
    await log(propertyId, "intake", "info", `${photos.length} photos ready`, opCtx);

    // Stage 2: Analyze
    await runAnalysis(propertyId, photos);

    // Stage 2.5: Build Property Style Guide — one vision pass that sees all
    // selected photos at once so later scene prompts can describe adjacent
    // rooms accurately instead of the video model hallucinating them.
    await runPropertyStyleGuide(propertyId);

    // Stage 3: Script
    await runScripting(propertyId);

    // Stage 3.5 (Pre-flight prompt QA) REMOVED. It was burning ~95s of the
    // 300s function budget on 12 sequential Claude vision calls AND
    // silently rewriting the director's short crisp prompts into long
    // narrative paragraphs that regressed output quality. The director
    // + video_viable filter + Oliver's per-room feature vocab + the
    // rating-based learning loop are the real quality levers. QA was
    // adding more bugs than it prevented.

    // Stage 4: Generate — fire-and-forget submission only. The cron
    // backstop at api/cron/poll-scenes.ts handles ALL polling, clip
    // collection, AND assembly invocation, so this function can exit
    // in ~60s instead of hitting the 300s maxDuration with half the
    // scenes never submitted. See poll-scenes.ts finalize block — when
    // all scenes have settled it calls runAssembly(propertyId).
    await runGenerationSubmit(propertyId);
    await log(propertyId, "generation", "info",
      "All scenes submitted to providers. Cron will collect clips + assemble.", opCtx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updatePropertyStatus(propertyId, "failed");
    await log(propertyId, "intake", "error", `Pipeline failed: ${msg}`);
    throw err;
  }
}

// ─── STAGE 2: ANALYZE ──────────────────────────────────────────

async function runAnalysis(propertyId: string, photos: Photo[]): Promise<void> {
  await updatePropertyStatus(propertyId, "analyzing");
  await log(propertyId, "analysis", "info", "Starting photo analysis (Gemini eyes)");

  // DA.1 — prod photo analysis now runs Gemini 3 Flash per-photo (in
  // parallel) for structured camera-state + motion_headroom. Claude
  // batching is kept as a fallback for the whole remaining set when
  // Gemini fails on any individual photo — that way a partial-failure
  // listing still gets full analysis, just without motion_headroom on
  // the failing photos (which the DA.3 validator handles as permissive).
  const allResults: Array<{
    photo: Photo;
    analysis: ExtendedPhotoAnalysis;
    provider: "google" | "anthropic";
  }> = [];
  const geminiFailures: Photo[] = [];

  await Promise.all(
    photos.map(async (photo) => {
      try {
        const res = await analyzePhotoWithGemini(photo.file_url);
        allResults.push({ photo, analysis: res.analysis, provider: "google" });
        // Gemini cost event per photo.
        await recordCostEvent({
          propertyId,
          stage: "analysis",
          provider: "google",
          unitsConsumed: res.usage.inputTokens + res.usage.outputTokens,
          unitType: "tokens",
          costCents: res.usage.costCents,
          metadata: {
            scope: "prod_photo_eyes",
            model: res.model,
            photo_id: photo.id,
            input_tokens: res.usage.inputTokens,
            output_tokens: res.usage.outputTokens,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await log(propertyId, "analysis", "warn",
          `Gemini failed for ${photo.file_name}: ${msg} — will retry via Claude fallback`);
        geminiFailures.push(photo);
      }
    }),
  );

  // Claude fallback for Gemini failures — keep the existing batch path
  // so a provider outage doesn't kill the whole run. Motion_headroom is
  // defaulted to permissive for fallback photos (DA.3 validator won't
  // block on them).
  if (geminiFailures.length > 0) {
    await log(propertyId, "analysis", "info",
      `Running Claude fallback for ${geminiFailures.length} photo(s) where Gemini failed`);
    const client = new Anthropic();
    for (let i = 0; i < geminiFailures.length; i += BATCH_SIZE) {
      const batch = geminiFailures.slice(i, i + BATCH_SIZE);
      const imageContents: Anthropic.ImageBlockParam[] = [];

      for (const photo of batch) {
        try {
          const response = await fetch(photo.file_url);
          const contentType = response.headers.get("content-type") ?? "";
          const buffer = Buffer.from(await response.arrayBuffer());
          const mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" =
            contentType.includes("png") ? "image/png"
            : contentType.includes("webp") ? "image/webp"
            : contentType.includes("gif") ? "image/gif"
            : "image/jpeg";
          imageContents.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: buffer.toString("base64"),
            },
          });
        } catch (err) {
          await log(propertyId, "analysis", "warn", `Failed to load ${photo.file_name}: ${err}`);
        }
      }

      if (imageContents.length === 0) continue;

      try {
        const ANALYSIS_MODEL = "claude-sonnet-4-6";
        const response = await client.messages.create({
          model: ANALYSIS_MODEL,
          max_tokens: 4096,
          system: PHOTO_ANALYSIS_SYSTEM,
          messages: [
            {
              role: "user",
              content: [
                ...imageContents,
                { type: "text", text: buildAnalysisUserPrompt(imageContents.length) },
              ],
            },
          ],
        });

        const usageCost = computeClaudeCost(response.usage as never, ANALYSIS_MODEL);
        await recordCostEvent({
          propertyId,
          stage: "analysis",
          provider: "anthropic",
          unitsConsumed: usageCost.totalTokens,
          unitType: "tokens",
          costCents: usageCost.costCents,
          metadata: {
            scope: "prod_photo_eyes_fallback",
            model: "claude-sonnet-4-6",
            batch_index: i,
            image_count: imageContents.length,
            reason: "gemini_failure",
            ...usageCost.breakdown,
          },
        });

        const text = response.content[0].type === "text" ? response.content[0].text : "";
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) continue;

        const results: PhotoAnalysisResult[] = JSON.parse(jsonMatch[0]);
        const permissiveHeadroom: MotionHeadroom = {
          push_in: true,
          pull_out: true,
          orbit: true,
          parallax: true,
          drone_push_in: true,
          top_down: true,
        };
        for (let j = 0; j < results.length && j < batch.length; j++) {
          const claudeAnalysis = results[j];
          // Promote Claude's PhotoAnalysisResult to ExtendedPhotoAnalysis
          // with permissive motion_headroom. Director + validator treat
          // these as "no hard bans" rather than blocking everything.
          const extended: ExtendedPhotoAnalysis = {
            ...claudeAnalysis,
            camera_height: "eye_level",
            camera_tilt: "level",
            frame_coverage: "medium",
            motion_headroom: permissiveHeadroom,
            motion_headroom_rationale: {
              note: "gemini failed; claude fallback; motion_headroom defaulted to permissive",
            },
          };
          allResults.push({ photo: batch[j], analysis: extended, provider: "anthropic" });
        }
      } catch (err) {
        await log(propertyId, "analysis", "error", `Claude fallback batch ${i} failed: ${err}`);
      }
    }
  }

  // Selection algorithm — only video-viable photos are eligible
  const selected = selectPhotos(allResults);

  for (const { photo, analysis, provider } of allResults) {
    const isSelected = selected.some((s) => s.photo.id === photo.id);
    // If the analyzer marked the photo non-viable for video, surface that
    // as the discard reason in the UI so Oliver can see WHY it wasn't picked.
    const notViableReason = analysis.video_viable === false
      ? `Not usable as video starting frame: ${analysis.motion_rationale ?? "no clean motion path"}`
      : null;
    await updatePhotoAnalysis(photo.id, {
      room_type: analysis.room_type,
      quality_score: analysis.quality_score,
      aesthetic_score: analysis.aesthetic_score,
      depth_rating: analysis.depth_rating,
      key_features: analysis.key_features,
      composition: analysis.composition ?? null,
      selected: isSelected,
      discard_reason: analysis.suggested_discard
        ? analysis.discard_reason
        : notViableReason ?? (isSelected ? null : "Not selected"),
      video_viable: analysis.video_viable ?? null,
      suggested_motion: analysis.suggested_motion ?? null,
      motion_rationale: analysis.motion_rationale ?? null,
      // DA.1 — persist the full ExtendedPhotoAnalysis blob + which model
      // produced it. The director reads motion_headroom from analysis_json
      // in runScripting below.
      analysis_json: analysis as unknown as Record<string, unknown>,
      analysis_provider: provider,
    });
  }

  await getSupabase()
    .from("properties")
    .update({ selected_photo_count: selected.length })
    .eq("id", propertyId);

  const nonViableCount = allResults.filter(r => r.analysis.video_viable === false).length;
  await log(propertyId, "analysis", "info",
    `Analysis done: ${selected.length} selected from ${allResults.length} (${nonViableCount} photos marked non-viable for video)`);

  // Fix B: fail fast when zero photos are usable so the pipeline never
  // proceeds to scripting/generation with an empty photo set and silently
  // stalls at 'generating' forever (0/0 scenes submitted = no cron trigger).
  // Gate covers both "all fetches failed" and "all photos marked non-viable".
  if (selected.length === 0) {
    const reason = allResults.length === 0
      ? `0 of ${photos.length} photos loadable — check photos.file_url are absolute URLs`
      : `0 of ${allResults.length} analyzed photos were video-viable — all marked non-viable`;
    await updatePropertyStatus(propertyId, "failed");
    await log(propertyId, "analysis", "error", reason);
    // Surface the error in the operator delivery stepper if a run exists.
    try {
      const { data: run } = await getSupabase()
        .from("delivery_runs")
        .select("id")
        .eq("property_id", propertyId)
        .neq("stage", "delivered")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (run) {
        const { setRunError } = await import("./delivery/runs.js");
        await setRunError((run as { id: string }).id, reason);
      }
    } catch {
      // Best-effort — never block the fail-fast on a run-lookup hiccup.
    }
    throw new Error(reason);
  }
}

// selectPhotos lives in ./pipeline/selection.ts — imported at the top of this
// file. Prompt Lab's batch-selection endpoint uses the same module so the
// Lab preview can never drift from the real production selection.

// ─── STAGE 2.5: PROPERTY STYLE GUIDE ──────────────────────────
// One vision pass over all selected photos produces a structured style
// guide saved to properties.style_guide. The director injects it into
// per-scene prompts so the downstream video model knows what adjacent
// rooms look like instead of inventing them.

async function runPropertyStyleGuide(propertyId: string): Promise<void> {
  await log(propertyId, "scripting", "info", "Building property style guide");

  const photos = await getSelectedPhotos(propertyId);
  if (photos.length === 0) {
    await log(propertyId, "scripting", "warn", "No selected photos for style guide — skipping");
    return;
  }

  // Load all selected photos as image blocks for Claude vision.
  const imageContents: Anthropic.ImageBlockParam[] = [];
  for (const photo of photos) {
    try {
      const response = await fetch(photo.file_url);
      const contentType = response.headers.get("content-type") ?? "";
      const buffer = Buffer.from(await response.arrayBuffer());
      const mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" =
        contentType.includes("png") ? "image/png"
        : contentType.includes("webp") ? "image/webp"
        : contentType.includes("gif") ? "image/gif"
        : "image/jpeg";
      imageContents.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") },
      });
    } catch (err) {
      await log(propertyId, "scripting", "warn", `Style guide failed to load ${photo.file_name}: ${err}`);
    }
  }
  if (imageContents.length === 0) {
    await log(propertyId, "scripting", "warn", "Style guide: no images loaded");
    return;
  }

  try {
    const client = new Anthropic();
    const STYLE_MODEL = "claude-sonnet-4-6";
    const response = await client.messages.create({
      model: STYLE_MODEL,
      max_tokens: 3000,
      system: STYLE_GUIDE_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...imageContents,
            { type: "text", text: buildStyleGuideUserPrompt(imageContents.length) },
          ],
        },
      ],
    });

    // Record cost
    const usage = computeClaudeCost(response.usage as never, STYLE_MODEL);
    await recordCostEvent({
      propertyId,
      stage: "scripting",
      provider: "anthropic",
      unitsConsumed: usage.totalTokens,
      unitType: "tokens",
      costCents: usage.costCents,
      metadata: {
        model: "claude-sonnet-4-6",
        stage_detail: "style_guide",
        image_count: imageContents.length,
        ...usage.breakdown,
      },
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      await log(propertyId, "scripting", "warn", "Style guide: could not parse JSON");
      return;
    }
    const styleGuide = JSON.parse(jsonMatch[0]) as PropertyStyleGuide;
    await getSupabase()
      .from("properties")
      .update({ style_guide: styleGuide })
      .eq("id", propertyId);
    await log(propertyId, "scripting", "info",
      `Style guide built: mood="${styleGuide.overall_mood}"`, { tokens: usage.totalTokens });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log(propertyId, "scripting", "error", `Style guide failed: ${msg}`);
  }
}

// ─── STAGE 3: SCRIPTING ────────────────────────────────────────

/** Look up a photo's image URL by its UUID. Returns null if not found. */
async function getPhotoUrlById(photoId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("photos")
    .select("file_url")
    .eq("id", photoId)
    .maybeSingle();
  return (data as { file_url?: string | null } | null)?.file_url ?? null;
}

async function runScripting(propertyId: string): Promise<void> {
  await updatePropertyStatus(propertyId, "scripting");
  await log(propertyId, "scripting", "info", "Planning shots");

  const photos = await getSelectedPhotos(propertyId);
  if (photos.length === 0) {
    await updatePropertyStatus(propertyId, "failed");
    await log(propertyId, "scripting", "error", "No selected photos");
    return;
  }

  const client = new Anthropic();
  const photoData = photos.map((p: Photo & {
    composition?: string | null;
    suggested_motion?: string | null;
    motion_rationale?: string | null;
    analysis_json?: Record<string, unknown> | null;
  }) => {
    // DA.2 — camera-state fields live in analysis_json. Extract them for
    // the director so motion_headroom bans are enforceable. When
    // analysis_json is missing (legacy rows, pre-migration-030 data), the
    // fields fall back to null and the director operates as before.
    const aj = (p.analysis_json ?? {}) as {
      camera_height?: string | null;
      camera_tilt?: string | null;
      frame_coverage?: string | null;
      motion_headroom?: Record<string, boolean> | null;
      motion_headroom_rationale?: Record<string, string> | null;
    };
    return {
      id: p.id,
      file_name: p.file_name ?? "unknown.jpg",
      room_type: p.room_type ?? "other",
      aesthetic_score: p.aesthetic_score ?? 5,
      depth_rating: p.depth_rating ?? "medium",
      key_features: p.key_features ?? [],
      // Per-photo composition + video-viability hints from the analyzer.
      // The director uses composition to ground each prompt in the real
      // photo layout and suggested_motion as the default camera movement
      // unless diversity forces an override.
      composition: p.composition ?? null,
      suggested_motion: p.suggested_motion ?? null,
      motion_rationale: p.motion_rationale ?? null,
      // DA.2 — camera-state + motion_headroom surfaced to the director
      // as hard bans on camera_movement choices.
      camera_height: aj.camera_height ?? null,
      camera_tilt: aj.camera_tilt ?? null,
      frame_coverage: aj.frame_coverage ?? null,
      motion_headroom: aj.motion_headroom ?? null,
      motion_headroom_rationale: aj.motion_headroom_rationale ?? null,
    };
  });

  // Per-photo retrieval bundles — for each selected photo we fetch
  // top-3 recipes (validated winning templates), top-5 exemplars (4-5★
  // past prompts on visually similar photos), and top-3 losers (1-2★
  // past prompts on visually similar photos), all scoped to the photo's
  // room_type and embedded composition. Recipes are filtered against
  // the photo's motion_headroom so the director never sees recipes
  // DA.2 would later ban.
  //
  // Replaces the previous global "PAST GENERATIONS" block, which was
  // date-ranked top-5 winners/losers across all properties and biased
  // the director toward whatever recently rated highly regardless of
  // composition fit (root cause of the 2026-05-13 motion-collapse bug —
  // see docs/specs/2026-05-13-prompt-collapse-fix-design.md).
  // Load pipeline_mode to scope recipe retrieval to the correct version.
  // Defaults to 'v1' for properties created before migration 062/063.
  let propertyPipelineMode: string = "v1";
  try {
    const prop = await getProperty(propertyId);
    propertyPipelineMode = prop.pipeline_mode ?? "v1";
  } catch {
    // Non-fatal — fall through to v1 default.
  }

  let learningBlock = "";
  try {
    const bundles = await Promise.all(
      photoData.map((p) =>
        fetchPerPhotoRetrievalBundle({
          photoId: p.id,
          roomType: p.room_type,
          motionHeadroom: p.motion_headroom ?? null,
          pipelineVersion: propertyPipelineMode,
        }).then((bundle) => ({ photoId: p.id, bundle })),
      ),
    );
    const blocks = bundles
      .map(({ photoId, bundle }) => renderPerPhotoBlock(photoId, bundle))
      .filter(Boolean);
    const recipeCount = bundles.reduce((n, b) => n + b.bundle.recipes.length, 0);
    const exemplarCount = bundles.reduce((n, b) => n + b.bundle.exemplars.length, 0);
    const loserCount = bundles.reduce((n, b) => n + b.bundle.losers.length, 0);
    if (blocks.length > 0) {
      learningBlock = `\n\nPER-PHOTO RETRIEVAL — for each photo below you'll find recipes (validated winning templates), exemplars (4-5★ past prompts on visually similar photos), and losers (1-2★ past prompts on visually similar photos). Use these to PICK ONE template per photo and adapt it — do NOT blend templates. Prefer the highest-similarity recipe whose motion fits this frame. Steer clear of patterns in the loser blocks.${blocks.join("")}`;
      await log(propertyId, "scripting", "info",
        `Per-photo retrieval: ${blocks.length}/${photoData.length} photos got retrieval blocks (${recipeCount} recipes, ${exemplarCount} exemplars, ${loserCount} losers)`);
    } else {
      await log(propertyId, "scripting", "info",
        `Per-photo retrieval: 0 blocks produced (likely missing image_embeddings on selected photos)`);
    }
  } catch (err) {
    await log(propertyId, "scripting", "warn",
      `Per-photo retrieval failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  // The property style guide is intentionally NOT injected into the
  // director's user message. The short-prompt director rule forbids
  // material/color descriptions in per-scene prompts.
  //
  // Resolve the effective director system prompt: a Lab override
  // promoted via /api/admin/prompt-lab/promote-to-prod takes
  // precedence over the compile-time DIRECTOR_SYSTEM. Falls back
  // transparently on any error.
  // C.3: Read selected_duration from the property row.
  // properties.selected_duration is not yet persisted by the order form (that's
  // Phase 2 — post-mastery). We query it optimistically: if it exists and is
  // 15 | 30 | 60, use it; otherwise default to 60 and log which path we took
  // so we can tell when persistence finally lands.
  let duration: DurationTarget = 60;
  try {
    const { data: propRow } = await getSupabase()
      .from("properties")
      .select("selected_duration")
      .eq("id", propertyId)
      .maybeSingle();
    const raw = (propRow as { selected_duration?: unknown } | null)?.selected_duration;
    if (raw === 15 || raw === 30 || raw === 60) {
      duration = raw as DurationTarget;
      await log(propertyId, "scripting", "info",
        `selected_duration=${duration}s read from property row`);
    } else {
      await log(propertyId, "scripting", "info",
        `selected_duration not persisted yet (got ${JSON.stringify(raw)}) — defaulting to 60s`);
    }
  } catch {
    await log(propertyId, "scripting", "warn",
      "selected_duration lookup failed — defaulting to 60s");
  }

  const effectiveDirector = await resolveProductionPrompt("director", DIRECTOR_SYSTEM);
  if (effectiveDirector.source === "lab_promotion") {
    await log(propertyId, "scripting", "info",
      `Director prompt resolved from lab promotion v${effectiveDirector.version}`,
      {
        revision_id: effectiveDirector.revision_id,
        source_override_id: effectiveDirector.source_override_id,
      },
    );
  }
  const DIRECTOR_MODEL = "claude-sonnet-4-6";
  const response = await client.messages.create({
    model: DIRECTOR_MODEL,
    max_tokens: 4096,
    system: effectiveDirector.body,
    messages: [{ role: "user", content: buildDirectorUserPrompt(photoData, duration) + learningBlock }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    await updatePropertyStatus(propertyId, "failed");
    await log(propertyId, "scripting", "error", "Failed to parse director output");
    return;
  }

  const output: DirectorOutput = JSON.parse(jsonMatch[0]);
  const validPhotoIds = new Set(photos.map((p) => p.id));
  const validScenes = output.scenes.filter((s) => validPhotoIds.has(s.photo_id));

  // DA.3 — validate each scene against the source photo's motion_headroom
  // and deterministically override camera_movement when the director
  // picked a banned motion. Cheap, no re-prompt, halves the latency of
  // the round-trip-to-fix approach. See DIRECTOR_SYSTEM "HARD MOVEMENT
  // BANS FROM MOTION HEADROOM" for the semantic model.
  const photoByIdForValidator = new Map(
    photos.map((p) => [p.id, p as Photo & { analysis_json?: Record<string, unknown> | null; suggested_motion?: string | null }]),
  );
  let prodViolationCount = 0;
  for (const scene of validScenes) {
    const p = photoByIdForValidator.get(scene.photo_id);
    if (!p) continue;
    const aj = (p.analysis_json ?? {}) as {
      motion_headroom?: Record<string, boolean>;
      suggested_motion?: string | null;
    };
    const hr = aj.motion_headroom;
    if (!hr) continue;
    const key = mapCameraMovementToHeadroomKey(scene.camera_movement);
    if (key && hr[key] === false) {
      prodViolationCount++;
      const original = scene.camera_movement;
      const suggested = (aj.suggested_motion ?? p.suggested_motion ?? null) as string | null;
      const suggestedKey = suggested ? mapCameraMovementToHeadroomKey(suggested) : null;
      const suggestedInHeadroom =
        suggested && (!suggestedKey || hr[suggestedKey] !== false);
      const replacement = (suggestedInHeadroom && suggested ? suggested : "feature_closeup") as CameraMovement;
      // Rewrite the prompt text to match the new motion verb so the SKU
      // selected for `replacement` doesn't receive a prompt naming the
      // old verb. Uses director_intent.subject as a fallback when the
      // original prompt's subject can't be regex-extracted.
      const subjectFromIntent =
        (scene.director_intent as { subject?: string } | undefined)?.subject;
      const rewrittenPrompt = rewritePromptForNewMotion(
        scene.prompt,
        replacement,
        subjectFromIntent,
      );
      await log(propertyId, "scripting", "warn",
        `DA.3 override: scene ${scene.scene_number} picked ${original} but motion_headroom.${key}=false; overriding to ${replacement}`,
        {
          scene_number: scene.scene_number,
          original,
          replacement,
          key,
          original_prompt: scene.prompt,
          rewritten_prompt: rewrittenPrompt,
        });
      scene.prompt = rewrittenPrompt;
      scene.camera_movement = replacement;
    }
  }
  if (prodViolationCount > 0) {
    await log(propertyId, "scripting", "info",
      `DA.3 validator overrode ${prodViolationCount}/${validScenes.length} scene(s) against motion_headroom`);
  }

  // C.3: Clamp per-clip duration to the preset value in case the LLM didn't
  // follow the instruction reliably. This is the code-level enforcement: the
  // director's suggested duration_seconds per scene is overridden to exactly
  // the preset's clipDuration. Applies to all scenes in the run regardless of
  // what the LLM returned in duration_seconds.
  const targetClipDuration = DURATION_PRESETS[duration].clipDuration;
  for (const scene of validScenes) {
    scene.duration_seconds = targetClipDuration;
  }

  // v1.1 audit-trail coercion — the render path forces every non-paired scene
  // to a Seedance push-in SKU; align the stored camera_movement to match so
  // the DB reflects what actually renders. Paired scenes are left untouched.
  const groundedScenes = coerceToPushInForV11(validScenes, propertyPipelineMode);

  // Phase 2.7: resolve end-frame URL for each scene before insert.
  // Build a lookup from photo id → file_url from the already-fetched
  // selected photos so we avoid extra DB round trips for the start photo.
  const photoUrlById = new Map(photos.map((p) => [p.id, p.file_url ?? null]));

  const sceneRows = await Promise.all(
    groundedScenes.map(async (s) => {
      const startPhotoUrl = photoUrlById.get(s.photo_id) ?? null;

      let endImageUrl: string | null = null;
      if (startPhotoUrl) {
        // Phase 2.7: resolve the end-frame URL for Atlas's start+end keyframe
        // interpolation. If the director paired a real photo, look it up. If
        // not, resolveEndFrameUrl falls back to a sharp crop of the start.
        const endPhotoUrl = s.end_photo_id
          ? await getPhotoUrlById(s.end_photo_id)
          : null;
        endImageUrl = await resolveEndFrameUrl({ startPhotoUrl, endPhotoUrl });
      }

      return {
        property_id: propertyId,
        photo_id: s.photo_id,
        scene_number: s.scene_number,
        camera_movement: s.camera_movement,
        prompt: s.prompt,
        duration_seconds: s.duration_seconds,
        // T4-provider-preference: write director intent to the new column (migration 084)
        // so reruns can read provider_preference without being polluted by the actual-ran
        // scenes.provider value. The old provider column initial value is still populated
        // here so poll-scenes.ts can reconstruct a provider instance even before the run
        // completes — it uses scenes.provider, not provider_preference, for that.
        provider: s.provider_preference ?? undefined,
        provider_preference: s.provider_preference ?? null,
        end_photo_id: s.end_photo_id ?? null,
        end_image_url: endImageUrl,
      };
    })
  );

  const insertedScenes = await insertScenes(sceneRows);

  // Embed each newly-inserted scene so future similarity retrieval has a
  // populated pool. Fire-and-forget per scene with per-scene error capture
  // so one failure never fails the run.
  await Promise.all(
    insertedScenes.map((s) =>
      embedScene(s.id).catch((err) => {
        void log(propertyId, "scripting", "warn", `embed scene failed: ${s.id}`, {
          error: String(err),
        });
      }),
    ),
  );

  const scriptUsage = computeClaudeCost(response.usage as never, DIRECTOR_MODEL);
  await recordCostEvent({
    propertyId,
    stage: "scripting",
    provider: "anthropic",
    unitsConsumed: scriptUsage.totalTokens,
    unitType: "tokens",
    costCents: scriptUsage.costCents,
    metadata: {
      model: DIRECTOR_MODEL,
      scene_count: validScenes.length,
      mood: output.mood,
      duration_target: duration,
      clip_duration_seconds: targetClipDuration,
      ...scriptUsage.breakdown,
    },
  });
  await log(propertyId, "scripting", "info",
    `Shot plan: ${validScenes.length} scenes, mood: ${output.mood}, duration=${duration}s, clip=${targetClipDuration}s`);
}

// ─── STAGE 4: GENERATE — SUBMIT ONLY ─────────────────────────
//
// This function ONLY submits each scene to its provider and persists
// the returned task_id. It does NOT poll, download, or assemble.
// The Vercel Cron at api/cron/poll-scenes.ts runs every minute,
// picks up scenes with a persisted provider_task_id but no clip_url,
// downloads completed clips, records costs, and finalizes the
// property when all scenes have settled.
//
// Why: with the old inline-poll design, a 12-scene run would spend
// ~95s on preflight QA + ~140s on analysis + the function would hit
// Vercel's 300s maxDuration before half the scenes were submitted.
// Splitting submit from collect makes the main function exit in
// ~30-60s regardless of clip count.

async function runGenerationSubmit(propertyId: string): Promise<void> {
  await updatePropertyStatus(propertyId, "generating");
  const scenes = await getScenesForProperty(propertyId);
  const supabase = getSupabase();

  // v1.1: load pipeline_mode once for the whole submission. Defaults to 'v1'
  // on legacy properties created before migration 062.
  const property = await getProperty(propertyId);
  const pipelineMode = property.pipeline_mode ?? "v1";

  const GENERATION_CONCURRENCY = parseInt(process.env.GENERATION_CONCURRENCY ?? "4", 10);
  await log(propertyId, "generation", "info",
    `Submitting ${scenes.length} clips, up to ${GENERATION_CONCURRENCY} in parallel${pipelineMode === "v1.1" ? " (mode=v1.1 seedance push-in)" : ""}`);

  const submitScene = async (scene: typeof scenes[number]) => {
    // Get the source photo once. Providers share the same source image,
    // so a failover retry doesn't need to refetch.
    let photo: { file_url: string; room_type: string } | null;
    try {
      const { data } = await supabase
        .from("photos")
        .select("file_url, room_type")
        .eq("id", scene.photo_id)
        .single();
      if (!data) throw new Error("Source photo not found");
      photo = data as { file_url: string; room_type: string };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateSceneStatus(scene.id, "needs_review");
      await log(propertyId, "generation", "error",
        `Scene ${scene.scene_number}: photo lookup failed: ${msg}`, undefined, scene.id);
      return;
    }

    // C.2: Do NOT base64-encode the photo here. Providers that accept URLs
    // (Kling, Atlas, Runway) use sourceImageUrl directly. The sourceImage
    // Buffer is kept as a fallback for any provider that cannot fetch a URL,
    // but none of our active providers require it — Atlas throws if it
    // receives base64 and Kling/Runway both prefer URLs.
    // Previous code: const photoResponse = await fetch(photo.file_url);
    //                const sourceImage = Buffer.from(await photoResponse.arrayBuffer());
    // Fixed (C.2): pass an empty Buffer as placeholder; all active providers
    // read sourceImageUrl instead.
    const sourceImage = Buffer.alloc(0); // placeholder — providers use sourceImageUrl
    const photoUrl = photo.file_url;     // Supabase Storage URL — providers fetch directly
    const roomType = (photo.room_type as RoomType) ?? "other";
    const cameraMovement = scene.camera_movement as CameraMovement | null;
    // T4-provider-preference: read director intent from provider_preference, not
    // scenes.provider. scenes.provider is the actual-ran audit record for poll-scenes;
    // using it for routing re-introduces the Atlas-402 → native-Kling pollution that
    // causes reruns to route to 720p instead of the director's 1080p-class intent.
    // resolveRoutingPreference is null-safe: undefined provider_preference → null.
    const preference = resolveRoutingPreference(
      scene as { provider: string | null; provider_preference?: string | null },
    ) as VideoProvider | null;

    // C.1: Build the failover sequence using the new ProviderDecision shape.
    // selectProviderForScene handles the paired-scene rule (end_photo_id set
    // → atlas + kling-v3-pro) before delegating to the movement table.
    // The decision's .fallback chain carries the next provider to try on
    // permanent errors, so we don't need to re-call the router mid-loop.
    const excluded: VideoProvider[] = [];
    const maxFailovers = Math.max(getEnabledProviders().length - 1, 1);
    let lastError: { message: string; kind: string; provider: string } | null = null;

    for (let attempt = 0; attempt <= maxFailovers; attempt++) {
      const decision = selectProviderForScene(
        {
          endPhotoId: scene.end_photo_id ?? null,
          movement: cameraMovement,
          roomType,
          preference,
        },
        excluded,
        pipelineMode,
      );
      const provider = buildProviderFromDecision(decision);
      // v1.1: when the Seedance Atlas SKU is selected, strip movement verbs
      // from the scene prompt and prepend the stable push-in directive. We do
      // NOT mutate scene.prompt in the DB — the override is render-time only
      // so the audit trail remains the human-authored prompt.
      const renderPrompt = decision.modelKey === "seedance-pro-pushin"
        ? forceSeedancePushInPrompt(scene.prompt)
        : scene.prompt;
      try {
        const genJob = await provider.generateClip({
          sourceImage,
          sourceImageUrl: photoUrl,
          prompt: renderPrompt,
          durationSeconds: scene.duration_seconds,
          aspectRatio: "16:9",
          endImageUrl: scene.end_image_url ?? undefined,
          // C.1: forward the Atlas SKU override from the decision so AtlasProvider
          // calls kling-v3-pro (or whichever model the router selected) rather
          // than the ATLAS_VIDEO_MODEL env default.
          modelOverride: decision.modelKey,
        });

        await supabase
          .from("scenes")
          .update({
            provider: provider.name,
            provider_task_id: genJob.jobId,
            submitted_at: new Date().toISOString(),
            status: "generating",
            attempt_count: attempt + 1,
          })
          .eq("id", scene.id);

        const modelNote = decision.modelKey ? ` model=${decision.modelKey}` : "";
        await log(propertyId, "generation", "info",
          `Scene ${scene.scene_number}: submitted to ${provider.name}${modelNote}${attempt > 0 ? ` (failover ${attempt})` : ""}`,
          { jobId: genJob.jobId, attempt: attempt + 1, modelKey: decision.modelKey }, scene.id);
        return;
      } catch (err) {
        const classified = classifyProviderError(err);
        lastError = { message: classified.message, kind: classified.kind, provider: provider.name };

        // Capacity + transient errors do NOT burn the provider. The
        // cron retry path will pick the scene up on the next minute.
        if (!classified.shouldFailover) {
          await log(propertyId, "generation", "warn",
            `Scene ${scene.scene_number}: ${provider.name} ${classified.kind} error (will retry via cron): ${classified.message}`,
            { status: classified.status, kind: classified.kind }, scene.id);
          break;
        }

        // Permanent error: exclude this provider and try the next decision.
        excluded.push(provider.name as VideoProvider);
        await log(propertyId, "generation", "warn",
          `Scene ${scene.scene_number}: ${provider.name} permanent error, failing over: ${classified.message}`,
          { status: classified.status, kind: classified.kind, excluded }, scene.id);
      }
    }

    // All attempts exhausted.
    await updateSceneStatus(scene.id, "needs_review");
    await log(propertyId, "generation", "error",
      `Scene ${scene.scene_number}: submit failed after ${excluded.length + 1} attempts: ${lastError?.message ?? "unknown"}`,
      { lastError }, scene.id);
  };

  // Pull-based worker pool so we don't burst past Kling's 5-concurrent
  // task limit on the provider side. Each worker does ONE submit and
  // moves on — no polling.
  const queue = [...scenes];
  const worker = async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      await submitScene(next);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(GENERATION_CONCURRENCY, scenes.length) }, () => worker()),
  );

  // Operator delivery A/B (spec 2026-06-09): when a delivery run exists,
  // submit a second independent render per scene for pairwise judging.
  // Gated read — customer flow (no run) is byte-identical. delivery_runs
  // can hold multiple rows per property (partial unique index on
  // (property_id, video_type) WHERE stage <> 'delivered'), so the gate
  // targets the most-recent ACTIVE run, never a delivered one.
  try {
    const { data: deliveryRun } = await supabase
      .from('delivery_runs')
      .select('id')
      .eq('property_id', propertyId)
      .neq('stage', 'delivered')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (deliveryRun) {
      const { submitVariantsForProperty } = await import('./delivery/variants.js');
      await submitVariantsForProperty(propertyId, deliveryRun.id as string);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log(propertyId, 'generation', 'warn', `A/B variant submission failed (non-fatal): ${msg}`);
  }

  const submittedScenes = await getScenesForProperty(propertyId);
  const submitted = submittedScenes.filter(s => s.provider_task_id).length;
  const failed = submittedScenes.filter(s => s.status === "needs_review" && !s.provider_task_id).length;
  await log(propertyId, "generation", "info",
    `Submission complete: ${submitted}/${scenes.length} submitted, ${failed} failed at submit`);
}

/**
 * resubmitScene — re-submit a single scene to a video provider, resetting its
 * provider-side state and stamping a fresh provider_task_id so the cron poller
 * picks it up and finalizes it. This is the shared core extracted from
 * `api/scenes/[id]/resubmit.ts`; the HTTP endpoint and the QC re-render loop in
 * `api/cron/poll-scenes.ts` both call it so the submit logic lives in one place.
 *
 * Mirrors `runGenerationSubmit`'s per-scene path: it loads the scene + source
 * photo, re-fetches the property's pipeline_mode (so v1.1 still routes to the
 * Seedance push-in SKU and applies `forceSeedancePushInPrompt`), runs the
 * failover loop over `selectProviderForScene`, and on the first successful
 * submit stamps `provider`, `provider_task_id`, `submitted_at`, `status:
 * 'generating'`, and bumps `attempt_count`.
 *
 * opts.promptOverride replaces the stored prompt for this render (the stored
 * scene.prompt is NOT mutated). opts.promptSuffix is appended to the effective
 * prompt — used to feed corrective judge feedback back into the render.
 * opts.providerOverride forces a specific provider preference.
 *
 * Returns { ok:false, error } on any failure (scene not found, photo missing,
 * all providers exhausted) and leaves the scene at needs_review in the
 * exhausted case — never throws, so cron callers can fall back safely.
 */
export async function resubmitScene(
  sceneId: string,
  opts: {
    promptOverride?: string;
    promptSuffix?: string;
    providerOverride?: VideoProvider;
  } = {},
): Promise<{ ok: boolean; provider?: string; jobId?: string; attempt?: number; error?: string; kind?: string; retryable?: boolean; excluded?: VideoProvider[] }> {
  const supabase = getSupabase();

  // Fetch scene — prefer the full column list including provider_preference
  // (migration 084). If the column doesn't exist yet (42703), fall back to the
  // pre-084 list; resolveRoutingPreference treats undefined provider_preference
  // as null and degrades to legacy routing so no runtime error occurs.
  const selectFull = "id, property_id, photo_id, scene_number, camera_movement, prompt, duration_seconds, attempt_count, end_photo_id, end_image_url, provider, provider_preference";
  const selectLegacy = "id, property_id, photo_id, scene_number, camera_movement, prompt, duration_seconds, attempt_count, end_photo_id, end_image_url, provider";
  let rawScene: Record<string, unknown> | null = null;
  {
    const { data, error } = await supabase
      .from("scenes")
      .select(selectFull)
      .eq("id", sceneId)
      .single();
    if (error && (error as { code?: string }).code === "42703") {
      // Migration 084 not yet applied — retry without provider_preference.
      const { data: data2, error: error2 } = await supabase
        .from("scenes")
        .select(selectLegacy)
        .eq("id", sceneId)
        .single();
      if (error2 || !data2) return { ok: false, error: "scene not found" };
      rawScene = data2 as Record<string, unknown>;
    } else if (error || !data) {
      return { ok: false, error: "scene not found" };
    } else {
      rawScene = data as Record<string, unknown>;
    }
  }
  const scene = rawScene as typeof rawScene & {
    id: string; property_id: string; photo_id: string; scene_number: number;
    camera_movement: string; prompt: string; duration_seconds: number;
    attempt_count: number; end_photo_id: string | null; end_image_url: string | null;
    provider: string | null; provider_preference?: string | null;
  };

  const { data: photo } = await supabase
    .from("photos")
    .select("file_url, room_type")
    .eq("id", scene.photo_id)
    .single();
  if (!photo) return { ok: false, error: "source photo not found" };

  // Re-fetch pipeline_mode so v1.1 routing (Seedance push-in) is honored on the
  // re-render exactly as it is on the original submission.
  let pipelineMode: PipelineMode = "v1";
  try {
    const property = await getProperty(scene.property_id);
    pipelineMode = (property.pipeline_mode as PipelineMode | undefined) ?? "v1";
  } catch {
    // Non-fatal: default to v1 routing if the property lookup hiccups.
  }

  // Effective prompt for this render: override (or stored) + optional suffix.
  // The stored scene.prompt is never mutated here — the override/suffix are
  // render-time only so the DB audit trail stays as authored.
  const basePrompt = (typeof opts.promptOverride === "string" && opts.promptOverride.trim().length > 0)
    ? opts.promptOverride.trim()
    : (scene.prompt as string);
  const effectivePrompt = (opts.promptSuffix && opts.promptSuffix.trim().length > 0)
    ? `${basePrompt}\n\n${opts.promptSuffix.trim()}`
    : basePrompt;

  // Reset provider-side state so the cron doesn't race on the stale id.
  await supabase
    .from("scenes")
    .update({
      provider_task_id: null,
      clip_url: null,
      generation_cost_cents: null,
      generation_time_ms: null,
      qc_verdict: null,
      qc_confidence: null,
      status: "pending",
    })
    .eq("id", sceneId);

  // Providers accept sourceImageUrl directly; pass an empty Buffer placeholder.
  const sourceImage = Buffer.alloc(0);
  const roomType = ((photo as { room_type?: string }).room_type as RoomType) ?? "other";
  const cameraMovement = (scene.camera_movement as CameraMovement | null) ?? null;
  // T4-provider-preference: opts.providerOverride still wins (explicit caller intent).
  // When not overriding, read director intent from provider_preference rather than
  // scenes.provider so a prior Atlas-402 → native-Kling failover doesn't permanently
  // redirect reruns to 720p native Kling. provider_preference is null-safe: if the
  // column isn't present (migration 084 not yet applied), it returns null → router decides.
  const preference = resolveRoutingPreference(
    scene as { provider: string | null; provider_preference?: string | null },
    opts.providerOverride,
  ) as VideoProvider | null;

  const excluded: VideoProvider[] = [];
  const maxFailovers = Math.max(getEnabledProviders().length - 1, 1);
  let lastError: { message: string; kind: string; provider: string } | null = null;

  for (let attempt = 0; attempt <= maxFailovers; attempt++) {
    const decision = selectProviderForScene(
      {
        endPhotoId: (scene as { end_photo_id?: string | null }).end_photo_id ?? null,
        movement: cameraMovement,
        roomType,
        preference,
      },
      excluded,
      pipelineMode,
    );
    const provider = buildProviderFromDecision(decision);
    // v1.1: when the Seedance push-in SKU is selected, normalize the prompt to a
    // stable push-in directive (render-time only, same as runGenerationSubmit).
    const renderPrompt = decision.modelKey === "seedance-pro-pushin"
      ? forceSeedancePushInPrompt(effectivePrompt)
      : effectivePrompt;
    try {
      const genJob = await provider.generateClip({
        sourceImage,
        sourceImageUrl: (photo as { file_url: string }).file_url,
        prompt: renderPrompt,
        durationSeconds: scene.duration_seconds,
        aspectRatio: "16:9",
        endImageUrl: (scene as { end_image_url?: string | null }).end_image_url ?? undefined,
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
        })
        .eq("id", sceneId);

      const modelNote = decision.modelKey ? ` model=${decision.modelKey}` : "";
      await log(scene.property_id, "generation", "info",
        `Scene ${scene.scene_number}: resubmitted to ${provider.name}${modelNote} (attempt ${nextAttemptCount}${attempt > 0 ? `, failover ${attempt}` : ""})`,
        { jobId: genJob.jobId, attempt: nextAttemptCount, modelKey: decision.modelKey }, sceneId);

      return { ok: true, provider: provider.name, jobId: genJob.jobId, attempt: nextAttemptCount };
    } catch (err) {
      const classified = classifyProviderError(err);
      lastError = { message: classified.message, kind: classified.kind, provider: provider.name };

      if (!classified.shouldFailover) {
        // Capacity/transient: leave status=pending so the cron retry path can
        // try again on a later tick.
        await log(scene.property_id, "generation", "warn",
          `Scene ${scene.scene_number}: ${provider.name} ${classified.kind} on resubmit (will retry via cron): ${classified.message}`,
          { status: classified.status, kind: classified.kind }, sceneId);
        return {
          ok: false,
          provider: provider.name,
          error: classified.message,
          kind: classified.kind,
          retryable: true,
        };
      }

      excluded.push(provider.name as VideoProvider);
      await log(scene.property_id, "generation", "warn",
        `Scene ${scene.scene_number}: ${provider.name} permanent error on resubmit, failing over: ${classified.message}`,
        { status: classified.status, kind: classified.kind, excluded, modelKey: decision.modelKey }, sceneId);
    }
  }

  // All providers exhausted — surface for review.
  await supabase
    .from("scenes")
    .update({ status: "needs_review" })
    .eq("id", sceneId);
  await log(scene.property_id, "generation", "error",
    `Scene ${scene.scene_number}: resubmit failed across ${excluded.length} provider(s): ${lastError?.message ?? "unknown"}`,
    { lastError, excluded }, sceneId);

  return {
    ok: false,
    error: lastError?.message ?? "All providers failed",
    kind: lastError?.kind ?? "unknown",
    retryable: false,
    excluded,
  };
}

async function runQCForScene(
  propertyId: string,
  sceneId: string,
  clipUrl: string,
  scene: { scene_number: number; camera_movement: string; prompt: string }
): Promise<boolean> {
  // For now, skip frame extraction (requires ffmpeg binary on Vercel).
  // Instead, we trust the generation output and do a lightweight check
  // by having the LLM evaluate based on the prompt parameters.
  // Full QC with frame extraction can be added via an external service.

  // TODO: Integrate with a frame extraction API or Vercel Sandbox for full QC
  // For launch, auto-pass all clips to get the pipeline running end-to-end.
  // The 40% rejection rate will improve as we tune prompts in Stage 3.

  const autoApprove = process.env.QC_AUTO_APPROVE_ALL === "true";
  if (autoApprove) {
    await updateSceneStatus(sceneId, "qc_pass", { qc_verdict: "auto_pass", qc_confidence: 1.0 });
    return true;
  }

  // Default: auto-pass for now (full QC phase 2)
  await updateSceneStatus(sceneId, "qc_pass", { qc_verdict: "auto_pass", qc_confidence: 1.0 });
  await log(propertyId, "qc", "info", `Scene ${scene.scene_number} auto-passed (QC phase 2 pending)`);
  return true;
}

// ─── STAGE 6: ASSEMBLY ─────────────────────────────────────────

// Internal assembly step — shared by runAssembly (pipeline path) and
// rerunAssembly (manual clip-swap path). The `reason` flag is threaded
// into cost_events metadata so the ledger can distinguish pipeline-driven
// renders from operator-triggered re-renders.
async function runAssemblyStep(
  propertyId: string,
  opts: { reason?: "pipeline" | "manual_rerun" } = {},
): Promise<void> {
  const reason = opts.reason ?? "pipeline";
  await log(propertyId, "assembly", "info", "Starting assembly");

  const property = await getProperty(propertyId);

  // Orientation gate. `selected_orientation` is 'horizontal' | 'vertical' |
  // 'both' (operator ingest defaults 'horizontal'; customer intake leaves it
  // null when only the base — horizontal — product was bought, see
  // api/properties/index.ts). Treat null/unknown as 'horizontal' so we never
  // render — and bill (cost_events) — a 9:16 the customer didn't order; 'both'
  // is the only value that adds the vertical render. The prod incident on
  // property 0cdb242c rendered both for a 'horizontal' order because this gate
  // didn't exist; the vertical render additionally still respects skipVertical
  // (missing 9:16 template) below.
  const orientation =
    property.selected_orientation === "vertical" || property.selected_orientation === "both"
      ? property.selected_orientation
      : "horizontal";
  const wantHorizontal = orientation !== "vertical";
  const wantVertical = orientation === "vertical" || orientation === "both";

  const scenes = await getScenesForProperty(propertyId);
  const qcPassed = scenes.filter((s) => s.status === "qc_pass" && s.clip_url);

  if (qcPassed.length === 0) {
    await updatePropertyStatus(propertyId, "failed");
    await log(propertyId, "assembly", "error", "No clips available for assembly");
    return;
  }

  // Hydrate room_type from photos so the assembly walker can group by room.
  // One round-trip; scoped to the qc-passed set so we don't pull every photo.
  const photoIds = Array.from(new Set(qcPassed.map((s) => s.photo_id)));
  const { data: photoRows, error: photoErr } = await getSupabase()
    .from("photos")
    .select("id, room_type")
    .in("id", photoIds);
  if (photoErr) {
    await log(propertyId, "assembly", "warn",
      `Photo room_type lookup failed (${photoErr.message}); using director scene_number order`);
  }
  const roomTypeByPhotoId = new Map<string, RoomType | null>(
    (photoRows ?? []).map((p) => [p.id as string, (p.room_type as RoomType | null) ?? null]),
  );

  // Deterministic walkthrough order: aerial/exterior_front → living spaces
  // → bedrooms → bathrooms → outdoor → exterior_back. See
  // lib/assembly/scene-ordering.ts for the full policy.
  const passedScenes = orderScenesForAssembly(
    qcPassed.map((s) => ({
      ...s,
      room_type: roomTypeByPhotoId.get(s.photo_id) ?? null,
    })),
  );
  await log(propertyId, "assembly", "info",
    `Ordered ${passedScenes.length} scenes for walkthrough`,
    { order: passedScenes.map((s) => ({ scene_number: s.scene_number, room_type: s.room_type })) });

  // Operator delivery: honor the operator's checkpoint-A clip order when a
  // delivery run with an explicit scene_order exists. Customer flow (no run)
  // keeps the deterministic walkthrough order above, byte-identical.
  // delivery_runs can hold multiple rows per property (partial unique index
  // excludes 'delivered'), so prefer the most-recent active run.
  let orderedScenes = passedScenes;
  try {
    // Prefer the most-recent ACTIVE (non-delivered) run — the one currently
    // moving through checkpoints. But a clip-swap rerun
    // (lib/operator-studio/clip-swap.ts) can fire AFTER delivery, when the only
    // run for the property is stage='delivered'; without the fallback below the
    // `.neq('stage','delivered')` filter would miss it and assembly would drop
    // the operator's curated checkpoint-A order back to the default walkthrough.
    // So: active run if present, else the latest run regardless of stage.
    const db = getSupabase();
    let deliveryRun: { scene_order: string[] | null } | null = null;
    const { data: activeRun } = await db
      .from("delivery_runs")
      .select("scene_order")
      .eq("property_id", propertyId)
      .neq("stage", "delivered")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const activeRunTyped = (activeRun as { scene_order: string[] | null } | null) ?? null;
    // Use the active run only when it has a non-empty scene_order.
    // If the active run exists but scene_order is null/empty (operator hasn't
    // reordered yet on this run), fall through to the any-run lookup which
    // will pick the most recent run that DOES have a curated order.
    if (activeRunTyped?.scene_order && activeRunTyped.scene_order.length > 0) {
      deliveryRun = activeRunTyped;
    }
    if (!deliveryRun) {
      // Find the most recent run (any stage) that has a non-empty scene_order.
      const { data: runs } = await db
        .from("delivery_runs")
        .select("scene_order")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(20);
      const orderedRuns = (runs as Array<{ scene_order: string[] | null }> | null) ?? [];
      const withOrder = orderedRuns.find(
        (r) => r.scene_order && r.scene_order.length > 0,
      );
      deliveryRun = withOrder ?? null;
    }
    const order = (deliveryRun?.scene_order as string[] | null) ?? null;
    if (order && order.length > 0) {
      const { applySceneOrder } = await import("./delivery/assemble.js");
      // passedScenes carry `id` + `scene_number`; pass both so applySceneOrder's
      // deterministic tie-break (scene_number) engages for any scene missing
      // from the saved order.
      orderedScenes = applySceneOrder(
        passedScenes as Array<{ id: string; scene_number: number }>,
        order,
      ) as typeof passedScenes;
      await log(propertyId, "assembly", "info", "Using operator delivery scene order", { order });
    }
  } catch { /* gated read — never fails customer assembly */ }

  const totalProcessingMsBase = Date.now() - new Date(property.created_at).getTime();

  let horizontalUrl: string | null = null;
  let verticalUrl: string | null = null;
  let assemblyErrored = false;

  // Use the assembly router to select the best provider.
  // Priority: Creatomate (if CREATOMATE_API_KEY set) > Shotstack > skip.
  let assemblyEnabled = false;
  try {
    // Quick check — don't construct the provider yet, just see if any key exists.
    assemblyEnabled = Boolean(
      process.env.CREATOMATE_API_KEY ||
      process.env.SHOTSTACK_API_KEY ||
      process.env.SHOTSTACK_API_KEY_STAGE,
    );
  } catch {
    // swallow
  }

  if (assemblyEnabled) {
    try {
      const { selectAssemblyProvider, pollAssemblyJob, assemblyProviderCostCents } = await import(
        "./providers/assembly-router.js"
      );
      const { assembleSuperSampleFactor } = await import("./providers/creatomate.js");
      const provider = selectAssemblyProvider();
      const providerName = provider.name;

      // Apply the package-tier duration budget. `selected_duration` is
      // persisted via migration 054 (15 / 30 / 60); a null on a legacy row
      // means "use the natural sum of source clip durations".
      const targetDuration =
        typeof property.selected_duration === "number"
          ? property.selected_duration
          : null;
      const fitted = fitScenesToDuration(
        orderedScenes.map((s) => ({
          ...s,
          durationSeconds: s.duration_seconds,
        })),
        targetDuration,
      );
      await log(propertyId, "assembly", "info",
        `Duration fit: ${fitted.length} clips for ${targetDuration ?? "natural"}s target`,
        {
          target: targetDuration,
          allocations: fitted.map((f) => ({
            scene_number: f.scene.scene_number,
            room_type: f.scene.room_type,
            seconds: Number(f.durationSeconds.toFixed(2)),
          })),
        });

      const clipInputs = fitted.map((f) => ({
        url: f.scene.clip_url as string,
        durationSeconds: f.durationSeconds,
      }));

      // Pull brokerage branding (logo + colors) from user_profiles.
      // Falls back to property.brokerage text + defaults if no profile.
      const branding = await fetchPropertyBranding(propertyId);
      const overlays = {
        address: property.address,
        price: formatPrice(property.price),
        details: `${property.bedrooms} BD | ${formatBaths(property.bathrooms)} BA`,
        agent: property.listing_agent,
        brokerage: branding.brokerageName ?? property.brokerage ?? null,
        logoUrl: branding.logoUrl,
        primaryColor: branding.primaryColor,
        secondaryColor: branding.secondaryColor,
      };
      if (branding.logoUrl) {
        await log(propertyId, "assembly", "info",
          `Brokerage logo + brand color (${branding.primaryColor}) applied`);
      }

      // Voiceover auto-trigger — when the customer bought the AI-voiceover
      // add-on (add_voiceover) but no narration was pre-generated in the form,
      // generate it now so the paid add-on actually produces audio. Best-effort:
      // a failure proceeds without narration rather than failing the render.
      const { ensureVoiceover } = await import("./voiceover/ensure-voiceover.js");
      const voiceoverResult = await ensureVoiceover(
        property as unknown as Parameters<typeof ensureVoiceover>[0],
        (level, msg) => log(propertyId, "assembly", level, msg),
      );
      const voiceoverUrl = voiceoverResult.voiceoverUrl;

      // Music track — operator-pinned wins, else auto-pick by package mood.
      const musicTrack = await selectMusicTrackForProperty(propertyId);
      const music = musicTrack ? { url: musicTrack.fileUrl } : null;
      if (musicTrack) {
        await log(propertyId, "assembly", "info",
          `Music: ${musicTrack.name} (${musicTrack.moodTag})`,
          { music_track_id: musicTrack.id });
      } else {
        await log(propertyId, "assembly", "info",
          "No active music track in library — rendering silent video");
      }

      // Resolve which Creatomate template(s) should drive this render.
      // We look up horizontal and vertical separately because each aspect
      // ratio needs its own template (Creatomate ignores width/height when
      // rendering from a template). When no vertical template exists, the
      // pipeline skips the 9:16 render entirely rather than producing a
      // wrong-aspect file. Priority chain: see lib/assembly/template-resolver.
      const overrideTemplateId =
        (property as { template_id?: string | null }).template_id ?? null;
      const horizontalTemplateId = providerName === "creatomate"
        ? resolveTemplateId({
            propertyTemplateId: overrideTemplateId,
            selectedPackage: property.selected_package,
            selectedDuration: property.selected_duration ?? null,
            aspectRatio: "16:9",
          })
        : null;
      const verticalTemplateId = providerName === "creatomate"
        ? resolveTemplateId({
            propertyTemplateId: overrideTemplateId,
            selectedPackage: property.selected_package,
            selectedDuration: property.selected_duration ?? null,
            aspectRatio: "9:16",
          })
        : null;

      if (horizontalTemplateId) {
        await log(propertyId, "assembly", "info",
          `Using Creatomate template ${horizontalTemplateId} (16:9)`,
          { templateId: horizontalTemplateId, aspect: "16:9", selected_package: property.selected_package });
      }
      if (verticalTemplateId) {
        await log(propertyId, "assembly", "info",
          `Using Creatomate template ${verticalTemplateId} (9:16)`,
          { templateId: verticalTemplateId, aspect: "9:16", selected_package: property.selected_package });
      } else if (horizontalTemplateId) {
        await log(propertyId, "assembly", "info",
          "No vertical Creatomate template configured — skipping 9:16 render",
          { selected_package: property.selected_package });
      }

      // Template-path flag: any template render uses the modifications dict.
      const templateId = horizontalTemplateId;

      await log(propertyId, "assembly", "info",
        `Submitting ${providerName} render (${clipInputs.length} clips)`,
        { clipCount: clipInputs.length, provider: providerName, templateId },
      );

      // Common modifications shared across 16:9 + 9:16 renders. Template
      // ignores any keys for placeholders it doesn't have, so we always send
      // the full set (text + clips + logo + music).
      // Just Listed #01 (2026-05-14 rev) has 8 clip slots. Cap inputs so
      // we never silently drop modifications for slots that don't exist.
      // The duration-fit pass usually already keeps us at ≤8; this is
      // defense-in-depth.
      const templateClipInputs = clipInputs.slice(0, 8);

      // Operator-flow client lookup, fetched BEFORE buildTemplateModifications
      // so the per-client ", Realtor" display-name toggle can suffix the agent
      // name on the keys the brand-kit merge doesn't own (Listing-Agent-Mid /
      // Listing-Agent-Final). Customer flow (client_id null) never fetches and
      // its modifications stay byte-identical.
      let operatorClient: ClientRow | null = null;
      if (templateId && property.client_id) {
        const { data: clientRow } = await getSupabase()
          .from('clients')
          .select('*')
          .eq('id', property.client_id)
          .maybeSingle();
        operatorClient = (clientRow as ClientRow | null) ?? null;
      }

      let templateMods = templateId
        ? buildTemplateModifications({
            address: property.address,
            selectedPackage: property.selected_package,
            agentName:
              applyRealtorSuffix(property.listing_agent, operatorClient?.realtor_suffix)
              ?? property.listing_agent,
            brokerageName: branding.brokerageName ?? property.brokerage ?? null,
            agentPhone: branding.phone,
            clips: templateClipInputs,
            musicUrl: musicTrack?.fileUrl,
            voiceoverUrl,
          })
        : null;

      // Operator-flow brand injection: when a property belongs to a client,
      // merge the client's brand kit (Brand.* keys) into the modifications
      // payload. No-op when client_id is null (customer flow) or when brand
      // fields are unpopulated. Creatomate silently ignores keys for
      // placeholders that don't exist in the template — the template must have
      // Brand.* variables added in the Creatomate dashboard for the values to
      // render visibly. See docs/specs/2026-05-15-operator-studio-design.md.
      if (templateMods && operatorClient) {
        const brand = brandKitFromClient(
          operatorClient,
          { brokerage: property.brokerage ?? null },
        );
        templateMods = mergeBrandVars(templateMods, brand);
        await log(propertyId, "assembly", "info",
          `Brand kit injected for client ${property.client_id}`,
          {
            client_id: property.client_id,
            has_logo: brand.logo_url != null,
            has_primary: brand.primary_hex != null,
            has_agent_headshot: brand.agent_headshot_url != null,
          });
      }

      const assembleParams = {
        clips: clipInputs,
        overlays,
        music,
        voiceover: voiceoverUrl ? { url: voiceoverUrl } : null,
      };

      const timelineDurationSeconds = clipInputs.reduce(
        (sum, c) => sum + c.durationSeconds,
        0,
      );

      // Render the ordered aspect ratios sequentially (each ~30–90s; kept
      // sequential to stay under the 300s function budget). Template path uses
      // assembleFromTemplate; code-generated path uses assemble(). Each format
      // is gated on `selected_orientation` (wantHorizontal / wantVertical) so a
      // single-orientation order renders — and costs — only what was bought.
      let horizontalRenderMs: number | null = null;
      if (wantHorizontal) {
        const horizontalJob = horizontalTemplateId && templateMods && provider.name === "creatomate"
          ? await (provider as InstanceType<typeof import("./providers/creatomate.js").CreatomateProvider>).assembleFromTemplate(horizontalTemplateId, {
              modifications: templateMods,
              // Template canvas is designed for the target AR; renderScale upscales it
              // by ASSEMBLY_SUPERSAMPLE (default 1.5) for higher bitrate output.
              // Rollback: ASSEMBLY_SUPERSAMPLE=1 → renderScale=1 (native canvas).
              renderScale: assembleSuperSampleFactor(),
            })
          : await provider.assemble({
              ...assembleParams,
              aspectRatio: "16:9",
            });
        await log(propertyId, "assembly", "info",
          `${providerName} horizontal job queued: ${horizontalJob.jobId}`);
        const horizontalResult = await pollAssemblyJob(provider, horizontalJob);
        if (horizontalResult.status !== "complete" || !horizontalResult.videoUrl) {
          throw new Error(`Horizontal render failed: ${horizontalResult.error ?? "unknown"}`);
        }
        horizontalRenderMs = horizontalResult.renderTimeMs ?? null;

        const horizontalDuration =
          horizontalResult.durationSeconds ?? timelineDurationSeconds;

        // Finalize: mirror the render to Supabase Storage for long-term
        // retention (provider URLs have undocumented TTLs). Also computes
        // delivered_bitrate_kbps from file size — no ffprobe needed.
        // Falls back to providerUrl on any error (HITL-free).
        // Disable with LE_ASSEMBLY_FINALIZE=off.
        const { finalizeAssemblyRender } = await import("./assembly/finalize.js");
        const hFinalize = await finalizeAssemblyRender({
          propertyId,
          aspectRatio: "16:9",
          providerUrl: horizontalResult.videoUrl,
          durationSeconds: horizontalDuration,
          version: 1,
          supabase: getSupabase(),
        });
        horizontalUrl = hFinalize.url;
        await log(propertyId, "assembly", "info",
          `Horizontal finalize: bitrate=${hFinalize.bitrateKbps ?? "n/a"} kbps, bytes=${hFinalize.outputBytes ?? "n/a"}`,
          { delivered_bitrate_kbps: hFinalize.bitrateKbps, output_bytes: hFinalize.outputBytes, url: hFinalize.url });

        const horizontalCents = assemblyProviderCostCents(providerName, horizontalDuration, "16:9");
        await recordCostEvent({
          propertyId,
          stage: "assembly",
          provider: providerName as Parameters<typeof recordCostEvent>[0]["provider"],
          unitsConsumed: 1,
          unitType: "renders",
          costCents: horizontalCents,
          metadata: {
            aspect_ratio: "16:9",
            clip_count: clipInputs.length,
            output_duration_seconds: horizontalDuration,
            render_time_ms: horizontalResult.renderTimeMs ?? null,
            job_id: horizontalJob.jobId,
            reason,
            delivered_bitrate_kbps: hFinalize.bitrateKbps,
            output_bytes: hFinalize.outputBytes,
          },
        });
      } else {
        await log(propertyId, "assembly", "info",
          "selected_orientation=vertical — skipping 16:9 render");
      }

      // Vertical render — same template-vs-codegen branch as horizontal.
      // Gated first on the order's orientation (wantVertical: 'vertical' or
      // 'both'). When the template path is active but no vertical template is
      // configured, skipVertical additionally suppresses the 9:16 render so we
      // never produce a wrong-aspect file. In either skip case the DB column
      // `vertical_video_url` stays null and the UI's `&&` guard handles it.
      const skipVertical =
        horizontalTemplateId !== null &&
        verticalTemplateId === null &&
        provider.name === "creatomate";

      if (!wantVertical) {
        await log(propertyId, "assembly", "info",
          `selected_orientation=${orientation} — skipping 9:16 render`);
      } else if (!skipVertical) {
        const verticalJob = verticalTemplateId && templateMods && provider.name === "creatomate"
          ? await (provider as InstanceType<typeof import("./providers/creatomate.js").CreatomateProvider>).assembleFromTemplate(verticalTemplateId, {
              modifications: templateMods,
              // Vertical (9:16) is NOT supersampled — template canvas renders at native
              // 1080x1920. Supersample only applies to horizontal (16:9) builds.
              // This aligns cost model (creatomateCostCents factor=1 for 9:16), concat
              // builder (emits 1080x1920), and test assertions in
              // creatomate-supersample.test.ts ("vertical is NOT supersampled").
              // Rollback: this line only; horizontal rollback is ASSEMBLY_SUPERSAMPLE=1.
              renderScale: 1,
            })
          : await provider.assemble({
              ...assembleParams,
              aspectRatio: "9:16",
            });
        await log(propertyId, "assembly", "info",
          `${providerName} vertical job queued: ${verticalJob.jobId}`);
        const verticalResult = await pollAssemblyJob(provider, verticalJob);
        if (verticalResult.status !== "complete" || !verticalResult.videoUrl) {
          throw new Error(`Vertical render failed: ${verticalResult.error ?? "unknown"}`);
        }
        const verticalDuration =
          verticalResult.durationSeconds ?? timelineDurationSeconds;

        // Finalize: mirror the 9:16 render to Supabase Storage.
        // Same fallback and kill-switch semantics as the horizontal render above.
        const { finalizeAssemblyRender: finalizeV } = await import("./assembly/finalize.js");
        const vFinalize = await finalizeV({
          propertyId,
          aspectRatio: "9:16",
          providerUrl: verticalResult.videoUrl,
          durationSeconds: verticalDuration,
          version: 1,
          supabase: getSupabase(),
        });
        verticalUrl = vFinalize.url;
        await log(propertyId, "assembly", "info",
          `Vertical finalize: bitrate=${vFinalize.bitrateKbps ?? "n/a"} kbps, bytes=${vFinalize.outputBytes ?? "n/a"}`,
          { delivered_bitrate_kbps: vFinalize.bitrateKbps, output_bytes: vFinalize.outputBytes, url: vFinalize.url });

        const verticalCents = assemblyProviderCostCents(providerName, verticalDuration, "9:16");
        await recordCostEvent({
          propertyId,
          stage: "assembly",
          provider: providerName as Parameters<typeof recordCostEvent>[0]["provider"],
          unitsConsumed: 1,
          unitType: "renders",
          costCents: verticalCents,
          metadata: {
            aspect_ratio: "9:16",
            clip_count: clipInputs.length,
            output_duration_seconds: verticalDuration,
            render_time_ms: verticalResult.renderTimeMs ?? null,
            job_id: verticalJob.jobId,
            reason,
            delivered_bitrate_kbps: vFinalize.bitrateKbps,
            output_bytes: vFinalize.outputBytes,
          },
        });
      }

      // Persist the assembly timeline JSON for future revision editing.
      // We store the horizontal timeline since it's the primary deliverable.
      try {
        const timelineJson = {
          clips: clipInputs,
          overlays,
          transition: "fade",
          provider: providerName,
          rendered_at: new Date().toISOString(),
        };
        await getSupabase()
          .from("properties")
          .update({
            assembly_timeline: timelineJson,
            assembly_timeline_version: 1,
            assembly_provider: providerName,
          })
          .eq("id", propertyId);
      } catch (timelineErr) {
        // Non-fatal — timeline persistence is for the revision engine,
        // not for the current delivery.
        const msg = timelineErr instanceof Error ? timelineErr.message : String(timelineErr);
        await log(propertyId, "assembly", "warn",
          `Failed to persist assembly_timeline: ${msg}`);
      }

      await log(propertyId, "assembly", "info",
        `${providerName} renders complete`,
        {
          horizontalUrl,
          verticalUrl,
          horizontalRenderMs,
          // verticalRenderMs intentionally omitted: verticalResult is scoped
          // to the vertical-render branch above. Touching it from here would
          // ReferenceError at runtime and TS2552 at build time.
        },
      );
    } catch (err) {
      assemblyErrored = true;
      const msg = err instanceof Error ? err.message : String(err);
      await log(propertyId, "assembly", "warn",
        `Assembly failed, falling back to clip-only delivery: ${msg}`,
      );
    }
  } else {
    await log(propertyId, "assembly", "info",
      "No assembly provider configured — delivering clips only",
    );
  }

  const thumbnailUrl = orderedScenes[0]?.clip_url ?? null;
  // Measure THIS RUN, not the property's original creation date.
  // pipeline_started_at is stamped at the top of runPipeline; fall back to
  // created_at only for legacy rows. Clamp to int4 max so weeks-old
  // properties (e.g. smoke tests on stale data) don't overflow the column.
  const startRef = (property as { pipeline_started_at?: string | null }).pipeline_started_at
    ?? property.created_at;
  const totalProcessingMs = Math.min(
    Date.now() - new Date(startRef).getTime(),
    2_147_483_647,
  );

  await updatePropertyStatus(propertyId, "complete", {
    thumbnail_url: thumbnailUrl,
    processing_time_ms: totalProcessingMs,
    ...(horizontalUrl ? { horizontal_video_url: horizontalUrl } : {}),
    ...(verticalUrl ? { vertical_video_url: verticalUrl } : {}),
  });

  // A single-orientation order intentionally produces just one URL, so the
  // "stitched" note keys off "got every render we asked for", not "got both".
  const gotRequestedRenders =
    (!wantHorizontal || horizontalUrl !== null) &&
    (!wantVertical || verticalUrl !== null);
  const assemblyNote = (horizontalUrl || verticalUrl) && gotRequestedRenders
    ? "Stitched video delivered"
    : assemblyErrored
    ? "Assembly failed, delivered individual clips as fallback"
    : "Delivered individual clips (no assembly provider configured)";

  await log(propertyId, "assembly", "info",
    `Complete! ${orderedScenes.length} clips in ${(totalProcessingMs / 1000).toFixed(1)}s. Total cost: $${((property.total_cost_cents) / 100).toFixed(2)}. ${assemblyNote}`,
    {
      clipCount: orderedScenes.length,
      totalProcessingMs,
      totalCostCents: property.total_cost_cents,
      horizontalUrl,
      verticalUrl,
    },
  );
  // Silence unused baseline var (kept for potential future delta logging)
  void totalProcessingMsBase;
}

// ─── PUBLIC ASSEMBLY WRAPPERS ──────────────────────────────────

/**
 * Called by the poll-scenes cron when all scenes have settled. Sets
 * `assembling` status then delegates to runAssemblyStep.
 */
export async function runAssembly(propertyId: string): Promise<void> {
  await updatePropertyStatus(propertyId, "assembling");
  await runAssemblyStep(propertyId, { reason: "pipeline" });
}

/**
 * Re-run ONLY the assembly stage for a property whose clips are already
 * on disk (e.g. after a clip swap). Guards against triggering mid-pipeline
 * or when no completed scenes exist.
 */
export async function rerunAssembly(propertyId: string): Promise<void> {
  const { data: property } = await getSupabase()
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .maybeSingle();

  if (!property) {
    throw new Error(`Property not found: ${propertyId}`);
  }

  const midPipelineStatuses = ["queued", "analyzing", "scripting", "generating", "qc"];
  if (midPipelineStatuses.includes(property.status as string)) {
    throw new Error(
      `Cannot rerun assembly while pipeline is in ${property.status as string}`,
    );
  }

  // Verify at least one completed (qc_pass) scene with a clip URL exists.
  const scenes = await getScenesForProperty(propertyId);
  const completedScenes = scenes.filter(
    (s) => s.status === "qc_pass" && s.clip_url,
  );
  if (completedScenes.length === 0) {
    throw new Error("No completed scenes — nothing to assemble");
  }

  await updatePropertyStatus(propertyId, "assembling");
  await log(propertyId, "assembly", "info", "rerunAssembly: manual rerun triggered");
  await runAssemblyStep(propertyId, { reason: "manual_rerun" });
}

function formatPrice(price: number): string {
  return `$${price.toLocaleString("en-US")}`;
}

function formatBaths(baths: number): string {
  return Number.isInteger(baths) ? String(baths) : baths.toFixed(1);
}
