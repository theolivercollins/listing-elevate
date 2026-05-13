// Smoke: Shotstack port of the Creatomate Just Listed layout.
// Uses real Kling clips from prop 6f508e16 ("Smoketest Lane").
// Run: npx tsx scripts/test-shotstack-just-listed.ts

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

import {
  ShotstackProvider,
  buildShotstackJustListedTimeline,
  pollAssemblyUntilComplete,
} from "../lib/providers/shotstack.js";
import { orderScenesForAssembly } from "../lib/assembly/scene-ordering.js";
import { fitScenesToDuration } from "../lib/assembly/duration-fit.js";
import { splitAddress } from "../lib/assembly/template-modifications.js";
import type { RoomType } from "../lib/types.js";

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
  if (!process.env.SHOTSTACK_API_KEY) {
    console.error("FATAL: SHOTSTACK_API_KEY not set in .env");
    process.exit(1);
  }
  console.log("=== Shotstack Just Listed port ===");
  console.log("env:", process.env.SHOTSTACK_ENV ?? "stage");

  const ordered = orderScenesForAssembly(REAL_CLIPS);
  const fitted = fitScenesToDuration(ordered, 30);
  const clips = fitted.map((f) => ({ url: f.scene.clip_url, durationSeconds: f.durationSeconds }));
  console.log(`Walkthrough: ${ordered.map((s) => `${s.scene_number}:${s.room_type}`).join(" → ")}`);
  console.log(`Fit to 30s: ${clips.length} clips, ${clips.reduce((a, b) => a + b.durationSeconds, 0).toFixed(1)}s`);

  const [street, cityState] = splitAddress("2324 Smoketest Lane, Punta Gorda FL");

  const payload = buildShotstackJustListedTimeline({
    clips,
    overlays: {
      street,
      cityState,
      category: "Just Listed",
      agent: "Brian Helgemo",
      brokerage: "Helgemo Team",
    },
    aspectRatio: "16:9",
  });
  console.log("\n--- Timeline preview ---");
  console.log(JSON.stringify({
    output: payload.output,
    tracks: payload.timeline.tracks.map((t) => ({
      clipCount: t.clips.length,
      types: t.clips.map((c) => (c as { asset: { type: string } }).asset.type),
    })),
  }, null, 2));

  const provider = new ShotstackProvider();
  console.log("\n--- Submitting 16:9 render ---");
  const job = await provider.assemble({
    clips,
    overlays: {
      address: `${street}, ${cityState}`,
      price: "Just Listed",
      details: "",
      agent: "Brian Helgemo",
      brokerage: "Helgemo Team",
    },
    aspectRatio: "16:9",
  });
  console.log("Standard assemble jobId:", job.jobId);

  // Now do the JUST LISTED variant directly via Shotstack API
  const url = `https://api.shotstack.io/edit/${process.env.SHOTSTACK_ENV === "production" ? "v1" : "stage"}/render`;
  const apiKey = process.env.SHOTSTACK_API_KEY;
  if (!apiKey) {
    console.error("no api key");
    process.exit(1);
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json() as { success?: boolean; response?: { id?: string; message?: string }; message?: string };
  if (!data.success || !data.response?.id) {
    console.error("FAIL submit:", data);
    process.exit(1);
  }
  const jobId = data.response.id;
  console.log("Just Listed jobId:", jobId);

  console.log("Polling...");
  const result = await pollAssemblyUntilComplete(provider, { jobId, environment: process.env.SHOTSTACK_ENV === "production" ? "v1" : "stage" });
  console.log("Just Listed result:", result);

  console.log("\n=== DONE ===");
  console.log("Just Listed URL:", result.videoUrl);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
