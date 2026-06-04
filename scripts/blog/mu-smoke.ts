// scripts/blog/mu-smoke.ts
// End-to-end smoke for the Market Update pipeline against a REAL Stellar PDF.
// No DB / no deploy: extract (real Claude) -> validate -> fill seed template
// -> strip images. Proves the AI extraction reconciles against the source math.
//
// Usage: pnpm exec tsx scripts/blog/mu-smoke.ts "<path-to.pdf>" "<Region Name>" [--strip]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { extractRegion } from "../../lib/blog-engine/market-update/extract.js";
import { validateMetrics } from "../../lib/blog-engine/market-update/validate.js";
import { buildTokenMap } from "../../lib/blog-engine/market-update/format.js";
import { fillTemplate } from "../../lib/blog-engine/market-update/fill.js";
import { stripImages } from "../../lib/blog-engine/market-update/strip-images.js";
import { METRIC_KEYS } from "../../lib/blog-engine/market-update/types.js";

// A minimal template exercising the canonical tokens + FAQ + image markers.
const TEMPLATE = `<article>
<!-- MU:IMAGE hero --><figure><img src="x" alt="hero"/></figure>
<h1>{{REGION_NAME}} — {{REPORT_MONTH}} {{REPORT_YEAR}} ({{MARKET_VERDICT}})</h1>
<p>For sale {{FOR_SALE}} ({{FOR_SALE_MOM}} MoM, {{FOR_SALE_YOY}} YoY) · Sold {{SOLD}} ({{SOLD_MOM}} MoM) · Median {{MEDIAN_SOLD_PRICE}} · DOM {{DOM}} · MOI {{MOI_CLOSED}}</p>
<!-- MU:FAQ_START --><h3>Q</h3><p>A</p><!-- MU:FAQ_END -->
</article>`;

async function main() {
  const path = process.argv[2];
  const region = process.argv[3] ?? "Test Region";
  const strip = process.argv.includes("--strip");
  if (!path) throw new Error('usage: mu-smoke.ts "<path.pdf>" "<Region Name>" [--strip]');

  console.log(`\n📄 Reading ${path} as ${region}…`);
  const pdfBase64 = readFileSync(path).toString("base64");

  console.log("🤖 Extracting metrics via Claude (real call)…");
  const { metrics, costCents } = await extractRegion(pdfBase64, region);
  console.log(`   cost: ${costCents}¢ · verdict: ${metrics.market_verdict} · ${metrics.report_month} ${metrics.report_year}`);

  console.log("\n📊 Extracted metrics:");
  for (const k of METRIC_KEYS) {
    const s = metrics.metrics[k];
    console.log(`   ${k.padEnd(20)} ${String(s?.current).padStart(10)}  MoM ${fmt(s?.mom_pct)}  YoY ${fmt(s?.yoy_pct)}`);
  }

  console.log("\n🔍 Validating the math…");
  const issues = validateMetrics(metrics);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  if (issues.length === 0) console.log("   ✅ no issues — every MoM/YoY reconciles");
  for (const i of issues) console.log(`   ${i.severity === "error" ? "❌" : "⚠️ "} ${i.message}`);

  console.log("\n🧩 Filling template…");
  const filled = fillTemplate(TEMPLATE, buildTokenMap(metrics));
  let html = filled.html;
  if (filled.unknownTokens.length) console.log(`   ⚠️  unknown tokens: ${filled.unknownTokens.join(", ")}`);
  if (strip) { html = stripImages(html); console.log("   🖼  images stripped"); }
  console.log("   --- filled HTML (first 600 chars) ---");
  console.log(html.replace(/\n/g, " ").slice(0, 600));

  console.log(`\n${errors.length === 0 ? "✅ SMOKE PASS" : "❌ SMOKE FAIL"} — ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  process.exit(errors.length === 0 ? 0 : 1);
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "  n/a ".padStart(7);
  return `${n > 0 ? "+" : ""}${n}%`.padStart(7);
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
