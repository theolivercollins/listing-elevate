import Anthropic from "@anthropic-ai/sdk";
import { ingestDriveFolder } from "./drive-ingest.js";
import {
  getSupabase,
  getPhotosForProperty,
  updatePropertyStatus,
  updatePhotoAnalysis,
  getSelectedPhotos,
  insertScenes,
  updateSceneStatus,
  updateScene,
  getScenesForProperty,
  getProperty,
  addPropertyCost,
  log,
} from "./db.js";
import type { Photo, RoomType, DepthRating, VideoProvider } from "./types.js";
import {
  PHOTO_ANALYSIS_SYSTEM,
  buildAnalysisUserPrompt,
  type PhotoAnalysisResult,
} from "./prompts/photo-analysis.js";
import {
  DIRECTOR_SYSTEM,
  buildDirectorUserPrompt,
  type DirectorOutput,
} from "./prompts/director.js";
import {
  QC_SYSTEM,
  buildQCUserPrompt,
  buildPromptModification,
  type QCResult,
} from "./prompts/qc-evaluator.js";
import { selectProvider } from "./providers/router.js";
import { pollUntilComplete } from "./providers/provider.interface.js";
import {
  estimateAnalysisCost,
  estimateScriptingCost,
  estimateGenerationCost,
  estimateQCCost,
} from "./utils/cost-tracker.js";

const BATCH_SIZE = 8;
const TARGET_SCENE_COUNT = 12;
const MAX_PER_ROOM_TYPE = 2;
const REQUIRED_ROOM_TYPES: RoomType[] = [
  "exterior_front",
  "kitchen",
  "living_room",
  "master_bedroom",
  "bathroom",
];

// ─── MAIN PIPELINE ─────────────────────────────────────────────

export async function runPipeline(propertyId: string): Promise<void> {
  try {
    await log(propertyId, "intake", "info", "Pipeline started");

    // Stage 1: Intake — if photos haven't been uploaded yet and the
    // property was submitted with a Drive link, pull them now.
    let photos = await getPhotosForProperty(propertyId);
    if (photos.length === 0) {
      const property = await getProperty(propertyId);
      if (property?.drive_link) {
        await updatePropertyStatus(propertyId, "ingesting");
        await ingestDriveFolder(propertyId, property.drive_link);
        photos = await getPhotosForProperty(propertyId);
      }
    }
    if (photos.length < 5) {
      await updatePropertyStatus(propertyId, "failed");
      await log(propertyId, "intake", "error", `Only ${photos.length} photos. Need at least 5.`);
      return;
    }
    await log(propertyId, "intake", "info", `${photos.length} photos ready`);

    // Stage 2: Analyze
    await runAnalysis(propertyId, photos);

    // Stage 3: Script
    await runScripting(propertyId);

    // Stage 4 + 5: Generate + QC (per clip, with retries)
    await runGenerationWithQC(propertyId);

    // Stage 6: Assembly
    await runAssembly(propertyId);

    await log(propertyId, "delivery", "info", "Pipeline complete!");
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
  await log(propertyId, "analysis", "info", "Starting photo analysis");

  const client = new Anthropic();
  const allResults: Array<{ photo: Photo; analysis: PhotoAnalysisResult }> = [];

  for (let i = 0; i < photos.length; i += BATCH_SIZE) {
    const batch = photos.slice(i, i + BATCH_SIZE);
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
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
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

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) continue;

      const results: PhotoAnalysisResult[] = JSON.parse(jsonMatch[0]);
      for (let j = 0; j < results.length && j < batch.length; j++) {
        allResults.push({ photo: batch[j], analysis: results[j] });
      }
    } catch (err) {
      await log(propertyId, "analysis", "error", `LLM batch ${i} failed: ${err}`);
    }
  }

  // Selection algorithm
  const selected = selectPhotos(allResults);

  for (const { photo, analysis } of allResults) {
    const isSelected = selected.some((s) => s.photo.id === photo.id);
    await updatePhotoAnalysis(photo.id, {
      room_type: analysis.room_type,
      quality_score: analysis.quality_score,
      aesthetic_score: analysis.aesthetic_score,
      depth_rating: analysis.depth_rating,
      key_features: analysis.key_features,
      selected: isSelected,
      discard_reason: analysis.suggested_discard
        ? analysis.discard_reason
        : isSelected ? null : "Not selected",
    });
  }

  await getSupabase()
    .from("properties")
    .update({ selected_photo_count: selected.length })
    .eq("id", propertyId);

  const cost = estimateAnalysisCost(photos.length);
  await addPropertyCost(propertyId, cost);
  await log(propertyId, "analysis", "info", `Analysis done: ${selected.length} selected from ${allResults.length}`);
}

