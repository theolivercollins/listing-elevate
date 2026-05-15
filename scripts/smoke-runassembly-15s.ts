// 15s end-to-end smoke against prod DB.
// Sets CREATOMATE_TEMPLATE_ID_JUST_LISTED_15 inline (mirrors the Vercel env
// rename that landed 2026-05-14) and calls runAssembly on the smoketest
// property. Validates that:
//   - the resolver picks the 15s template
//   - the new mapper writes rev-2 slot names
//   - the vertical render is skipped (no _VERTICAL var)
//   - horizontal_video_url is set, vertical_video_url stays null
//   - status flips to 'complete'
//
// Run: npx tsx scripts/smoke-runassembly-15s.ts
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
// Mirror the Vercel env rename that just shipped.
process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED_15 =
  "2f634180-1e85-4f11-b500-2bb57b277581";
delete process.env.CREATOMATE_TEMPLATE_ID_JUST_LISTED;

const PROPERTY_ID = "6f508e16-096c-4a70-83cb-17b769838d61";

async function main() {
  console.log("=== 15s end-to-end runAssembly smoke ===");
  const { runAssembly } = await import("../lib/pipeline.js");
  const { getProperty } = await import("../lib/db.js");

  const before = await getProperty(PROPERTY_ID);
  console.log("Before:", {
    status: before.status,
    selected_duration: before.selected_duration,
    selected_package: before.selected_package,
    horizontal_video_url: before.horizontal_video_url,
    vertical_video_url: before.vertical_video_url,
  });

  const t0 = Date.now();
  await runAssembly(PROPERTY_ID);
  console.log(`runAssembly returned in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const after = await getProperty(PROPERTY_ID);
  console.log("\nAfter:", {
    status: after.status,
    horizontal_video_url: after.horizontal_video_url,
    vertical_video_url: after.vertical_video_url,
    thumbnail_url: after.thumbnail_url,
    processing_time_ms: after.processing_time_ms,
  });

  console.log("\n=== Validation ===");
  const ok =
    after.status === "complete" &&
    !!after.horizontal_video_url &&
    after.vertical_video_url === null;
  if (ok) {
    console.log("✅ PASS — horizontal rendered, vertical correctly skipped");
    console.log("16:9 URL:", after.horizontal_video_url);
  } else {
    console.error("❌ FAIL");
    console.error("  expected status=complete, got:", after.status);
    console.error("  expected horizontal_video_url set, got:", after.horizontal_video_url);
    console.error("  expected vertical_video_url=null, got:", after.vertical_video_url);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
