// Smoke: real property clips piecing together a real listing video, with
// the duration auto-fit demonstrated by rendering the SAME clips at two
// different tier durations.
//
//   • Pulls 7 qc_pass clips from prod property 6f508e16 ("Smoketest Lane")
//   • Hydrates room_type from photos
//   • Orders them via orderScenesForAssembly (deterministic walkthrough)
//   • For each target tier (15s and 30s) fits clips via fitScenesToDuration
//   • Renders via the code-generated CreatomateProvider path (the template
//     has no clip slots yet, so we go through buildCreatomateTimeline)
//   • Audio: SoundHelix upbeat placeholder
//
// Run: npx tsx scripts/test-real-property.ts

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

import { CreatomateProvider } from "../lib/providers/creatomate.js";
import { pollAssemblyJob } from "../lib/providers/assembly-router.js";
import { orderScenesForAssembly } from "../lib/assembly/scene-ordering.js";
import { fitScenesToDuration } from "../lib/assembly/duration-fit.js";
import type { RoomType } from "../lib/types.js";

interface RealScene {
  scene_number: number;
  room_type: RoomType | null;
  durationSeconds: number;
  clip_url: string;
}

// Hardcoded from Supabase query for property 6f508e16 (Smoketest Lane).
const REAL_CLIPS: RealScene[] = [
  { scene_number: 1, room_type: "aerial", durationSeconds: 4, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_1_v1.mp4" },
  { scene_number: 2, room_type: "exterior_front", durationSeconds: 4, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_2_v1.mp4" },
  { scene_number: 7, room_type: "bathroom", durationSeconds: 3, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_7_v1.mp4" },
  { scene_number: 8, room_type: "bathroom", durationSeconds: 3, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_8_v1.mp4" },
  { scene_number: 9, room_type: "master_bedroom", durationSeconds: 3, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_9_v1.mp4" },
  { scene_number: 10, room_type: "pool", durationSeconds: 4, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_10_v1.mp4" },
  { scene_number: 12, room_type: "aerial", durationSeconds: 4, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_12_v1.mp4" },
];

const OVERLAYS = {
  address: "2324 Smoketest Lane, Punta Gorda FL",
  price: "$1,250,000",
  details: "3 BD | 2 BA",
  agent: "Brian Helgemo",
  brokerage: "Helgemo Team",
  primaryColor: "#10b981",
  secondaryColor: "#ffffff",
};

const MUSIC = {
  url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  volume: 0.18,
};

async function renderAtDuration(provider: CreatomateProvider, targetSeconds: number) {
  console.log(`\n\n========== TIER: ${targetSeconds}s ==========`);

  const ordered = orderScenesForAssembly(REAL_CLIPS);
  console.log("Walkthrough order:",
    ordered.map((s) => `${s.scene_number}:${s.room_type}`).join(" → "));

  const fitted = fitScenesToDuration(ordered, targetSeconds);
  const totalFit = fitted.reduce((a, b) => a + b.durationSeconds, 0);
  console.log(`Fit: ${fitted.length} clips, total ${totalFit.toFixed(2)}s`);
  fitted.forEach((f) => {
    console.log(`  #${f.scene.scene_number} ${f.scene.room_type?.padEnd(15)} ${f.durationSeconds.toFixed(2)}s`);
  });

  const clips = fitted.map((f) => ({
    url: f.scene.clip_url,
    durationSeconds: f.durationSeconds,
  }));

  // 16:9 only — comparing duration enforcement, not aspect ratio.
  const job = await provider.assemble({
    clips,
    overlays: OVERLAYS,
    aspectRatio: "16:9",
    music: MUSIC,
  });
  console.log(`Submitted: ${job.jobId}, polling...`);
  const result = await pollAssemblyJob(provider, job);
  if (result.status !== "complete") {
    console.error(`FAILED: ${result.error ?? "unknown"}`);
    return null;
  }
  console.log(`✓ ${targetSeconds}s URL: ${result.videoUrl}`);
  return result.videoUrl;
}

async function main() {
  if (!process.env.CREATOMATE_API_KEY) {
    console.error("FATAL: CREATOMATE_API_KEY not set in .env");
    process.exit(1);
  }
  console.log("=== Real-property smoke (duration enforcement on real clips) ===");
  console.log(`Property: ${OVERLAYS.address}`);
  console.log(`Clips: ${REAL_CLIPS.length} (natural sum: ${REAL_CLIPS.reduce((a, b) => a + b.durationSeconds, 0)}s)`);

  const provider = new CreatomateProvider();

  const url15 = await renderAtDuration(provider, 15);
  const url30 = await renderAtDuration(provider, 30);

  console.log("\n\n========== DONE ==========");
  console.log("15s tier:", url15);
  console.log("30s tier:", url30);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