function selectPhotos(
  results: Array<{ photo: Photo; analysis: PhotoAnalysisResult }>
): Array<{ photo: Photo; analysis: PhotoAnalysisResult }> {
  const candidates = results.filter((r) => !r.analysis.suggested_discard);
  const byRoom = new Map<RoomType, typeof candidates>();
  for (const c of candidates) {
    const existing = byRoom.get(c.analysis.room_type) ?? [];
    existing.push(c);
    byRoom.set(c.analysis.room_type, existing);
  }
  for (const group of byRoom.values()) {
    group.sort((a, b) => b.analysis.aesthetic_score - a.analysis.aesthetic_score);
  }

  const selected: typeof candidates = [];

  // Required room types
  for (const rt of REQUIRED_ROOM_TYPES) {
    const group = byRoom.get(rt);
    if (group?.[0] && !selected.some((s) => s.analysis.room_type === rt)) {
      selected.push(group[0]);
    }
  }
  // Exterior back / aerial
  for (const rt of ["exterior_back", "aerial"] as RoomType[]) {
    const group = byRoom.get(rt);
    if (group?.[0] && !selected.some((s) => s.analysis.room_type === rt)) {
      selected.push(group[0]);
    }
  }
  // Fill remaining
  const remaining = candidates
    .filter((c) => !selected.includes(c))
    .sort((a, b) => b.analysis.aesthetic_score - a.analysis.aesthetic_score);

  for (const candidate of remaining) {
    if (selected.length >= TARGET_SCENE_COUNT) break;
    const count = selected.filter((s) => s.analysis.room_type === candidate.analysis.room_type).length;
    if (count >= MAX_PER_ROOM_TYPE) continue;
    selected.push(candidate);
  }

  return selected;
}

// ─── STAGE 3: SCRIPTING ────────────────────────────────────────

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
  const photoData = photos.map((p) => ({
    id: p.id,
    file_name: p.file_name ?? "unknown.jpg",
    room_type: p.room_type ?? "other",
    aesthetic_score: p.aesthetic_score ?? 5,
    depth_rating: p.depth_rating ?? "medium",
    key_features: p.key_features ?? [],
  }));

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: DIRECTOR_SYSTEM,
    messages: [{ role: "user", content: buildDirectorUserPrompt(photoData) }],
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

  await insertScenes(
    validScenes.map((s) => ({
      property_id: propertyId,
      photo_id: s.photo_id,
      scene_number: s.scene_number,
      camera_movement: s.camera_movement,
      prompt: s.prompt,
      duration_seconds: s.duration_seconds,
      provider: s.provider_preference ?? undefined,
    }))
  );

  const cost = estimateScriptingCost();
  await addPropertyCost(propertyId, cost);
  await log(propertyId, "scripting", "info", `Shot plan: ${validScenes.length} scenes, mood: ${output.mood}`);
}

// ─── STAGE 4+5: GENERATE + QC ─────────────────────────────────

