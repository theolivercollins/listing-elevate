/**
 * One-off backfill: recover cost_events rows for judge calls that ran
 * 2026-04-30 → 2026-05-06 while cost_events.property_id_fkey was silently
 * rejecting the sentinel-UUID writes.
 *
 * Source of truth: lab_judge_scores (each row has cost_cents — gemini-judge
 * computed it before the cost_events insert failed). We INSERT a cost_event
 * for each lab_judge_scores row that doesn't already have a sibling row in
 * cost_events with the same iteration_id metadata.
 *
 * Idempotent: re-running is a no-op once backfill has happened.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env", ".env.local", "credentials.env"]) {
  const p = path.join("/Users/oliverhelgemo/listing-elevate", file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const dryRun = !process.argv.includes("--write");
console.log(dryRun ? "DRY RUN (use --write to insert)" : "WRITE MODE");

// All lab_judge_scores rows from the broken window forward.
const { data: scores, error: sErr } = await sb
  .from("lab_judge_scores")
  .select("iteration_id, judge_version, model_id, cost_cents, judged_at")
  .gte("judged_at", "2026-04-30T00:00:00Z");
if (sErr) throw sErr;
console.log(`lab_judge_scores rows in window: ${scores?.length ?? 0}`);

// All judge cost_events ever — we de-dupe on metadata->>iteration_id +
// metadata->>judge_version so re-running won't double-insert.
const { data: existing, error: eErr } = await sb
  .from("cost_events")
  .select("metadata")
  .eq("provider", "google")
  .filter("metadata->>subtype", "eq", "judge");
if (eErr) throw eErr;
const seen = new Set<string>();
for (const e of existing ?? []) {
  const m = (e.metadata as any) ?? {};
  if (m.iteration_id && m.judge_version) seen.add(`${m.iteration_id}::${m.judge_version}`);
}
console.log(`existing judge cost_events: ${seen.size}`);

const rows: any[] = [];
for (const s of scores ?? []) {
  const key = `${s.iteration_id}::${s.judge_version}`;
  if (seen.has(key)) continue;
  rows.push({
    property_id: null,
    scene_id: null,
    stage: "analysis",
    provider: "google",
    units_consumed: 1,
    unit_type: "tokens",
    cost_cents: s.cost_cents ?? 0,
    metadata: {
      subtype: "judge",
      surface: "lab",
      iteration_id: s.iteration_id,
      judge_model: s.model_id,
      judge_version: s.judge_version,
      backfill: true,
      backfill_source: "lab_judge_scores.cost_cents",
      backfill_at: new Date().toISOString(),
      backfill_note: "cost_events.property_id_fkey blocked sentinel-UUID writes 2026-04-30 → 2026-05-06; recovered cost from lab_judge_scores per row.",
      original_judged_at: s.judged_at,
    },
  });
}
console.log(`rows to backfill: ${rows.length}`);

const totalCents = rows.reduce((s, r) => s + (r.cost_cents ?? 0), 0);
const byVersion = new Map<string, { n: number; cents: number }>();
for (const r of rows) {
  const v = (r.metadata as any).judge_version as string;
  const cur = byVersion.get(v) ?? { n: 0, cents: 0 };
  cur.n++;
  cur.cents += r.cost_cents ?? 0;
  byVersion.set(v, cur);
}
console.log(`\nrecovered total: ${totalCents}¢ = $${(totalCents / 100).toFixed(2)}`);
for (const [v, agg] of byVersion) {
  console.log(`  ${v}: ${agg.n} rows, ${agg.cents}¢ ($${(agg.cents / 100).toFixed(2)})`);
}

if (rows.length === 0) {
  console.log("\nnothing to backfill.");
  process.exit(0);
}
if (dryRun) {
  console.log("\nrerun with --write to actually insert.");
  process.exit(0);
}

// Insert in chunks to keep payloads modest.
const CHUNK = 100;
let inserted = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const slice = rows.slice(i, i + CHUNK);
  const { error: iErr } = await sb.from("cost_events").insert(slice);
  if (iErr) {
    console.error(`chunk ${i / CHUNK} insert err:`, iErr);
    process.exit(1);
  }
  inserted += slice.length;
  console.log(`  inserted ${inserted}/${rows.length}`);
}
console.log(`\n✓ backfilled ${inserted} cost_events rows.`);
