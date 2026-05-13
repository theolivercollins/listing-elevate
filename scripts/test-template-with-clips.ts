// End-to-end smoke: Just Listed #01 template + real property clips.
// Demonstrates assembleFromTemplate filling Clip-1.source ... Clip-N.source
// alongside the text overlays.
//
// Run: npx tsx scripts/test-template-with-clips.ts

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
import { buildTemplateModifications } from "../lib/assembly/template-modifications.js";
import type { RoomType } from "../lib/types.js";

const TEMPLATE_ID = "2f634180-1e85-4f11-b500-2bb57b277581"; // Just Listed #01

const REAL_CLIPS = [
  { scene_number: 1, room_type: "aerial" as RoomType, durationSeconds: 4, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_1_v1.mp4" },
  { scene_number: 2, room_type: "exterior_front" as RoomType, durationSeconds: 4, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_2_v1.mp4" },
  { scene_number: 7, room_type: "bathroom" as RoomType, durationSeconds: 3, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_7_v1.mp4" },
  { scene_number: 8, room_type: "bathroom" as RoomType, durationSeconds: 3, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_8_v1.mp4" },
  { scene_number: 9, room_type: "master_bedroom" as RoomType, durationSeconds: 3, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_9_v1.mp4" },
  { scene_number: 10, room_type: "pool" as RoomType, durationSeconds: 4, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_10_v1.mp4" },
  { scene_number: 12, room_type: "aerial" as RoomType, durationSeconds: 4, clip_url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_12_v1.mp4" },
];

async function main() {
  if (!process.env.CREATOMATE_API_KEY) {
    console.error("FATAL: CREATOMATE_API_KEY not set in .env");
    process.exit(1);
  }
  console.log("=== Template + real clips smoke ===");

  // Order + duration-fit
  const ordered = orderScenesForAssembly(REAL_CLIPS);
  const fitted = fitScenesToDuration(ordered, 30);
  const clips = fitted.map((f) => ({ url: f.scene.clip_url, durationSeconds: f.durationSeconds }));
  console.log(`Walkthrough: ${ordered.map((s) => `${s.scene_number}:${s.room_type}`).join(" → ")}`);
  console.log(`Fit to 30s: ${clips.length} clips, ${clips.reduce((a, b) => a + b.durationSeconds, 0).toFixed(1)}s total`);

  // Build modifications — template-modifications now uses Clip-N naming
  const modifications = buildTemplateModifications({
    address: "2324 Smoketest Lane, Punta Gorda FL",
    selectedPackage: "just_listed",
    agentName: "Brian Helgemo",
    brokerageName: "Helgemo Team",
    clips,
  });
  console.log("\n--- Modifications ---");
  console.log(JSON.stringify(modifications, null, 2));

  const provider = new CreatomateProvider();
  console.log("\n--- Submitting 16:9 render ---");
  const job = await provider.assembleFromTemplate(TEMPLATE_ID, {
    modifications,
    width: 1920,
    height: 1080,
    renderScale: 1,
  });
  console.log("jobId:", job.jobId, "polling...");
  const result = await pollAssemblyJob(provider, job);
  console.log("Result:", result);

  console.log("\n=== DONE ===");
  console.log("Template + clips:", result.videoUrl);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
