#!/usr/bin/env -S npx tsx

/**
 * refresh-router-bucket-stats.ts — recompute (α, β) per (room_type ×
 * camera_movement × sku) from prompt_lab_iterations and upsert into
 * router_bucket_stats.
 *
 * Design: docs/specs/p5-thompson-router-design.md §5 (cadence).
 * Part of P5 Session 1 scaffolding (2026-04-22 pre-cook on branch
 * session/p5-s1-implementation-draft).
 *
 * Usage:
 *   npx tsx scripts/refresh-router-bucket-stats.ts           # dry-run
 *   npx tsx scripts/refresh-router-bucket-stats.ts --write   # upsert
 *
 * Not wired to pg_cron yet. P5 Session 2 schedules the 4h cron.
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

interface BucketKey {
  room_type: string;
  camera_movement: string;
  sku: string;
}

interface BucketAgg extends BucketKey {
  alpha: number;
  beta: number;
  total: number;
}

function bucketKey(b: BucketKey): string {
  return `${b.room_type}::${b.camera_movement}::${b.sku}`;
}

async function main() {
  const writeMode = process.argv.includes("--write");

  console.log(`Mode: ${writeMode ? "WRITE (upsert into router_bucket_stats)" : "DRY-RUN (no writes)"}`);

  const supabase = getSupabase();

  // room_type lives on prompt_lab_iterations.analysis_json, not on
  // prompt_lab_sessions (sessions schema has only id/created_by/image_url/
  // image_path/label/archetype/batch_label/archived/created_at). Fall back
  // to sessions.archetype only if analysis_json is absent.
  // v1/v1.1 isolation — exclude EVERY v1.1 iteration regardless of SKU.
  // v1.1 sessions can now render any of the V1_1_LAB_SKUS (Seedance,
  // Kling 3, Kling 2.6, Kling 2.0 Master, Runway gen4), so the prior
  // SKU-name exclusion (`neq model_used seedance-pro-pushin`) was too
  // narrow — a v1.1 user rating a kling-v3-pro 5★ would have polluted
  // v1's Thompson alpha/beta. Filter by pipeline_version directly so
  // ALL v1.1 ratings stay out of v1's exploration history.
  const { data, error } = await supabase
    .from("prompt_lab_iterations")
    .select(
      "id, rating, model_used, director_output_json, analysis_json, session_id, prompt_lab_sessions!inner(archetype)",
    )
    .not("rating", "is", null)
    .not("model_used", "is", null)
    .eq("pipeline_version", "v1");

  if (error) {
    console.error("Query failed:", error);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log("No rated+SKU-tagged iterations found. Nothing to refresh.");
    console.log("This is expected before P1 SKU-capture has populated rows.");
    return;
  }

  const buckets = new Map<string, BucketAgg>();

  for (const row of data as unknown as Array<{
    id: string;
    rating: number | null;
    model_used: string | null;
    director_output_json: { camera_movement?: string } | null;
    analysis_json: { room_type?: string | null } | null;
    prompt_lab_sessions: { archetype?: string | null };
  }>) {
    if (row.rating == null || row.model_used == null) continue;
    const roomType =
      row.analysis_json?.room_type ?? row.prompt_lab_sessions?.archetype ?? "unknown";
    const movement = row.director_output_json?.camera_movement ?? "unknown";
    const key = bucketKey({
      room_type: roomType,
      camera_movement: movement,
      sku: row.model_used,
    });

    let agg = buckets.get(key);
    if (!agg) {
      agg = {
        room_type: roomType,
        camera_movement: movement,
        sku: row.model_used,
        alpha: 0,
        beta: 0,
        total: 0,
      };
      buckets.set(key, agg);
    }
    agg.total++;
    if (row.rating >= 4) agg.alpha++;
    else if (row.rating >= 1 && row.rating <= 3) agg.beta++;
  }

  const aggs = Array.from(buckets.values()).sort((a, b) => b.total - a.total);

  console.log(`\nAggregated ${aggs.length} bucket arms from ${data.length} rated iterations:`);
  for (const a of aggs.slice(0, 20)) {
    const winRate = a.total > 0 ? ((a.alpha / a.total) * 100).toFixed(1) : "—";
    console.log(
      `  ${a.room_type} × ${a.camera_movement} × ${a.sku}: α=${a.alpha} β=${a.beta} n=${a.total} (${winRate}% 4★+)`,
    );
  }
  if (aggs.length > 20) console.log(`  ... and ${aggs.length - 20} more`);

  if (!writeMode) {
    console.log("\nDry-run complete. Re-run with --write to upsert into router_bucket_stats.");
    return;
  }

  // Write path.
  console.log(`\nUpserting ${aggs.length} rows into router_bucket_stats...`);
  const rows = aggs.map((a) => ({
    room_type: a.room_type,
    camera_movement: a.camera_movement,
    sku: a.sku,
    alpha: a.alpha,
    beta: a.beta,
    last_updated: new Date().toISOString(),
  }));

  const { error: upsertErr } = await supabase
    .from("router_bucket_stats")
    .upsert(rows, { onConflict: "room_type,camera_movement,sku" });

  if (upsertErr) {
    console.error("Upsert failed:", upsertErr);
    process.exit(1);
  }

  console.log(`Upserted ${rows.length} rows.`);
}

main().catch((err) => {
  console.error("Refresh failed:", err);
  process.exit(1);
});
