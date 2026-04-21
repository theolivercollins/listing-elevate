#!/usr/bin/env -S npx tsx
/**
 * seed-router-grid.ts
 *
 * Stands up a Phase 2.8 Lab listing pre-populated with 5 scenes (one per
 * quota-high router bucket) × N SKU-candidate iterations each. After this
 * runs, Oliver opens the listing in the Lab and rates every iteration.
 * Re-running scripts/build-router-table.ts afterward emits a winning
 * router-table per bucket.
 *
 * Config: scripts/router-grid-config.json
 *
 * Usage:
 *   npx tsx scripts/seed-router-grid.ts               (dry-run, no spend)
 *   npx tsx scripts/seed-router-grid.ts --write       (creates listing +
 *                                                      submits renders)
 *
 * Idempotent: reruns reuse the listing by name; only missing (scene, SKU)
 * iterations get submitted.
 *
 * Appends one row per render to docs/audits/test-render-log-2026-04-21.md
 * BEFORE the render is submitted — so if the process dies mid-flight the
 * audit trail still lists every attempted render.
 */

import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

import { getSupabase } from "../lib/db.js";
import { ATLAS_MODELS } from "../lib/providers/atlas.js";
import { pickProvider } from "../lib/providers/dispatch.js";
import { RunwayProvider } from "../lib/providers/runway.js";
import { analyzePhotoWithGemini, type MotionHeadroom } from "../lib/providers/gemini-analyzer.js";
import { buildAnalysisText, embedTextSafe, toPgVector } from "../lib/embeddings.js";
import { sanitizeDirectorPrompt } from "../lib/sanitize-prompt.js";

const CONFIG_PATH = "scripts/router-grid-config.json";
const TEST_RENDER_LOG = "docs/audits/test-render-log-2026-04-21.md";
// Listing created_by — matches the auth.users row every existing
// prompt_lab_listings row was created with. Hard-coded because the
// script owns the listing it creates and runs in Oliver's context only.
const OLIVER_USER_ID = "29a51ea1-0339-47e3-9666-dd8985c00b0d";

const CAMERA_STABILITY_PREFIX =
  "LOCKED-OFF CAMERA on a gimbal-stabilized Steadicam rig. Smooth motorized dolly motion only. Zero camera shake, zero handheld jitter, tripod-stable framing. ";

interface BucketConfig {
  id: string;
  room_type: string;
  camera_movement: string;
  director_prompt: string;
  source_photo_id: string;
  source_table: "prompt_lab_listing_photos" | "photos";
  rationale: string;
  skus: string[];
}

interface Config {
  listing_name: string;
  listing_notes: string;
  buckets: BucketConfig[];
  sku_cost_estimates_cents: Record<string, number>;
  budget_cents: number;
}

function loadConfig(): Config {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return JSON.parse(raw) as Config;
}

// ── Args ──
const WRITE = process.argv.includes("--write");
const DRY_RUN = !WRITE;

// Map a director camera_movement to the motion_headroom key it depends on.
// Mirror of lib/prompt-lab-listings.ts::mapCameraMovementToHeadroomKey
function movementToHeadroomKey(movement: string): keyof MotionHeadroom | null {
  switch (movement) {
    case "push_in":
    case "low_angle_glide":
      return "push_in";
    case "drone_push_in":
      return "drone_push_in";
    case "orbit":
      return "orbit";
    case "parallax":
    case "dolly_left_to_right":
    case "dolly_right_to_left":
    case "reveal":
      return "parallax";
    case "top_down":
      return "top_down";
    default:
      return null;
  }
}

function estimateCostCents(config: Config): { perBucket: number[]; total: number } {
  const perBucket = config.buckets.map((b) =>
    b.skus.reduce((a, sku) => a + (config.sku_cost_estimates_cents[sku] ?? 60), 0),
  );
  return { perBucket, total: perBucket.reduce((a, c) => a + c, 0) };
}

// ── Helpers ──

