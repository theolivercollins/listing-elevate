#!/usr/bin/env -S npx tsx
/**
 * scripts/probe-walkthrough.ts
 *
 * Standalone PAID probe for Bytedance Seedance 2.0 "reference-to-video"
 * (multi-reference walkthrough) via Atlas Cloud. Lets us empirically test a
 * single continuous real-estate walkthrough generated from an ordered set of
 * listing photos (exterior first, then interior rooms in order).
 *
 * Reuses the Atlas provider transport (lib/providers/atlas.ts) — does NOT
 * duplicate the HTTP submit/poll logic. Instantiates AtlasProvider against
 * the `seedance-reference-walkthrough` SKU and calls its
 * `generateReferenceClip()` / `checkStatus()` / `downloadClip()` methods.
 *
 * This script does NOT write cost_events (it's a manual local probe, not a
 * production pipeline step) — it just PRINTS the computed cost so Oliver can
 * eyeball spend before/after running. If this path gets promoted into the
 * real pipeline, cost recording must move to that call site.
 *
 * Usage:
 *   ATLASCLOUD_API_KEY=... pnpm exec tsx scripts/probe-walkthrough.ts <input.json>
 *   ATLASCLOUD_API_KEY=... pnpm exec tsx scripts/probe-walkthrough.ts \
 *     '{"images":["https://.../ext.jpg","https://.../living.jpg"],"prompt":"...","duration":10,"resolution":"1080p"}'
 *
 * Input JSON shape (file path OR inline string, both accepted):
 *   {
 *     "images": string[],       // 2-9 ordered public image URLs (required)
 *     "prompt"?: string,        // defaults to WALKTHROUGH_PROMPT below
 *     "duration"?: number,      // seconds, 4-15 (default 10)
 *     "resolution"?: "480p"|"720p"|"720p-SR"|"1080p"|"1080p-SR"|"1440p-SR"|"4k"  // AtlasResolution union
 *   }
 *
 * Output: prints the resulting video URL + provider units/cost, downloads
 * the mp4 to ./tmp/walkthrough-probe-<timestamp>.mp4, prints total wall-clock.
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  AtlasProvider,
  atlasClipCostCents,
  SEEDANCE_MAX_REFERENCE_IMAGES,
  type AtlasResolution,
  type GenerateReferenceClipParams,
} from "../lib/providers/atlas.js";
import { pollUntilComplete } from "../lib/providers/provider.interface.js";

const SKU = "seedance-reference-walkthrough" as const;

const WALKTHROUGH_PROMPT =
  "Using all provided listing photos as references (image 1 is the exterior, then interior rooms in order), " +
  "generate a SINGLE CONTINUOUS first-person walkthrough beginning outside the property and smoothly entering " +
  "through the front door. Move the camera in ONE uninterrupted continuous path through the entire home, revealing " +
  "each space in logical order as if filmed on a stabilized gimbal. Preserve exact architecture, room layouts, " +
  "furniture, decor, colors, materials and lighting from the references. Maintain consistent spatial relationships " +
  "and realistic room connections. Prioritize accurate continuous navigation over cinematic effects. Bright " +
  "inviting atmosphere, photorealistic, realistic depth and parallax. Absolutely NO cuts, NO teleporting between " +
  "rooms, NO shot changes, no floating camera, no people, no text, no added objects, no redesigned spaces, no " +
  "distortion, no camera shake. One seamless continuous tour from exterior to every major interior space.";

const DEFAULT_DURATION_SECONDS = 10;

interface WalkthroughInput {
  images: string[];
  prompt?: string;
  duration?: number;
  resolution?: AtlasResolution;
}

function parseArgInput(arg: string): WalkthroughInput {
  let raw: string;
  const looksLikeJson = arg.trim().startsWith("{") || arg.trim().startsWith("[");
  if (looksLikeJson) {
    raw = arg;
  } else {
    const resolved = path.resolve(process.cwd(), arg);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Input file not found: ${resolved}`);
    }
    raw = fs.readFileSync(resolved, "utf8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse input JSON: ${(e as Error).message}`);
  }
  const obj = parsed as Partial<WalkthroughInput>;
  if (!Array.isArray(obj.images) || obj.images.length < 2) {
    throw new Error("Input JSON must include an `images` array with at least 2 URLs.");
  }
  if (obj.images.length > SEEDANCE_MAX_REFERENCE_IMAGES) {
    throw new Error(
      `Input JSON \`images\` has ${obj.images.length} entries — max is ${SEEDANCE_MAX_REFERENCE_IMAGES}.`
    );
  }
  for (const url of obj.images) {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      throw new Error(`Every entry in \`images\` must be a public http(s) URL. Got: ${JSON.stringify(url)}`);
    }
  }
  return {
    images: obj.images as string[],
    prompt: typeof obj.prompt === "string" && obj.prompt.trim() ? obj.prompt : undefined,
    duration: typeof obj.duration === "number" ? obj.duration : undefined,
    resolution: obj.resolution,
  };
}

async function downloadTo(url: string, destPath: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

async function main(): Promise<void> {
  const started = Date.now();

  if (!process.env.ATLASCLOUD_API_KEY) {
    console.error(
      "ERROR: ATLASCLOUD_API_KEY is not set. This probe calls the live Atlas Cloud API and costs money — " +
        "export ATLASCLOUD_API_KEY (see ~/credentials.md) before running."
    );
    process.exit(1);
  }

  const arg = process.argv[2];
  if (!arg) {
    console.error(
      "Usage: pnpm exec tsx scripts/probe-walkthrough.ts <input.json | inline-json>\n" +
        '  e.g. \'{"images":["https://.../ext.jpg","https://.../living.jpg"],"duration":10,"resolution":"1080p"}\''
    );
    process.exit(1);
  }

  const input = parseArgInput(arg);
  const prompt = input.prompt ?? WALKTHROUGH_PROMPT;
  const durationSeconds = input.duration ?? DEFAULT_DURATION_SECONDS;

  console.log(`=== Seedance 2.0 reference-to-video walkthrough probe ===`);
  console.log(`SKU: ${SKU}`);
  console.log(`Images (${input.images.length}, in order):`);
  input.images.forEach((u, i) => console.log(`  [${i + 1}] ${u}`));
  console.log(`Duration: ${durationSeconds}s`);
  console.log(`Resolution: ${input.resolution ?? "(descriptor default)"}`);
  console.log(`Prompt: ${input.prompt ? "(custom, from input)" : "(default walkthrough prompt)"}`);
  console.log("");

  const provider = new AtlasProvider(SKU);

  const referenceParams: GenerateReferenceClipParams = {
    referenceImageUrls: input.images,
    prompt,
    durationSeconds,
    resolution: input.resolution,
  };

  console.log("Submitting to Atlas...");
  const job = await provider.generateReferenceClip(referenceParams);
  console.log(`  Job ID: ${job.jobId} (estimated ${job.estimatedSeconds}s)`);

  console.log("Polling until complete (this can take several minutes for multi-reference renders)...");
  const result = await pollUntilComplete(provider, job.jobId, /* timeoutMs */ 600_000, /* intervalMs */ 8_000);

  const wallClockSeconds = ((Date.now() - started) / 1000).toFixed(1);

  if (result.status !== "complete" || !result.videoUrl) {
    console.error(`\nFAILED: ${result.error ?? "no video URL returned"}`);
    console.error(`Wall-clock: ${wallClockSeconds}s`);
    process.exit(1);
  }

  console.log(`\nSUCCESS`);
  console.log(`Video URL: ${result.videoUrl}`);

  const costCents = result.costCents ?? atlasClipCostCents(SKU, durationSeconds);
  console.log(`Cost (est.): ${costCents}¢ ($${(costCents / 100).toFixed(2)}) for ${durationSeconds}s`);
  if (result.providerUnits !== undefined) {
    console.log(`Provider units: ${result.providerUnits} (${result.providerUnitType ?? "unknown unit"})`);
  }

  const timestamp = Date.now();
  const destPath = path.resolve(process.cwd(), "tmp", `walkthrough-probe-${timestamp}.mp4`);
  console.log(`\nDownloading to ${destPath} ...`);
  const bytes = await downloadTo(result.videoUrl, destPath);
  console.log(`Saved ${(bytes / 1e6).toFixed(2)} MB to ${destPath}`);

  console.log(`\nTotal wall-clock: ${wallClockSeconds}s`);
}

main().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
