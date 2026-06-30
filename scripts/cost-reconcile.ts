#!/usr/bin/env -S npx tsx
/**
 * cost-reconcile.ts
 *
 * Dumps our recorded cost_events + iteration.cost_cents totals
 * by provider + SKU + date range. Cross-check against provider
 * invoices to catch drift.
 *
 * Usage:
 *   npx tsx scripts/cost-reconcile.ts [--since 2026-04-20] [--until 2026-04-21]
 *
 * Output: console table + written to /tmp/cost-reconcile-<date>.md
 */

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

import { getSupabase } from "../lib/client.js";

function parseArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const since = parseArg("--since") ?? isoDate(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const until = parseArg("--until") ?? isoDate(new Date());
  console.log(`Reconciling cost_events from ${since} to ${until}...`);

  const supabase = getSupabase();

  // cost_events by provider × stage × unit_type.
  // Always exclude is_test rows: test-data spend must never pollute real margin
  // numbers regardless of where this script is run.
  const { data: events } = await supabase
    .from("cost_events")
    .select("provider, stage, unit_type, units_consumed, cost_cents, metadata, created_at")
    .eq("is_test", false)
    .gte("created_at", since)
    .lte("created_at", `${until}T23:59:59Z`);

  const buckets = new Map<string, { events: number; units: number; cents: number; samples: string[] }>();
  for (const e of events ?? []) {
    const model = (e.metadata as { model?: string } | null)?.model ?? "—";
    const key = `${e.provider} / ${e.stage} / ${model} / ${e.unit_type}`;
    const b = buckets.get(key) ?? { events: 0, units: 0, cents: 0, samples: [] };
    b.events += 1;
    b.units += e.units_consumed ?? 0;
    b.cents += e.cost_cents ?? 0;
    if (b.samples.length < 2) b.samples.push(new Date(e.created_at).toISOString());
    buckets.set(key, b);
  }

  // Also aggregate prompt_lab_listing_scene_iterations directly (what the UI shows)
  const { data: iters } = await supabase
    .from("prompt_lab_listing_scene_iterations")
    .select("model_used, cost_cents, status, created_at")
    .gte("created_at", since)
    .lte("created_at", `${until}T23:59:59Z`);
  const iterBuckets = new Map<string, { count: number; cents: number }>();
  for (const i of iters ?? []) {
    const key = i.model_used;
    const b = iterBuckets.get(key) ?? { count: 0, cents: 0 };
    b.count += 1;
    b.cents += i.cost_cents ?? 0;
    iterBuckets.set(key, b);
  }

  const md: string[] = [];
  md.push(`# Cost Reconciliation — ${since} to ${until}`);
  md.push("");
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push("");
  md.push("## Why this exists");
  md.push("");
  md.push("Run this before each provider-invoice review. Cross-check the totals below against the provider's dashboard. **>5% drift = investigate** before continuing high-volume work (Phase B).");
  md.push("");
  md.push("## cost_events aggregation");
  md.push("");
  md.push("| provider | stage | model | unit_type | events | units | cents | dollars |");
  md.push("|---|---|---|---|---:|---:|---:|---:|");
  const sortedBuckets = [...buckets.entries()].sort((a, b) => b[1].cents - a[1].cents);
  let totalCents = 0;
  for (const [key, b] of sortedBuckets) {
    const [provider, stage, model, unit_type] = key.split(" / ");
    md.push(`| ${provider} | ${stage} | ${model} | ${unit_type} | ${b.events} | ${b.units.toLocaleString()} | ${b.cents.toLocaleString()} | $${(b.cents / 100).toFixed(2)} |`);
    totalCents += b.cents;
  }
  md.push(`| **TOTAL** | | | | | | **${totalCents}** | **$${(totalCents / 100).toFixed(2)}** |`);
  md.push("");
  md.push("## prompt_lab_listing_scene_iterations by SKU (UI dashboard view)");
  md.push("");
  md.push("| model_used | iterations | cents | dollars |");
  md.push("|---|---:|---:|---:|");
  const sortedIters = [...iterBuckets.entries()].sort((a, b) => b[1].cents - a[1].cents);
  let iterTotalCents = 0;
  for (const [model, b] of sortedIters) {
    md.push(`| ${model} | ${b.count} | ${b.cents} | $${(b.cents / 100).toFixed(2)} |`);
    iterTotalCents += b.cents;
  }
  md.push(`| **TOTAL** | | **${iterTotalCents}** | **$${(iterTotalCents / 100).toFixed(2)}** |`);
  md.push("");
  md.push("## Cross-check against provider invoices");
  md.push("");
  md.push("- **Atlas Cloud:** sum the `provider='atlas'` rows above. Compare against your Atlas wallet history for the same date range.");
  md.push("- **Anthropic:** sum `provider='anthropic'` rows. Compare against your Anthropic console billing.");
  md.push("- **Google (Gemini):** sum `provider='google'` rows (DA.1, 2026-04-21+). Photo analyzer \"eyes\" — expect ~0.1-0.5¢ per photo at Gemini 3 Flash rates ($0.50/M input, $3.00/M output). Compare against Google AI Studio / Cloud billing.");
  md.push("- **OpenAI:** sum `provider='openai'` rows. Compare against OpenAI dashboard.");
  md.push("- **Runway:** `provider='runway'` rows. Compare against Runway invoice.");
  md.push("- **Kling native (non-Atlas):** `provider='kling'` rows. These burn pre-paid credits; check Kling dashboard for credit deltas.");
  md.push("");
  md.push("If any provider's dashboard shows > 5% higher than our recorded totals, we're missing cost events. If it shows > 5% LOWER, we may be over-counting (rare). Either way, investigate before the next high-volume session.");

  const outPath = `/tmp/cost-reconcile-${since}-to-${until}.md`;
  fs.writeFileSync(outPath, md.join("\n"), "utf8");
  console.log(`\nWrote ${outPath}`);
  console.log(`\nQuick total by provider:`);
  const providerTotals = new Map<string, number>();
  for (const [key, b] of buckets) {
    const provider = key.split(" / ")[0];
    providerTotals.set(provider, (providerTotals.get(provider) ?? 0) + b.cents);
  }
  for (const [p, c] of providerTotals) {
    console.log(`  ${p}: $${(c / 100).toFixed(2)}`);
  }
  console.log(`  TOTAL (all cost_events): $${(totalCents / 100).toFixed(2)}`);
  console.log(`  TOTAL (listing iterations only): $${(iterTotalCents / 100).toFixed(2)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
