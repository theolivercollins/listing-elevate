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
import type { Photo, RoomType, DepthRating, VideoProvider, CameraMovement } from "./types.js";
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
import { selectProviderForScene, buildProviderFromDecision, getEnabledProviders } from "./providers/router.js";
import { pollUntilComplete } from "./providers/provider.interface.js";
import { classifyProviderError } from "./providers/errors.js";
import { orderScenesForAssembly } from "./assembly/scene-ordering.js";
import { fitScenesToDuration } from "./assembly/duration-fit.js";
import { fetchPropertyBranding } from "./assembly/branding.js";
import { selectMusicTrackForProperty } from "./assembly/music.js";
import { resolveTemplateId } from "./assembly/template-resolver.js";
import { buildTemplateModifications } from "./assembly/template-modifications.js";
import { brandKitFromClient, mergeBrandVars } from "./operator-studio/brand-kit.js";
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
  let learningBlock = "";
  try {
    const bundles = await Promise.all(
      photoData.map((p) =>
        fetchPerPhotoRetrievalBundle({
          photoId: p.id,
          roomType: p.room_type,
          motionHeadroom: p.motion_headroom ?? null,
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

  // Phase 2.7: resolve end-frame URL for each scene before insert.
  // Build a lookup from photo id → file_url from the already-fetched
  // selected photos so we avoid extra DB round trips for the start photo.
  const photoUrlById = new Map(photos.map((p) => [p.id, p.file_url ?? null]));

  const sceneRows = await Promise.all(
    validScenes.map(async (s) => {
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
        provider: s.provider_preference ?? undefined,
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

  const GENERATION_CONCURRENCY = parseInt(process.env.GENERATION_CONCURRENCY ?? "4", 10);
  await log(propertyId, "generation", "info",
    `Submitting ${scenes.length} clips, up to ${GENERATION_CONCURRENCY} in parallel`);

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
    const preference = scene.provider as VideoProvider | null;

    // C.1: Build the failover sequence using the new ProviderDecision shape.
    // selectProviderForScene handles the paired-scene rule (end_photo_id set
    // → atlas + kling-v2-1-pair) before delegating to the movement table.
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
      );
      const provider = buildProviderFromDecision(decision);
      try {
        const genJob = await provider.generateClip({
          sourceImage,
          sourceImageUrl: photoUrl,
          prompt: scene.prompt,
          durationSeconds: scene.duration_seconds,
          aspectRatio: "16:9",
          endImageUrl: scene.end_image_url ?? undefined,
          // C.1: forward the Atlas SKU override from the decision so AtlasProvider
          // calls kling-v2-1-pair (or whichever model the router selected) rather
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

  const submittedScenes = await getScenesForProperty(propertyId);
  const submitted = submittedScenes.filter(s => s.provider_task_id).length;
  const failed = submittedScenes.filter(s => s.status === "needs_review" && !s.provider_task_id).length;
  await log(propertyId, "generation", "info",
    `Submission complete: ${submitted}/${scenes.length} submitted, ${failed} failed at submit`);
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
        passedScenes.map((s) => ({
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
      let templateMods = templateId
        ? buildTemplateModifications({
            address: property.address,
            selectedPackage: property.selected_package,
            agentName: property.listing_agent,
            brokerageName: branding.brokerageName ?? property.brokerage ?? null,
            clips: templateClipInputs,
            musicUrl: musicTrack?.fileUrl,
            voiceoverUrl: (property as Record<string, unknown>).voiceover_url as string | null | undefined,
          })
        : null;

      // Operator-flow brand injection: when a property belongs to a client,
      // fetch the client's brand kit and merge Brand.* keys into the
      // modifications payload. No-op when client_id is null (customer flow)
      // or when brand fields are unpopulated. Creatomate silently ignores
      // keys for placeholders that don't exist in the template — the template
      // must have Brand.* variables added in the Creatomate dashboard for the
      // values to render visibly. See docs/specs/2026-05-15-operator-studio-design.md.
      if (templateMods && property.client_id) {
        const { data: clientRow } = await getSupabase()
          .from('clients')
          .select('*')
          .eq('id', property.client_id)
          .maybeSingle();
        if (clientRow) {
          const brand = brandKitFromClient(
            clientRow as ClientRow,
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
      }

      const assembleParams = { clips: clipInputs, overlays, music };

      // Render both aspect ratios sequentially. Each render typically takes
      // 30–90s. Kept sequential to stay under the 300s function budget.
      // Template path uses assembleFromTemplate; code-generated path uses assemble().
      const horizontalJob = horizontalTemplateId && templateMods && provider.name === "creatomate"
        ? await (provider as InstanceType<typeof import("./providers/creatomate.js").CreatomateProvider>).assembleFromTemplate(horizontalTemplateId, {
            modifications: templateMods,
            renderScale: 1,
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
      horizontalUrl = horizontalResult.videoUrl;

      const timelineDurationSeconds = clipInputs.reduce(
        (sum, c) => sum + c.durationSeconds,
        0,
      );
      const horizontalDuration =
        horizontalResult.durationSeconds ?? timelineDurationSeconds;
      const horizontalCents = assemblyProviderCostCents(providerName, horizontalDuration);
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
        },
      });

      // Vertical render — same template-vs-codegen branch as horizontal.
      // When the template path is active but no vertical template is
      // configured (current state: we aren't offering vertical yet), skip
      // the 9:16 render entirely. The DB column `vertical_video_url` will
      // stay null and the UI's `&&` guard handles that gracefully.
      const skipVertical =
        horizontalTemplateId !== null &&
        verticalTemplateId === null &&
        provider.name === "creatomate";

      if (!skipVertical) {
        const verticalJob = verticalTemplateId && templateMods && provider.name === "creatomate"
          ? await (provider as InstanceType<typeof import("./providers/creatomate.js").CreatomateProvider>).assembleFromTemplate(verticalTemplateId, {
              modifications: templateMods,
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
        verticalUrl = verticalResult.videoUrl;

        const verticalDuration =
          verticalResult.durationSeconds ?? timelineDurationSeconds;
        const verticalCents = assemblyProviderCostCents(providerName, verticalDuration);
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
          horizontalRenderMs: horizontalResult.renderTimeMs,
          verticalRenderMs: verticalResult.renderTimeMs,
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

  const thumbnailUrl = passedScenes[0]?.clip_url ?? null;
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

  const assemblyNote = horizontalUrl && verticalUrl
    ? "Stitched video delivered"
    : assemblyErrored
    ? "Assembly failed, delivered individual clips as fallback"
    : "Delivered individual clips (no assembly provider configured)";

  await log(propertyId, "assembly", "info",
    `Complete! ${passedScenes.length} clips in ${(totalProcessingMs / 1000).toFixed(1)}s. Total cost: $${((property.total_cost_cents) / 100).toFixed(2)}. ${assemblyNote}`,
    {
      clipCount: passedScenes.length,
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
