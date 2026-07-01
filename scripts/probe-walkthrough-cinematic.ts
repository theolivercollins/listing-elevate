#!/usr/bin/env -S npx tsx
/**
 * scripts/probe-walkthrough-cinematic.ts
 *
 * Cinematic walkthrough v2 engine probe. Fetches a property's selected
 * photos, runs the REAL production modules — `analyzeSpatialGraph()` +
 * `planRoute()` (lib/walkthrough/spatial.ts) — and prints the connectivity
 * map + segment plan so it can be reviewed BEFORE any render is submitted
 * (the DRY run, default behavior).
 *
 * Behind `--generate`, it goes on to actually render: submits each planned
 * segment via `AtlasProvider.generateReferenceClip()` (the same production
 * transport `lib/walkthrough/generate.ts` uses — no hand-rolled HTTP) when
 * the segment has 2+ reference photos. Single-photo establishing beats
 * (front exterior, back exterior, aerial hero — anything the spatial planner
 * couldn't connect to another room) CANNOT go through that path: Atlas's
 * `seedance-reference-walkthrough` SKU hard-requires 2-9 reference_images
 * (lib/providers/atlas.ts buildAtlasReferenceRequestBody). Those segments
 * instead render through the existing single-image production path —
 * `AtlasProvider.generateClip()` on the `seedance-pro-pushin` SKU, exactly
 * as lib/pipeline.ts's per-scene renderer calls it. Every segment, of either
 * kind, polls to completion, downloads its mp4, and all get stitched
 * locally with a single ffmpeg xfade command (1s crossfades — matching the
 * plan's crossfade transitions, one video re-encode) into one cinematic
 * walkthrough file.
 *
 * MONEY-SPENDING when run with `--generate`: one Gemini spatial-analysis
 * call (a few cents) PLUS one Atlas Seedance 2.0 reference-to-video render
 * per planned segment (typically 2-4 segments, ~$0.15-0.60 each depending
 * on duration). Every paid call writes a real cost_events row — this is
 * NOT a "just print the estimate" probe like scripts/probe-walkthrough.ts;
 * it follows scripts/probe-assembly-bitrate.ts's convention of a real,
 * cost-tracked local probe instead, since it renders MULTIPLE paid clips in
 * one run and the ledger must reflect every one of them. Requires
 * LE_ALLOW_NONPROD_WRITES=true (or VERCEL_ENV=production, which never
 * applies to a local run) before ANY cost_events write is attempted — the
 * dry-run (analysis-only) path never touches the DB write guard because it
 * never calls recordCostEvent.
 *
 * NOTE: this script has NOT been run by the authoring agent — Oliver runs
 * it himself (project convention: paid/spend-triggering scripts are never
 * run by the agent that writes them).
 *
 * Usage:
 *   Dry run (analysis + plan only, no spend beyond the Gemini call itself —
 *   still requires GEMINI_API_KEY, still writes NOTHING to cost_events):
 *     GEMINI_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *       /path/to/main/repo/node_modules/.bin/tsx \
 *       scripts/probe-walkthrough-cinematic.ts [propertyId]
 *
 *   Full render (spends money, writes cost_events, stitches a local file):
 *     GEMINI_API_KEY=... ATLASCLOUD_API_KEY=... LE_ALLOW_NONPROD_WRITES=true \
 *       /path/to/main/repo/node_modules/.bin/tsx \
 *       scripts/probe-walkthrough-cinematic.ts [propertyId] --generate
 *
 * propertyId defaults to a30212b2-088a-40a2-9c7a-f4ec16d04e45 (San Massimo —
 * same property used by scripts/e2e-walkthrough.ts and
 * scripts/probe-assembly-bitrate.ts).
 */

