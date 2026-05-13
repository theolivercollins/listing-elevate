// Smoke test for the Creatomate provider.
// Run: npx tsx scripts/test-creatomate.ts
//
// Uses public sample real-estate-ish clips. Renders both 16:9 + 9:16 and
// prints the result URLs. Requires CREATOMATE_API_KEY in .env (gitignored).

import * as fs from "fs";
import * as path from "path";
// Minimal .env loader — no dotenv dep needed
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

import {
  CreatomateProvider,
  buildCreatomateTimeline,
  creatomateCostCents,
} from "../lib/providers/creatomate.js";
import { pollAssemblyJob } from "../lib/providers/assembly-router.js";

// Three short stock clips that Creatomate can fetch publicly. Shotstack's
// sample-asset bucket is open and reliable for smoke testing.
const SAMPLE_CLIPS = [
  {
    url: "https://shotstack-assets.s3.ap-southeast-2.amazonaws.com/footage/beach-overhead.mp4",
    durationSeconds: 4,
  },
  {
    url: "https://shotstack-assets.s3.ap-southeast-2.amazonaws.com/footage/table-mountain.mp4",
    durationSeconds: 4,
  },
  {
    url: "https://shotstack-assets.s3.ap-southeast-2.amazonaws.com/footage/skater.hd.mp4",
    durationSeconds: 4,
  },
];

const OVERLAYS = {
  address: "123 Palm Avenue, Miami FL",
  price: "$1,250,000",
  details: "4 BD | 3 BA",
  agent: "Jane Smith",
  brokerage: "Compass",
  // Phase 4: logo watermark + brand-color accent. Compass-ish blue + their
  // public logo for an obvious visual check that the overlay landed.
  logoUrl: "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png",
  primaryColor: "#0F2C5C",
  secondaryColor: "#ffffff",
};

async function main() {
  if (!process.env.CREATOMATE_API_KEY) {
    console.error("FATAL: CREATOMATE_API_KEY not set in .env");
    process.exit(1);
  }
  console.log("=== Creatomate smoke test ===");
  console.log("key:", process.env.CREATOMATE_API_KEY.slice(0, 8) + "…");

  // 1. Inspect timeline (pure, no API call)
  const timeline = buildCreatomateTimeline({
    clips: SAMPLE_CLIPS,
    overlays: OVERLAYS,
    aspectRatio: "16:9",
  });
  console.log("\n--- Timeline preview ---");
  console.log(JSON.stringify({
    output_format: timeline.output_format,
    dimensions: `${timeline.width}x${timeline.height}`,
    elementCount: timeline.elements.length,
    elementTypes: timeline.elements.map((e) => e.type),
  }, null, 2));

  // Cost preview
  const totalDuration = SAMPLE_CLIPS.reduce((s, c) => s + c.durationSeconds, 0);
  console.log(`\nEstimated cost: ${creatomateCostCents(totalDuration)}¢ for ${totalDuration}s output × 2 aspect ratios = ${creatomateCostCents(totalDuration) * 2}¢ total`);

  // Phase 5: music track for smoke test
  const MUSIC = {
    url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    volume: 0.18,
  };

  // 2. Live render — 16:9
  const provider = new CreatomateProvider();

  console.log("\n--- Submitting 16:9 render ---");
  const horizontalJob = await provider.assemble({
    clips: SAMPLE_CLIPS,
    overlays: OVERLAYS,
    aspectRatio: "16:9",
    music: MUSIC,
  });
  console.log("jobId:", horizontalJob.jobId);

  console.log("Polling... (usually 30–90s)");
  const horizontalResult = await pollAssemblyJob(provider, horizontalJob);
  console.log("16:9 result:", horizontalResult);
  if (horizontalResult.status !== "complete") {
    console.error("FAILED — aborting 9:16 render");
    process.exit(1);
  }

  // 3. Live render — 9:16
  console.log("\n--- Submitting 9:16 render ---");
  const verticalJob = await provider.assemble({
    clips: SAMPLE_CLIPS,
    overlays: OVERLAYS,
    aspectRatio: "9:16",
    music: MUSIC,
  });
  console.log("jobId:", verticalJob.jobId);

  console.log("Polling...");
  const verticalResult = await pollAssemblyJob(provider, verticalJob);
  console.log("9:16 result:", verticalResult);

  console.log("\n=== DONE ===");
  console.log("16:9 URL:", horizontalResult.videoUrl);
  console.log("9:16 URL:", verticalResult.videoUrl);
  console.log("\nOpen those URLs to inspect overlay quality + transition timing.");
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
