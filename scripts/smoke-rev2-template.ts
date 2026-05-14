// End-to-end smoke for the rev-2 template path.
// Exercises: resolveTemplateId (15s + horizontal) → buildTemplateModifications
// (rev-2 placeholder names) → CreatomateProvider.assembleFromTemplate.
// Uses real clip URLs from the smoketest property in prod Supabase storage.
// Run: npx tsx /Users/oliverhelgemo/.claude/jobs/8acede0a/smoke-new-pipeline.ts

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

// Simulate the planned Vercel env var change — duration-suffixed.
process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_15 =
  "2f634180-1e85-4f11-b500-2bb57b277581";
// Explicitly clear any legacy var so the suffixed-only path is exercised.
delete process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED;

import { CreatomateProvider } from "../lib/providers/creatomate.js";
import { pollAssemblyJob } from "../lib/providers/assembly-router.js";
import { buildTemplateModifications } from "../lib/assembly/template-modifications.js";
import { resolveTemplateId } from "../lib/assembly/template-resolver.js";

const PROPERTY_ADDRESS = "2324 Smoketest Lane, Punta Gorda FL";
const AGENT_NAME = "Brian Helgemo";
const BROKERAGE = "Compass";
const SELECTED_PACKAGE = "just_listed";
const SELECTED_DURATION = 15;

const CLIPS = [
  { url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_1_v1.mp4",  durationSeconds: 2 },
  { url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_2_v1.mp4",  durationSeconds: 1.75 },
  { url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_7_v1.mp4",  durationSeconds: 1.75 },
  { url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_8_v1.mp4",  durationSeconds: 1.75 },
  { url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_9_v1.mp4",  durationSeconds: 1.75 },
  { url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_10_v1.mp4", durationSeconds: 1.75 },
  { url: "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/6f508e16-096c-4a70-83cb-17b769838d61/clips/scene_12_v1.mp4", durationSeconds: 1.75 },
];

async function main() {
  if (!process.env.CREATOMATE_API_KEY) {
    console.error("FATAL: CREATOMATE_API_KEY not set in .env");
    process.exit(1);
  }

  console.log("=== Rev-2 template smoke ===");

  // ---- 1. Resolver behavior with new env scheme ----
  const horizontalTemplateId = resolveTemplateId({
    selectedPackage: SELECTED_PACKAGE,
    selectedDuration: SELECTED_DURATION,
    aspectRatio: "16:9",
  });
  const verticalTemplateId = resolveTemplateId({
    selectedPackage: SELECTED_PACKAGE,
    selectedDuration: SELECTED_DURATION,
    aspectRatio: "9:16",
  });
  console.log("resolved horizontal:", horizontalTemplateId);
  console.log("resolved vertical  :", verticalTemplateId, "(expected null — no _VERTICAL var set)");

  if (!horizontalTemplateId) {
    console.error("FATAL: horizontal template did not resolve.");
    process.exit(1);
  }

  // ---- 2. Modifications via the new mapper ----
  const modifications = buildTemplateModifications({
    address: PROPERTY_ADDRESS,
    selectedPackage: SELECTED_PACKAGE,
    agentName: AGENT_NAME,
    brokerageName: BROKERAGE,
    clips: CLIPS,
  });
  console.log("\n--- Modifications dict ---");
  console.log(JSON.stringify(modifications, null, 2));

  // ---- 3. Render horizontal only (vertical is skipped per the new pipeline) ----
  const provider = new CreatomateProvider();
  console.log("\n--- Submitting 16:9 render via assembleFromTemplate ---");
  const job = await provider.assembleFromTemplate(horizontalTemplateId, {
    modifications,
    renderScale: 1,
  });
  console.log("jobId:", job.jobId);
  const result = await pollAssemblyJob(provider, job);
  console.log("status :", result.status);
  if (result.status !== "complete") {
    console.error("FAILED:", result.error);
    process.exit(1);
  }
  console.log("\n=== DONE ===");
  console.log("16:9 URL:", result.videoUrl);
  console.log("(9:16 skipped — no vertical template configured)");
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