async function fetchSourcePhoto(
  supabase: ReturnType<typeof getSupabase>,
  bucket: BucketConfig,
): Promise<{ image_url: string; analysis_json: unknown } | null> {
  if (bucket.source_table === "prompt_lab_listing_photos") {
    const { data } = await supabase
      .from("prompt_lab_listing_photos")
      .select("image_url, analysis_json")
      .eq("id", bucket.source_photo_id)
      .maybeSingle();
    return (data as { image_url: string; analysis_json: unknown } | null) ?? null;
  }
  const { data } = await supabase
    .from("photos")
    .select("file_url, room_type, aesthetic_score, depth_rating, key_features, composition, suggested_motion")
    .eq("id", bucket.source_photo_id)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    file_url: string;
    room_type: string | null;
    aesthetic_score: number | null;
    depth_rating: string | null;
    key_features: string[] | null;
    composition: string | null;
    suggested_motion: string | null;
  };
  return {
    image_url: row.file_url,
    analysis_json: {
      room_type: row.room_type,
      aesthetic_score: row.aesthetic_score,
      depth_rating: row.depth_rating,
      key_features: row.key_features,
      composition: row.composition,
      suggested_motion: row.suggested_motion,
    },
  };
}

async function findOrCreateListing(
  supabase: ReturnType<typeof getSupabase>,
  config: Config,
): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await supabase
    .from("prompt_lab_listings")
    .select("id")
    .eq("name", config.listing_name)
    .maybeSingle();
  if (existing) return { id: existing.id as string, created: false };
  const { data: created, error } = await supabase
    .from("prompt_lab_listings")
    .insert({
      name: config.listing_name,
      created_by: OLIVER_USER_ID,
      notes: config.listing_notes,
      model_name: "kling-v2-6-pro",
      status: "ready_to_render",
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(`create listing failed: ${error?.message ?? "no row"}`);
  return { id: created.id as string, created: true };
}

async function findOrCreatePhoto(
  supabase: ReturnType<typeof getSupabase>,
  listingId: string,
  bucketIndex: number,
  source: { image_url: string; analysis_json: unknown },
): Promise<{ id: string; created: boolean; analysis_json: unknown }> {
  const { data: existing } = await supabase
    .from("prompt_lab_listing_photos")
    .select("id, analysis_json")
    .eq("listing_id", listingId)
    .eq("photo_index", bucketIndex)
    .maybeSingle();
  if (existing) {
    return {
      id: existing.id as string,
      created: false,
      analysis_json: (existing as { analysis_json: unknown }).analysis_json,
    };
  }
  const { data: created, error } = await supabase
    .from("prompt_lab_listing_photos")
    .insert({
      listing_id: listingId,
      photo_index: bucketIndex,
      image_url: source.image_url,
      image_path: source.image_url, // we don't re-upload; pointer suffices
      analysis_json: source.analysis_json ?? null,
    })
    .select("id, analysis_json")
    .single();
  if (error || !created) throw new Error(`create photo failed: ${error?.message ?? "no row"}`);
  return {
    id: created.id as string,
    created: true,
    analysis_json: (created as { analysis_json: unknown }).analysis_json,
  };
}

async function ensureGeminiAnalysis(
  supabase: ReturnType<typeof getSupabase>,
  photoId: string,
  imageUrl: string,
  existingAnalysis: unknown,
): Promise<{ analysis: Record<string, unknown>; ranAnalyze: boolean }> {
  const a = (existingAnalysis ?? {}) as Record<string, unknown>;
  if (a && a.motion_headroom) {
    return { analysis: a, ranAnalyze: false };
  }
  console.log(`  gemini-analyzing photo ${photoId}...`);
  const res = await analyzePhotoWithGemini(imageUrl);
  const merged: Record<string, unknown> = { ...a, ...res.analysis };
  const embedded = await embedTextSafe(
    buildAnalysisText({
      roomType: res.analysis.room_type,
      keyFeatures: res.analysis.key_features ?? [],
      composition: res.analysis.composition,
      suggestedMotion: res.analysis.suggested_motion,
      cameraMovement: null,
    }),
  );
  const update: Record<string, unknown> = { analysis_json: merged };
  if (embedded) update.embedding = toPgVector(embedded.vector);
  const { error } = await supabase.from("prompt_lab_listing_photos").update(update).eq("id", photoId);
  if (error) throw new Error(`update photo analysis failed: ${error.message}`);

  // Cost events — mirror of analyzeListingPhotos but scoped to router grid.
  try {
    await supabase.from("cost_events").insert({
      property_id: null,
      scene_id: null,
      stage: "analysis",
      provider: "google",
      units_consumed: res.usage.inputTokens + res.usage.outputTokens,
      unit_type: "tokens",
      cost_cents: Math.round(res.usage.costCents),
      metadata: {
        scope: "router_grid_seed_analysis",
        model: res.model,
        photo_id: photoId,
      },
    });
    if (embedded) {
      await supabase.from("cost_events").insert({
        property_id: null,
        scene_id: null,
        stage: "embedding",
        provider: "openai",
        units_consumed: embedded.usage.totalTokens,
        unit_type: "tokens",
        cost_cents: Math.round(embedded.usage.costCents),
        metadata: { scope: "router_grid_seed_embedding", model: embedded.model, photo_id: photoId },
      });
    }
  } catch (costErr) {
    console.warn(`  cost_events insert warning: ${costErr}`);
  }
  return { analysis: merged, ranAnalyze: true };
}

async function findOrCreateScene(
  supabase: ReturnType<typeof getSupabase>,
  listingId: string,
  bucket: BucketConfig,
  photoId: string,
  sceneNumber: number,
): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await supabase
    .from("prompt_lab_listing_scenes")
    .select("id")
    .eq("listing_id", listingId)
    .eq("scene_number", sceneNumber)
    .maybeSingle();
  if (existing) return { id: existing.id as string, created: false };
  const prompt = sanitizeDirectorPrompt(bucket.director_prompt);
  const { data: created, error } = await supabase
    .from("prompt_lab_listing_scenes")
    .insert({
      listing_id: listingId,
      scene_number: sceneNumber,
      photo_id: photoId,
      room_type: bucket.room_type,
      camera_movement: bucket.camera_movement,
      director_prompt: prompt,
      director_intent: { room_type: bucket.room_type, motion: bucket.camera_movement, subject: prompt.slice(0, 80) },
      use_end_frame: false,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(`create scene failed: ${error.message ?? "no row"}`);
  return { id: created.id as string, created: true };
}

async function existingIterationSkus(
  supabase: ReturnType<typeof getSupabase>,
  sceneId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("prompt_lab_listing_scene_iterations")
    .select("model_used, status")
    .eq("scene_id", sceneId);
  const out = new Set<string>();
  for (const r of (data ?? []) as Array<{ model_used: string | null; status: string | null }>) {
    if (r.model_used && r.status !== "failed") out.add(r.model_used);
  }
  return out;
}

async function nextIterationNumber(
  supabase: ReturnType<typeof getSupabase>,
  sceneId: string,
): Promise<number> {
  const { data } = await supabase
    .from("prompt_lab_listing_scene_iterations")
    .select("iteration_number")
    .eq("scene_id", sceneId)
    .order("iteration_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as { iteration_number: number } | null)?.iteration_number ?? 0) + 1;
}

function appendRenderLogRow(row: {
  timestamp: string;
  sceneLabel: string;
  promptAfter: string;
  sku: string;
  estCents: number;
  taskIdOrNote: string;
  observation: string;
}): void {
  const clean = (s: string): string => s.replace(/\|/g, "¦").replace(/\n/g, " ").slice(0, 140);
  const line = `| ${row.timestamp} | D | ${clean(row.sceneLabel)} | N/A | ${clean(row.promptAfter)} | ${row.sku} | ${row.estCents} | ${row.taskIdOrNote} | ${clean(row.observation)} |`;
  fs.appendFileSync(TEST_RENDER_LOG, line + "\n", "utf8");
}

async function submitRender(
  supabase: ReturnType<typeof getSupabase>,
  params: {
    sceneId: string;
    imageUrl: string;
    modelKey: string;
    basePrompt: string;
    iterationNumber: number;
    bucketLabel: string;
  },
): Promise<{ iterationId: string; taskId: string | null; status: string }> {
  const { sceneId, imageUrl, modelKey, basePrompt, iterationNumber, bucketLabel } = params;
  const needsStabilityPrefix = modelKey.startsWith("kling-v3");
  const effectivePrompt =
    needsStabilityPrefix && !basePrompt.includes("LOCKED-OFF CAMERA")
      ? `${CAMERA_STABILITY_PREFIX}${basePrompt}`
      : basePrompt;

  const { data: iter, error } = await supabase
    .from("prompt_lab_listing_scene_iterations")
    .insert({
      scene_id: sceneId,
      iteration_number: iterationNumber,
      director_prompt: effectivePrompt,
      model_used: modelKey,
      status: "submitting",
    })
    .select("id")
    .single();
  if (error || !iter) throw new Error(`insert iteration failed: ${error?.message ?? "no row"}`);
  const iterationId = iter.id as string;

  appendRenderLogRow({
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    sceneLabel: `${bucketLabel} (scene=${sceneId.slice(0, 8)})`,
    promptAfter: effectivePrompt,
    sku: modelKey,
    estCents: 0,
    taskIdOrNote: "submitting",
    observation: "router-grid seed render; pre-submit log row",
  });

  try {
    let job: { jobId: string };
    if (modelKey === "runway") {
      const provider = new RunwayProvider();
      job = await provider.generateClip({
        sourceImage: Buffer.from(""),
        sourceImageUrl: imageUrl,
        prompt: effectivePrompt,
        durationSeconds: 5,
        aspectRatio: "16:9",
      });
    } else {
      const provider = pickProvider(modelKey);
      job = await provider.generateClip({
        sourceImage: Buffer.from(""),
        sourceImageUrl: imageUrl,
        prompt: effectivePrompt,
        durationSeconds: 5,
        aspectRatio: "16:9",
        modelOverride: modelKey,
      });
    }
    await supabase
      .from("prompt_lab_listing_scene_iterations")
      .update({ provider_task_id: job.jobId, status: "rendering" })
      .eq("id", iterationId);
    return { iterationId, taskId: job.jobId, status: "rendering" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("prompt_lab_listing_scene_iterations")
      .update({ status: "failed", render_error: msg })
      .eq("id", iterationId);
    console.warn(`  submit failed for ${modelKey}: ${msg.slice(0, 200)}`);
    return { iterationId, taskId: null, status: "failed" };
  }
}

// ── Main ──

async function main() {
  const config = loadConfig();
  const cost = estimateCostCents(config);

  console.log(`seed-router-grid.ts — ${DRY_RUN ? "DRY RUN" : "WRITE"} mode`);
  console.log(`Listing name: ${config.listing_name}`);
  console.log("");
  console.log("Buckets + projected cost:");
  for (let i = 0; i < config.buckets.length; i++) {
    const b = config.buckets[i];
    const c = cost.perBucket[i];
    console.log(
      `  ${i + 1}. ${b.room_type} × ${b.camera_movement} — ${b.skus.length} SKUs — projected ${c}¢ ($${(c / 100).toFixed(2)})`,
    );
    console.log(`     SKUs: ${b.skus.join(", ")}`);
  }
  console.log(`  TOTAL: ${cost.total}¢ ($${(cost.total / 100).toFixed(2)})`);
  console.log(`  BUDGET: ${config.budget_cents}¢ ($${(config.budget_cents / 100).toFixed(2)})`);
  console.log("");

  if (cost.total > config.budget_cents) {
    console.error(`Projected cost $${(cost.total / 100).toFixed(2)} exceeds budget $${(config.budget_cents / 100).toFixed(2)}. Trim candidate SKUs.`);
    process.exit(2);
  }

  if (DRY_RUN) {
    console.log("DRY RUN — would take these actions on --write:");
    for (const b of config.buckets) {
      console.log(`  [${b.id}] source photo ${b.source_photo_id} (${b.source_table})`);
      console.log(`           prompt: ${b.director_prompt}`);
      for (const sku of b.skus) {
        console.log(`           submit render with SKU=${sku}`);
      }
    }
    console.log("");
    console.log("Re-run with --write to persist + submit.");
    return;
  }

  // WRITE mode
  const supabase = getSupabase();
  const { id: listingId, created: listingCreated } = await findOrCreateListing(supabase, config);
  console.log(`Listing ${listingId} ${listingCreated ? "CREATED" : "REUSED"}`);

  // Phase 1: photos
  const photoByBucket = new Map<string, { id: string; imageUrl: string; analysis: Record<string, unknown> }>();
  for (let i = 0; i < config.buckets.length; i++) {
    const bucket = config.buckets[i];
    const source = await fetchSourcePhoto(supabase, bucket);
    if (!source) {
      console.error(`  skipping bucket ${bucket.id}: source photo ${bucket.source_photo_id} not found`);
      continue;
    }
    const photo = await findOrCreatePhoto(supabase, listingId, i, source);
    console.log(`  photo[${i}] ${photo.id} ${photo.created ? "CREATED" : "REUSED"} (${bucket.room_type})`);
    const { analysis } = await ensureGeminiAnalysis(supabase, photo.id, source.image_url, photo.analysis_json);
    photoByBucket.set(bucket.id, { id: photo.id, imageUrl: source.image_url, analysis });
  }

  // Phase 2: motion_headroom check → scene insertion
  const sceneByBucket = new Map<string, string>(); // bucket.id → scene_id
  for (let i = 0; i < config.buckets.length; i++) {
    const bucket = config.buckets[i];
    const photo = photoByBucket.get(bucket.id);
    if (!photo) continue;
    const headroomKey = movementToHeadroomKey(bucket.camera_movement);
    const headroom = (photo.analysis.motion_headroom ?? null) as MotionHeadroom | null;
    if (headroomKey && headroom && headroom[headroomKey] === false) {
      console.warn(
        `  !! bucket ${bucket.id} photo has motion_headroom.${headroomKey}=false — skipping scene. Swap photo in config and re-run.`,
      );
      continue;
    }
    const scene = await findOrCreateScene(supabase, listingId, bucket, photo.id, i + 1);
    console.log(`  scene[${i + 1}] ${scene.id} ${scene.created ? "CREATED" : "REUSED"}`);
    sceneByBucket.set(bucket.id, scene.id);
  }

  // Phase 3: submit renders
  let submitted = 0;
  let skipped = 0;
  let failed = 0;
  let spentEstCents = 0;
  for (const bucket of config.buckets) {
    const sceneId = sceneByBucket.get(bucket.id);
    if (!sceneId) {
      console.warn(`  bucket ${bucket.id} has no scene — skipping all renders`);
      continue;
    }
    const photo = photoByBucket.get(bucket.id)!;
    const already = await existingIterationSkus(supabase, sceneId);
    for (const sku of bucket.skus) {
      if (already.has(sku)) {
        console.log(`  skip ${bucket.id} × ${sku} — iteration already exists`);
        skipped++;
        continue;
      }
      const est = config.sku_cost_estimates_cents[sku] ?? 60;
      if (spentEstCents + est > config.budget_cents) {
        console.warn(`  BUDGET GUARD: stopping before ${bucket.id} × ${sku} (would exceed $${(config.budget_cents / 100).toFixed(2)})`);
        break;
      }
      const iterN = await nextIterationNumber(supabase, sceneId);
      const result = await submitRender(supabase, {
        sceneId,
        imageUrl: photo.imageUrl,
        modelKey: sku,
        basePrompt: bucket.director_prompt,
        iterationNumber: iterN,
        bucketLabel: `${bucket.room_type} × ${bucket.camera_movement}`,
      });
      if (result.status === "rendering") {
        submitted++;
        spentEstCents += est;
        console.log(`  submitted ${bucket.id} × ${sku} — task=${result.taskId}`);
      } else {
        failed++;
      }
    }
  }

  // Keep status=ready_to_render so cron finalizer (poll-listing-iterations)
  // picks up the rendering iterations. We don't set 'rendering' because
  // that's a listing-level state the Lab UI uses for legitimate renders;
  // our grid is sideloaded.

  console.log("");
  console.log(`Summary: submitted=${submitted}, skipped=${skipped}, failed=${failed}`);
  console.log(`Estimated spend: ${spentEstCents}¢ ($${(spentEstCents / 100).toFixed(2)}) of $${(config.budget_cents / 100).toFixed(2)} budget`);
  console.log(`Listing id: ${listingId}`);
  console.log("");
  console.log("Next: wait ~2-3 minutes for poll-listing-iterations to finalize renders,");
  console.log(`then open /dashboard/development/lab/listings/${listingId} to rate.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
