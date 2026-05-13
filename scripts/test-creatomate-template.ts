// Phase: template-mode smoke for the Just Listed #01 template.
// Run: npx tsx scripts/test-creatomate-template.ts
//
// Submits the user's existing template at 1920x1080 (override render_scale
// to 1.0 so we don't get the 480x270 thumbnail Creatomate defaults to).
//
// Demonstrates: assembleFromTemplate + buildTemplateModifications +
// resolveTemplateId end-to-end without touching DB state.

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
import { buildTemplateModifications } from "../lib/assembly/template-modifications.js";

const TEMPLATE_ID = "2f634180-1e85-4f11-b500-2bb57b277581"; // Just Listed #01

async function main() {
  if (!process.env.CREATOMATE_API_KEY) {
    console.error("FATAL: CREATOMATE_API_KEY not set in .env");
    process.exit(1);
  }
  console.log("=== Creatomate template-mode smoke ===");
  console.log("template_id:", TEMPLATE_ID);

  const provider = new CreatomateProvider();

  // 1. Inspect template metadata
  console.log("\n--- Template metadata ---");
  const meta = await provider.getTemplate(TEMPLATE_ID);
  console.log(JSON.stringify({
    name: meta.name,
    canvas: `${meta.width}x${meta.height}`,
    elements: meta.elements.map((e) => ({ name: e.name, type: e.type, dynamic: e.dynamic })),
  }, null, 2));

  // 2. Build modifications via the same mapper runAssembly uses
  const modifications = buildTemplateModifications({
    address: "123 Waymay Dr, Punta Gorda FL",
    selectedPackage: "just_listed",
    agentName: "Brian Helgemo",
    brokerageName: "Compass",
  });
  console.log("\n--- Modifications ---");
  console.log(JSON.stringify(modifications, null, 2));

  // 3. Submit 16:9 + 9:16 at production resolution
  console.log("\n--- Submitting 16:9 render ---");
  const horizontalJob = await provider.assembleFromTemplate(TEMPLATE_ID, {
    modifications,
    width: 1920,
    height: 1080,
    renderScale: 1,
  });
  console.log("jobId:", horizontalJob.jobId);
  console.log("Polling...");
  const horizontalResult = await pollAssemblyJob(provider, horizontalJob);
  console.log("16:9 result:", horizontalResult);

  console.log("\n--- Submitting 9:16 render ---");
  const verticalJob = await provider.assembleFromTemplate(TEMPLATE_ID, {
    modifications,
    width: 1080,
    height: 1920,
    renderScale: 1,
  });
  console.log("jobId:", verticalJob.jobId);
  console.log("Polling...");
  const verticalResult = await pollAssemblyJob(provider, verticalJob);
  console.log("9:16 result:", verticalResult);

  console.log("\n=== DONE ===");
  console.log("16:9 URL:", horizontalResult.videoUrl);
  console.log("9:16 URL:", verticalResult.videoUrl);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