// ─── env bootstrap ──────────────────────────────────────────────────────────
// Mirrors scripts/e2e-walkthrough.ts's manual loader (not a bare
// `import "dotenv/config"`): this script lives in a git worktree with no
// `.env` of its own, so it resolves the REPO ROOT `.env` relative to
// import.meta.url instead of process.cwd().
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const envPath = path.resolve(scriptDir, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

import { getSelectedPhotos, getPhotosForProperty, recordCostEvent } from "../lib/db.js";
import { analyzeSpatialGraph, planRoute } from "../lib/walkthrough/spatial.js";
import type { SpatialGraph, WalkthroughPlan, WalkthroughSegment } from "../lib/walkthrough/spatial.js";
import { AtlasProvider, atlasClipCostCents, ATLAS_MODELS } from "../lib/providers/atlas.js";
import { pollUntilComplete } from "../lib/providers/provider.interface.js";

const SKU = "seedance-reference-walkthrough" as const;
// Single-photo establishing beats (1 reference image) can't use SKU above —
// Atlas requires 2-9 reference_images for reference-to-video. They fall back
// to the existing single-image production SKU (same one lib/pipeline.ts's
// per-scene renderer uses for v1.1 push-in scenes).
const PUSHIN_SKU = "seedance-pro-pushin" as const;
// Establishing-shot variant of the walkthrough camera language, adapted for
// a single reference image (no room-to-room path to describe).
const PUSHIN_ESTABLISHING_PROMPT =
  "Slow cinematic push-in on this scene, stabilized gimbal feel, preserve the exact scene from the reference photo, photorealistic, natural color grading, no cuts, no people, no text, no added objects, no distortion.";
const RESOLUTION = "1080p" as const;
const DEFAULT_PROPERTY_ID = "a30212b2-088a-40a2-9c7a-f4ec16d04e45"; // San Massimo
const MAX_PHOTOS_FOR_ANALYSIS = 12; // matches spatial.ts's "up to ~12" docblock
const CROSSFADE_SECONDS = 1;

/** Which Atlas SKU a segment renders through, based on how many reference
 *  photos the spatial planner gave it. */
function skuForSegment(seg: WalkthroughSegment): typeof SKU | typeof PUSHIN_SKU {
  return seg.photoIds.length >= 2 ? SKU : PUSHIN_SKU;
}

/** Snap `requested` to the closest value in a fixed allowed-durations set.
 *  Mirrors lib/providers/atlas.ts's private clampDuration() for the
 *  fixed-array branch (PUSHIN_SKU's allowedDurations is [5,10], not
 *  "continuous" like the reference-walkthrough SKU) — kept local since that
 *  helper isn't exported, and this probe needs the CLAMPED value up front
 *  (not just inside generateClip()) so the printed cost estimate and the
 *  recorded cost_events row both reflect what Atlas actually bills. */
function clampToAllowedDurations(requested: number, allowed: readonly number[]): number {
  let best = allowed[0];
  let bestDist = Math.abs(requested - best);
  for (const d of allowed) {
    const dist = Math.abs(requested - d);
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

/** Effective (billed) duration for a segment: the reference-walkthrough SKU
 *  is "continuous" (4-15s, no snapping), the push-in SKU only accepts 5 or
 *  10 — a 4s single-photo beat becomes 5s. */
function effectiveDurationForSegment(seg: WalkthroughSegment): number {
  if (skuForSegment(seg) === PUSHIN_SKU) {
    return clampToAllowedDurations(seg.durationSec, ATLAS_MODELS[PUSHIN_SKU].allowedDurations as readonly number[]);
  }
  return seg.durationSec;
}

function writesAllowed(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.LE_ALLOW_NONPROD_WRITES === "true";
}

// ─── printing ─────────────────────────────────────────────────────────────

function printGraph(graph: SpatialGraph): void {
  console.log("\n=== Spatial graph ===");
  console.log(`Rooms (${graph.rooms.length}):`);
  for (const r of graph.rooms) {
    console.log(`  [${r.photoId.slice(0, 8)}] ${r.label} (room_type=${r.roomType})`);
  }
  const sortedEdges = [...graph.edges].sort((a, b) => b.confidence - a.confidence);
  console.log(`\nEdges (${sortedEdges.length}, sorted by confidence):`);
  if (sortedEdges.length === 0) {
    console.log("  (none — every room will be its own segment, all fades)");
  }
  const roomLabel = (id: string) => graph.rooms.find((r) => r.photoId === id)?.label ?? id.slice(0, 8);
  for (const e of sortedEdges) {
    const walkable = e.confidence >= 0.6 ? "WALKABLE" : "below threshold — ignored";
    console.log(
      `  ${roomLabel(e.from)} <-> ${roomLabel(e.to)}  [${e.type}, conf=${e.confidence.toFixed(2)}, ${walkable}]`,
    );
    console.log(`    evidence: photo ${e.evidencePhotoId.slice(0, 8)} — ${e.description}`);
  }
  const hero = graph.heroShot ? roomLabel(graph.heroShot) : null;
  console.log(`\nHero shot: ${hero ? `${hero} (${graph.heroShot!.slice(0, 8)})` : "(none picked)"}`);
  if (graph.usage) {
    console.log(
      `\nAnalysis cost: ${graph.usage.costCents.toFixed(2)}¢ (${graph.usage.inputTokens} in / ${graph.usage.outputTokens} out tokens, ${graph.usage.model})`,
    );
  }
}

function printPlan(plan: WalkthroughPlan, graph: SpatialGraph): void {
  console.log("\n=== Route plan ===");
  const roomLabel = (id: string) => graph.rooms.find((r) => r.photoId === id)?.label ?? id.slice(0, 8);
  plan.segments.forEach((seg, i) => {
    const labels = seg.photoIds.map(roomLabel).join(" -> ");
    const sku = skuForSegment(seg);
    const billedDuration = effectiveDurationForSegment(seg);
    const durationNote = billedDuration !== seg.durationSec ? `${seg.durationSec}s planned -> ${billedDuration}s billed` : `${seg.durationSec}s`;
    console.log(
      `  Segment ${i}: ${labels}  (${durationNote}, ${seg.photoIds.length} photo${seg.photoIds.length === 1 ? "" : "s"}, sku=${sku})`,
    );
  });
  console.log(`\nFade points (${plan.transitions.length}):`);
  for (const t of plan.transitions) {
    console.log(`  crossfade after segment ${t.afterSegmentIndex} -> segment ${t.afterSegmentIndex + 1}`);
  }
  const totalDuration = plan.segments.reduce((sum, s) => sum + s.durationSec, 0);
  console.log(`\nTotal segment duration (pre-crossfade-trim): ${totalDuration}s across ${plan.segments.length} segment(s)`);
}

// ─── ffmpeg stitch (single re-encode, xfade crossfades) ────────────────────

interface DownloadedSegment {
  segment: WalkthroughSegment;
  filePath: string;
  actualDurationSeconds: number;
}

function ffprobeDurationSeconds(filePath: string): number {
  const out = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], { encoding: "utf8" });
  if (out.status !== 0) {
    throw new Error(`ffprobe failed on ${filePath}: ${out.stderr}`);
  }
  const seconds = parseFloat(out.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe returned an unusable duration for ${filePath}: "${out.stdout.trim()}"`);
  }
  return seconds;
}

/** Builds and runs the single ffmpeg xfade stitch command, printing the
 *  exact argv used (task requirement: "print the exact ffmpeg command"). */
function stitchWithXfade(downloaded: DownloadedSegment[], outputPath: string): void {
  if (downloaded.length === 0) {
    throw new Error("stitchWithXfade: no downloaded segments");
  }
  if (downloaded.length === 1) {
    fs.copyFileSync(downloaded[0].filePath, outputPath);
    console.log(`\nOnly 1 segment — copied directly to ${outputPath} (no xfade needed).`);
    return;
  }

  const td = CROSSFADE_SECONDS;
  const filterParts: string[] = [];

  // Normalize every input to a common canvas/framerate INSIDE the single
  // filter_complex graph (still one ffmpeg process / one output re-encode —
  // Seedance segments should already share 1080p/16:9, but this guards
  // against a segment that rendered at a different aspect from a solo
  // no-edges-fallback room).
  downloaded.forEach((_, i) => {
    filterParts.push(
      `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[p${i}]`,
    );
  });

  let prevLabel = "[p0]";
  let runningOffset = downloaded[0].actualDurationSeconds - td;
  for (let i = 1; i < downloaded.length; i++) {
    const outLabel = i === downloaded.length - 1 ? "[outv]" : `[x${i}]`;
    filterParts.push(`${prevLabel}[p${i}]xfade=transition=fade:duration=${td}:offset=${runningOffset.toFixed(2)}${outLabel}`);
    prevLabel = outLabel;
    if (i < downloaded.length - 1) {
      runningOffset += downloaded[i].actualDurationSeconds - td;
    }
  }

  const args = [
    ...downloaded.flatMap((d) => ["-i", d.filePath]),
    "-filter_complex", filterParts.join(";"),
    "-map", "[outv]",
    "-an", // Seedance walkthrough segments render silent (generateAudio:false)
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-y",
    outputPath,
  ];

  console.log(`\nStitching ${downloaded.length} segments with ffmpeg (${td}s crossfades, single re-encode)...`);
  console.log(`Exact command:\n  ffmpeg ${args.map((a) => (a.includes(" ") || a.includes(";") ? `"${a}"` : a)).join(" ")}`);

  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg stitch failed (exit ${result.status}):\n${result.stderr}`);
  }
  console.log(`Stitched output: ${outputPath}`);
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const started = Date.now();
  const args = process.argv.slice(2);
  const generate = args.includes("--generate");
  const propertyId = args.find((a) => !a.startsWith("--")) ?? DEFAULT_PROPERTY_ID;

  if (!process.env.GEMINI_API_KEY) {
    console.error("ERROR: GEMINI_API_KEY is not set — required for the spatial analysis call.");
    process.exit(1);
  }
  if (generate && !process.env.ATLASCLOUD_API_KEY) {
    console.error("ERROR: ATLASCLOUD_API_KEY is not set — required for --generate (live Atlas renders cost money).");
    process.exit(1);
  }
  if (generate && !writesAllowed()) {
    console.error(
      "ERROR: --generate spends real money and writes cost_events — set LE_ALLOW_NONPROD_WRITES=true first " +
        "(or run on VERCEL_ENV=production, which never applies to a local run).",
    );
    process.exit(1);
  }

  console.log(`=== Cinematic walkthrough v2 probe (property ${propertyId}) ===`);
  console.log(`Mode: ${generate ? "GENERATE (paid render + stitch)" : "DRY RUN (analysis + plan only)"}`);

  console.log("\nFetching photos...");
  let photos = await getSelectedPhotos(propertyId);
  if (photos.length < 2) {
    photos = await getPhotosForProperty(propertyId);
  }
  photos = photos.slice(0, MAX_PHOTOS_FOR_ANALYSIS);
  if (photos.length < 2) {
    console.error(`ERROR: property ${propertyId} has fewer than 2 usable photos (${photos.length}).`);
    process.exit(1);
  }
  console.log(`  ${photos.length} photos (capped at ${MAX_PHOTOS_FOR_ANALYSIS})`);

  console.log("\nRunning spatial analysis (1 Gemini vision call over all photos)...");
  const graph = await analyzeSpatialGraph(
    photos.map((p) => ({ id: p.id, file_url: p.file_url, room_type: p.room_type })),
  );
  printGraph(graph);

  const plan = planRoute(graph);
  printPlan(plan, graph);

  const photoUrlById = new Map(photos.map((p) => [p.id, p.file_url]));
  const analysisCostCents = graph.usage?.costCents ?? 0;
  const estimatedRenderCostCents = plan.segments.reduce(
    (sum, s) => sum + atlasClipCostCents(skuForSegment(s), effectiveDurationForSegment(s)),
    0,
  );
  console.log(
    `\nEstimated total cost: ${(analysisCostCents + estimatedRenderCostCents).toFixed(2)}¢ ` +
      `($${((analysisCostCents + estimatedRenderCostCents) / 100).toFixed(2)}) — ` +
      `${analysisCostCents.toFixed(2)}¢ analysis + ${estimatedRenderCostCents.toFixed(2)}¢ across ${plan.segments.length} segment render(s)`,
  );

  if (!generate) {
    console.log("\nDry run complete. Re-run with --generate to render every segment and stitch the cinematic cut.");
    console.log(`Wall-clock: ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return;
  }

  // ── Real spend: submit every segment, poll all to completion, download,
  //    stitch, and record cost — every completed segment writes exactly one
  //    cost_events row, and a cost-write failure is never swallowed. ──
  console.log(`\nSubmitting ${plan.segments.length} segment(s) to Atlas...`);
  // Two separate provider instances (one per SKU), not one shared instance
  // with a per-call modelOverride: AtlasProvider mutates `this.model` inside
  // generateClip()/generateReferenceClip() so checkStatus()'s cost fields
  // reflect the SKU that actually rendered (see atlas.ts's "cost-attribution
  // fix" comments). That mutation is only safe when a single instance never
  // renders two different SKUs concurrently — this probe submits all
  // segments via Promise.all, so a shared instance across both SKUs would
  // race. Cheap to just use two instances.
  const referenceProvider = new AtlasProvider(SKU);
  const pushinProvider = new AtlasProvider(PUSHIN_SKU);
  const jobs = await Promise.all(
    plan.segments.map(async (seg, i) => {
      const sku = skuForSegment(seg);
      if (sku === SKU) {
        const referenceImageUrls = seg.photoIds.map((id) => {
          const url = photoUrlById.get(id);
          if (!url) throw new Error(`Segment ${i}: no file_url found for photo ${id}`);
          return url;
        });
        const job = await referenceProvider.generateReferenceClip({
          referenceImageUrls,
          prompt: seg.prompt,
          durationSeconds: seg.durationSec,
          resolution: RESOLUTION,
        });
        console.log(`  Segment ${i}: job ${job.jobId} submitted (reference-walkthrough, ${seg.durationSec}s, ${seg.photoIds.length} refs)`);
        return { segment: seg, index: i, jobId: job.jobId, sku, provider: referenceProvider as AtlasProvider };
      }

      // Single-photo establishing beat — no multi-ref support at 1 image;
      // render through the production single-image push-in SKU instead.
      // Mirrors lib/pipeline.ts's generateClip() call shape exactly
      // (sourceImage: Buffer.alloc(0) placeholder — AtlasProvider only reads
      // sourceImageUrl; see pipeline.ts:1243/1538).
      const photoId = seg.photoIds[0];
      const photoUrl = photoUrlById.get(photoId);
      if (!photoUrl) throw new Error(`Segment ${i}: no file_url found for photo ${photoId}`);
      const billedDuration = effectiveDurationForSegment(seg);
      const job = await pushinProvider.generateClip({
        sourceImage: Buffer.alloc(0),
        sourceImageUrl: photoUrl,
        prompt: PUSHIN_ESTABLISHING_PROMPT,
        durationSeconds: billedDuration,
        aspectRatio: "16:9",
        resolution: RESOLUTION,
        modelOverride: PUSHIN_SKU,
      });
      console.log(`  Segment ${i}: job ${job.jobId} submitted (push-in establishing shot, ${seg.durationSec}s planned -> ${billedDuration}s billed, 1 photo)`);
      // Record the CLAMPED duration on the segment carried forward so cost
      // recording + metadata reflect what Atlas actually billed, not the
      // planner's unclamped 4s.
      return { segment: { ...seg, durationSec: billedDuration }, index: i, jobId: job.jobId, sku, provider: pushinProvider as AtlasProvider };
    }),
  );

  console.log("\nPolling all segments to completion (this can take several minutes per segment)...");
  const results = await Promise.all(
    jobs.map(async (j) => {
      const result = await pollUntilComplete(j.provider, j.jobId, /* timeoutMs */ 900_000, /* intervalMs */ 8_000);
      return { ...j, result };
    }),
  );

  const timestamp = Date.now();
  const tmpDir = path.resolve(process.cwd(), "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  const downloaded: DownloadedSegment[] = [];
  let totalCostCents = analysisCostCents;

  for (const r of results) {
    if (r.result.status !== "complete" || !r.result.videoUrl) {
      console.error(`Segment ${r.index} FAILED: ${r.result.error ?? "no video URL returned"}`);
      continue;
    }
    const destPath = path.join(tmpDir, `cinematic-segment-${propertyId}-${timestamp}-${r.index}.mp4`);
    const res = await fetch(r.result.videoUrl);
    if (!res.ok) throw new Error(`Download failed for segment ${r.index}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, bytes);
    const actualDurationSeconds = ffprobeDurationSeconds(destPath);
    console.log(
      `  Segment ${r.index}: downloaded ${(bytes.length / 1e6).toFixed(2)} MB, actual duration ${actualDurationSeconds.toFixed(2)}s -> ${destPath}`,
    );

    // r.segment.durationSec is already the BILLED duration — the pushin
    // branch above rewrote it to the clamped value before this loop runs.
    const costCents = atlasClipCostCents(r.sku, r.segment.durationSec) || r.result.costCents || 0;
    // Cost recording is never optional and never silenced (P0 project
    // convention) — recordCostEvent throws on insert failure and that throw
    // propagates uncaught, matching lib/walkthrough/generate.ts's pattern.
    await recordCostEvent({
      propertyId,
      stage: "generation",
      provider: "atlas",
      costCents,
      unitsConsumed: r.result.providerUnits,
      unitType: r.result.providerUnitType ?? null,
      metadata: {
        probe: "cinematic-walkthrough-v2",
        sku: r.sku,
        jobId: r.jobId,
        segmentIndex: r.index,
        durationSeconds: r.segment.durationSec,
        actualDurationSeconds,
        resolution: RESOLUTION,
        photoIds: r.segment.photoIds,
      },
    });
    totalCostCents += costCents;
    console.log(`    Cost: ${costCents}¢ | running total: ${totalCostCents.toFixed(2)}¢`);

    downloaded.push({ segment: r.segment, filePath: destPath, actualDurationSeconds });
  }

  if (graph.usage && graph.usage.costCents > 0) {
    await recordCostEvent({
      propertyId,
      stage: "analysis",
      provider: "google",
      costCents: graph.usage.costCents,
      unitsConsumed: graph.usage.inputTokens + graph.usage.outputTokens,
      unitType: "tokens",
      metadata: {
        probe: "cinematic-walkthrough-v2",
        scope: "spatial_graph_analysis",
        model: graph.usage.model,
        input_tokens: graph.usage.inputTokens,
        output_tokens: graph.usage.outputTokens,
      },
    });
  }

  if (downloaded.length === 0) {
    console.error("\nFAILED: every segment failed — nothing to stitch.");
    console.error(`Wall-clock: ${((Date.now() - started) / 1000).toFixed(1)}s`);
    process.exit(1);
  }

  const outputPath = path.join(tmpDir, `cinematic-walkthrough-${propertyId}-${timestamp}.mp4`);
  stitchWithXfade(downloaded, outputPath);

  console.log(`\n=== DONE ===`);
  console.log(`Segments rendered: ${downloaded.length}/${plan.segments.length}`);
  console.log(`Total cost: ${totalCostCents.toFixed(2)}¢ ($${(totalCostCents / 100).toFixed(2)})`);
  console.log(`Final file: ${outputPath}`);
  console.log(`Wall-clock: ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
