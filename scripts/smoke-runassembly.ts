// Phase 6 end-to-end smoke: invoke runAssembly directly against a real
// property in prod Supabase. Exercises:
//   - Phase 2 deterministic scene ordering (room_type lookup)
//   - Phase 3 duration enforcement (selected_duration = 30)
//   - Phase 4 brokerage branding (falls back to defaults since submitted_by
//     is null on this property)
//   - Phase 5 music auto-pick (selected_package=just_listed -> upbeat)
//   - The dead-code fix (runAssembly is exported + reachable)
//
// Run: npx tsx scripts/smoke-runassembly.ts
//
// Re-uses .env for SUPABASE_SERVICE_ROLE_KEY + CREATOMATE_API_KEY.

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

const PROPERTY_ID = "6f508e16-096c-4a70-83cb-17b769838d61";

async function main() {
  console.log("=== Phase 6 end-to-end smoke ===");
  console.log("propertyId:", PROPERTY_ID);

  const { runAssembly } = await import("../lib/pipeline.js");
  const { getProperty } = await import("../lib/db.js");

  const before = await getProperty(PROPERTY_ID);
  console.log("\nBefore:", {
    status: before.status,
    selected_duration: before.selected_duration,
    selected_package: before.selected_package,
    brokerage: before.brokerage,
    horizontal_video_url: before.horizontal_video_url,
    vertical_video_url: before.vertical_video_url,
  });

  console.log("\n--- Invoking runAssembly ---");
  const t0 = Date.now();
  await runAssembly(PROPERTY_ID);
  const elapsedMs = Date.now() - t0;
  console.log(`runAssembly returned in ${(elapsedMs / 1000).toFixed(1)}s`);

  const after = await getProperty(PROPERTY_ID);
  console.log("\nAfter:", {
    status: after.status,
    horizontal_video_url: after.horizontal_video_url,
    vertical_video_url: after.vertical_video_url,
    thumbnail_url: after.thumbnail_url,
    processing_time_ms: after.processing_time_ms,
    assembly_provider:
      (after as { assembly_provider?: string }).assembly_provider ?? null,
    assembly_timeline_version:
      (after as { assembly_timeline_version?: number }).assembly_timeline_version ?? null,
  });

  console.log("\n=== DONE ===");
  if (after.horizontal_video_url && after.vertical_video_url) {
    console.log("16:9:", after.horizontal_video_url);
    console.log("9:16:", after.vertical_video_url);
  } else {
    console.error("FAIL: at least one aspect ratio URL missing");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