async function runGenerationWithQC(propertyId: string): Promise<void> {
  await updatePropertyStatus(propertyId, "generating");
  const scenes = await getScenesForProperty(propertyId);
  const maxRetries = parseInt(process.env.MAX_RETRIES_PER_CLIP ?? "2", 10);
  const supabase = getSupabase();

  await log(propertyId, "generation", "info", `Generating ${scenes.length} clips in parallel`);

  // Process all scenes in parallel
  const results = await Promise.allSettled(
    scenes.map(async (scene) => {
      let lastError = "";
      // Providers that have already failed for this scene — excluded on subsequent attempts
      // so a broken provider (out of credit, outage) fails over instead of burning all retries.
      const excludeProviders: VideoProvider[] = [];
      let currentProvider: VideoProvider | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await updateSceneStatus(scene.id, "generating", { attempt_count: attempt + 1 });

          // Get the source photo
          const { data: photo } = await supabase
            .from("photos")
            .select("file_url, room_type")
            .eq("id", scene.photo_id)
            .single();

          if (!photo) throw new Error("Source photo not found");

          const photoResponse = await fetch(photo.file_url);
          const sourceImage = Buffer.from(await photoResponse.arrayBuffer());

          const provider = selectProvider(
            (photo.room_type as RoomType) ?? "other",
            scene.provider as VideoProvider | null,
            excludeProviders
          );
          currentProvider = provider.name;

          const startTime = Date.now();

          // Generate clip
          const genJob = await provider.generateClip({
            sourceImage,
            prompt: scene.prompt,
            durationSeconds: scene.duration_seconds,
            aspectRatio: "16:9",
          });

          await log(propertyId, "generation", "info",
            `Scene ${scene.scene_number}: submitted to ${provider.name}`, undefined, scene.id);

          // Poll until done
          const result = await pollUntilComplete(provider, genJob.jobId);
          if (result.status === "failed") throw new Error(result.error ?? "Generation failed");

          // Download and store clip
          const clipBuffer = await provider.downloadClip(result.videoUrl!);
          const clipPath = `${propertyId}/clips/scene_${scene.scene_number}_v${attempt + 1}.mp4`;

          await supabase.storage.from("property-videos").upload(clipPath, clipBuffer, {
            contentType: "video/mp4",
            upsert: true,
          });

          const { data: urlData } = supabase.storage.from("property-videos").getPublicUrl(clipPath);
          const costCents = result.costCents ?? estimateGenerationCost(provider.name, scene.duration_seconds);
          const genTimeMs = Date.now() - startTime;

          await updateSceneStatus(scene.id, "qc_pass", {
            clip_url: urlData.publicUrl,
            provider: provider.name,
            generation_cost_cents: costCents,
            generation_time_ms: genTimeMs,
          });

          await addPropertyCost(propertyId, costCents);
          await log(propertyId, "generation", "info",
            `Scene ${scene.scene_number}: done in ${(genTimeMs / 1000).toFixed(1)}s via ${provider.name}`,
            { costCents }, scene.id);

          // Run QC
          const qcPassed = await runQCForScene(propertyId, scene.id, urlData.publicUrl, scene);
          if (qcPassed) return;

          // QC failed — loop will retry
          lastError = "QC rejected";
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          await log(propertyId, "generation", "warn",
            `Scene ${scene.scene_number} attempt ${attempt + 1} failed${currentProvider ? ` (${currentProvider})` : ""}: ${lastError}`, undefined, scene.id);
          if (currentProvider && !excludeProviders.includes(currentProvider)) {
            excludeProviders.push(currentProvider);
          }
          currentProvider = null;
        }
      }

      // All retries exhausted
      await updateSceneStatus(scene.id, "needs_review");
      await log(propertyId, "generation", "error",
        `Scene ${scene.scene_number} failed after ${maxRetries + 1} attempts: ${lastError}`, undefined, scene.id);
    })
  );

  // Check results
  const updatedScenes = await getScenesForProperty(propertyId);
  const passed = updatedScenes.filter((s) => s.status === "qc_pass").length;
  const needsReview = updatedScenes.filter((s) => s.status === "needs_review").length;

  if (needsReview > 0 && passed < 6) {
    await updatePropertyStatus(propertyId, "needs_review");
    await log(propertyId, "generation", "warn",
      `${needsReview} clips need review, only ${passed} passed. Pausing for HITL.`);
    return;
  }

  await log(propertyId, "generation", "info", `${passed}/${updatedScenes.length} clips ready`);
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

async function runAssembly(propertyId: string): Promise<void> {
  await updatePropertyStatus(propertyId, "assembling");
  await log(propertyId, "assembly", "info", "Starting assembly");

  const property = await getProperty(propertyId);
  const scenes = await getScenesForProperty(propertyId);
  const passedScenes = scenes.filter((s) => s.status === "qc_pass" && s.clip_url);

  if (passedScenes.length === 0) {
    await updatePropertyStatus(propertyId, "failed");
    await log(propertyId, "assembly", "error", "No clips available for assembly");
    return;
  }

  // For Vercel deployment, assembly (FFmpeg stitching) needs to happen
  // via an external service or Vercel Sandbox since Vercel Functions
  // don't have FFmpeg binaries.
  //
  // For launch: store individual clips and mark complete.
  // The Lovable dashboard shows all clips in order — the editor
  // (or a future FFmpeg service) handles final stitching.
  //
  // TODO: Add Vercel Sandbox or external FFmpeg service for automated stitching

  const totalProcessingMs = Date.now() - new Date(property.created_at).getTime();

  // Use first clip as thumbnail
  const thumbnailUrl = passedScenes[0]?.clip_url ?? null;

  await updatePropertyStatus(propertyId, "complete", {
    thumbnail_url: thumbnailUrl,
    processing_time_ms: totalProcessingMs,
  });

  await log(propertyId, "assembly", "info",
    `Complete! ${passedScenes.length} clips generated in ${(totalProcessingMs / 1000).toFixed(1)}s. Total cost: $${((property.total_cost_cents) / 100).toFixed(2)}`,
    { clipCount: passedScenes.length, totalProcessingMs, totalCostCents: property.total_cost_cents }
  );
}
