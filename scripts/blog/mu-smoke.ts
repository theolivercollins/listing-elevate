// scripts/blog/mu-smoke.ts
// End-to-end smoke for the Market Update pipeline against a REAL Stellar PDF.
// When SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present the script writes a
// cost_event row so the cost-tracking requirement can be verified end-to-end.
//
// Usage: pnpm exec tsx scripts/blog/mu-smoke.ts "<path-to.pdf>" "<Region Name>" [--strip]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { extractRegion } from "../../lib/blog-engine/market-update/extract.js";
import { validateMetrics } from "../../lib/blog-engine/market-update/validate.js";
import { buildTokenMap } from "../../lib/blog-engine/market-update/format.js";
import { fillTemplate } from "../../lib/blog-engine/market-update/fill.js";
import { stripImages } from "../../lib/blog-engine/market-update/strip-images.js";
import { METRIC_KEYS, PASSTHROUGH_TOKENS } from "../../lib/blog-engine/market-update/types.js";

/** Returns supabase + siteId when DB env vars are present, null otherwise. */
async function tryGetDbContext(): Promise<{ supabase: import("@supabase/supabase-js").SupabaseClient; siteId: string } | null> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const { getSupabase } = await import("../../lib/client.js");
    const supabase = getSupabase();
    const { data: site } = await supabase.from("blog_sites").select("id").eq("host_kind", "sierra").single();
    if (!site?.id) return null;
    return { supabase, siteId: site.id as string };
  } catch {
    return null; // non-fatal — smoke can run without DB
  }
}

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

  console.log(`\nReading ${path} as ${region}...`);
  const pdfBase64 = readFileSync(path).toString("base64");

  // Optionally wire up the DB for cost_events writing.
  const db = await tryGetDbContext();
  if (db) {
    console.log("  DB context found — cost_events will be written.");
  } else {
    console.log("  No DB context (SUPABASE_URL or SERVICE_ROLE_KEY missing) — skipping cost_events write.");
  }

  console.log("Extracting metrics via Claude (real call)...");
  const { metrics, costCents } = await extractRegion(
    pdfBase64,
    region,
    db ? { supabase: db.supabase, siteId: db.siteId, runId: null } : {},
  );
  console.log(`   cost: ${costCents} cents (integer: ${Number.isInteger(costCents)}) · verdict: ${metrics.market_verdict} · ${metrics.report_month} ${metrics.report_year}`);

  // cost_events.cost_cents is an INTEGER column — must be a non-negative integer.
  if (!Number.isInteger(costCents) || costCents < 0) {
    console.error(`ERROR: costCents=${costCents} is not a valid non-negative integer for cost_events`);
    process.exit(1);
  }
  if (costCents === 0) {
    console.warn("  WARNING: costCents=0 — real API calls should have non-zero cost");
  }

  console.log("\nExtracted metrics:");
  for (const k of METRIC_KEYS) {
    const s = metrics.metrics[k];
    console.log(`   ${k.padEnd(20)} ${String(s?.current).padStart(10)}  MoM ${fmt(s?.mom_pct)}  YoY ${fmt(s?.yoy_pct)}`);
  }

  console.log("\nValidating the math...");
  const issues = validateMetrics(metrics);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  if (issues.length === 0) console.log("   OK no issues — every MoM/YoY reconciles");
  for (const i of issues) console.log(`   ${i.severity === "error" ? "ERROR" : "WARN"} ${i.message}`);

  console.log("\nFilling template...");
  const filled = fillTemplate(TEMPLATE, buildTokenMap(metrics));
  let html = filled.html;
  if (filled.unknownTokens.length) console.log(`   WARN unknown tokens: ${filled.unknownTokens.join(", ")}`);

  // Assert zero unresolved non-passthrough {{TOKEN}} remain in the output HTML.
  const unresolvedRe = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;
  const unresolved: string[] = [];
  for (const m of html.matchAll(unresolvedRe)) {
    if (!PASSTHROUGH_TOKENS.has(m[1])) unresolved.push(m[1]);
  }
  if (unresolved.length > 0) {
    console.error(`\nERROR: ${unresolved.length} unresolved non-passthrough token(s) in output: ${unresolved.join(", ")}`);
    process.exit(1);
  }

  if (strip) { html = stripImages(html); console.log("   images stripped"); }
  console.log("   --- filled HTML (first 600 chars) ---");
  console.log(html.replace(/\n/g, " ").slice(0, 600));

  // Verify cost_events row was written when DB context was available.
  if (db && costCents > 0) {
    const since = new Date(Date.now() - 90_000).toISOString(); // within last 90s
    const { data: costRows } = await db.supabase
      .from("cost_events")
      .select("id,cost_cents,stage")
      .eq("site_id", db.siteId)
      .eq("stage", "blog_mu_extract")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    if (costRows?.length) {
      const row = costRows[0];
      if (!Number.isInteger(row.cost_cents) || row.cost_cents <= 0) {
        console.error(`ERROR: cost_events row has invalid cost_cents=${row.cost_cents}`);
        process.exit(1);
      }
      console.log(`\nOK cost_events row verified: id=${row.id} cost_cents=${row.cost_cents} stage=${row.stage}`);
    } else {
      console.error("\nERROR: no cost_events row found within the last 90s for blog_mu_extract — cost tracking broken");
      process.exit(1);
    }
  }

  console.log(`\n${errors.length === 0 ? "SMOKE PASS" : "SMOKE FAIL"} — ${errors.length} error(s), ${warnings.length} warning(s)\n`);
  process.exit(errors.length === 0 ? 0 : 1);
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "  n/a ".padStart(7);
  return `${n > 0 ? "+" : ""}${n}%`.padStart(7);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
