// Phase: template-mode smoke for the "15 seconds - Just Listed" template.
// Run: npx tsx scripts/test-creatomate-15s-template.ts
//
// Submits the 15s template (075d3024…) through the SAME buildTemplateModifications
// mapper the pipeline uses, with real sample clips + phone + headshot, and
// confirms every dynamic element the template exposes is fed by the builder.
// One 16:9 render only (template canvas is 1280x720; 16:9 horizontal).

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

const TEMPLATE_ID = "075d3024-b727-4dde-bdc1-cd15a4929882"; // 15 seconds - Just Listed

// Public sample MP4 (GitHub Pages — reliable, no rate-limit) for Clip-1..5.
const SAMPLE_VIDEO = "https://mdn.github.io/shared-assets/videos/flower.mp4";
const SAMPLE_CLIPS = Array.from({ length: 5 }, () => ({
  url: SAMPLE_VIDEO,
  durationSeconds: 3,
}));

async function main() {
  if (!process.env.CREATOMATE_API_KEY) {
    console.error("FATAL: CREATOMATE_API_KEY not set in .env");
    process.exit(1);
  }
  console.log("=== Creatomate 15s template smoke ===");
  console.log("template_id:", TEMPLATE_ID);

  const provider = new CreatomateProvider();

  // 1. Inspect template metadata — list the dynamic elements.
  const meta = await provider.getTemplate(TEMPLATE_ID);
  const elementNames = meta.elements.map((e) => e.name);
  console.log("\n--- Template ---");
  console.log("name:", meta.name, "| canvas:", `${meta.width}x${meta.height}`);
  console.log("elements:", elementNames.join(", "));

  // 2. Build modifications via the pipeline's mapper.
  const modifications = buildTemplateModifications({
    address: "2750 Palm Tree Dr, Punta Gorda, FL",
    selectedPackage: "just_listed",
    agentName: "Brian Helgemo, Realtor",
    brokerageName: "- The Helgemo Team | Compass",
    agentPhone: "c: 941.205.9011",
    agentHeadshotUrl: "https://i.pravatar.cc/600?img=12",
    clips: SAMPLE_CLIPS,
  });

  // 3. Coverage check: which of THIS template's elements does the builder feed?
  //    (Property keys are "<Element>.text" / "<Element>.source".)
  const fedElements = new Set(
    Object.keys(modifications).map((k) => k.replace(/\.(text|source|duration)$/, "")),
  );
  console.log("\n--- Element coverage ---");
  for (const name of elementNames) {
    const fed = fedElements.has(name);
    console.log(`${fed ? "✓ fed   " : "· static"}  ${name}`);
  }

  // 4. Submit one 16:9 render at the template's native canvas.
  console.log("\n--- Submitting render ---");
  const job = await provider.assembleFromTemplate(TEMPLATE_ID, {
    modifications,
    renderScale: 1,
  });
  console.log("jobId:", job.jobId);
  console.log("Polling…");
  const result = await pollAssemblyJob(provider, job);

  console.log("\n=== DONE ===");
  console.log("status:", result.status);
  console.log("video URL:", result.videoUrl);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
