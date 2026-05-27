/**
 * V2.1 on-demand full retrain.
 *
 * Loads ALL gen2_pair_labels rows with non-null features_blob + non-null target,
 * performs an 80/20 listing-level split, trains a fresh model, and persists to
 * gen2_picker_models with is_active=true.
 *
 * Usage:
 *   pnpm exec tsx scripts/v21-retrain.ts
 *
 * Run AFTER scripts/v21-backfill-features.ts if this is a post-extractor-upgrade
 * retrain. The backfill ensures all labels carry real features before retraining.
 */

import path from "node:path";
import fs from "node:fs";

// ── Env loading (matches v21-smoke.ts pattern) ────────────────────────────────
function loadEnvFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  console.log(`[env] Loaded ${filePath}`);
  return true;
}

const cwd = process.cwd();
const worktreeParents = [
  cwd,
  path.resolve(cwd, ".."),
  path.resolve(cwd, "../.."),
  path.resolve(cwd, "../../.."),
  "/Users/oliverhelgemo/listing-elevate",
];

let envLoaded = false;
for (const dir of worktreeParents) {
  if (loadEnvFile(path.join(dir, ".env"))) envLoaded = true;
  if (loadEnvFile(path.join(dir, "credentials.env"))) envLoaded = true;
  if (loadEnvFile(path.join(dir, ".env.local"))) envLoaded = true;
  if (envLoaded && process.env.SUPABASE_URL) break;
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[env] ERROR: Could not find SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

import { getSupabase } from "../lib/db.js";
import { retrainFromScratchAndPersist } from "../lib/gen2-v21/picker/index.js";

const supabase = getSupabase();

console.log("\n" + "═".repeat(60));
console.log("  V2.1 From-Scratch Retrain");
console.log("  " + new Date().toISOString());
console.log("═".repeat(60));

const startMs = Date.now();

try {
  const result = await retrainFromScratchAndPersist(supabase as Parameters<typeof retrainFromScratchAndPersist>[0]);

  const elapsedMs = Date.now() - startMs;
  console.log("\n  Result:");
  console.log(`    model_id:           ${result.model_id}`);
  console.log(`    n_train:            ${result.n_train}`);
  console.log(`    n_holdout:          ${result.n_holdout}`);
  console.log(`    accuracy_holdout:   ${(result.accuracy_on_holdout * 100).toFixed(1)}%`);
  console.log(`    top_features:`);
  for (const f of result.top_features) {
    console.log(`      ${f.feature.padEnd(30)} ${f.importance.toFixed(4)}`);
  }
  console.log(`    elapsed:            ${elapsedMs}ms`);
  console.log("\n  [retrain] SUCCESS — new active model: " + result.model_id);
} catch (err) {
  console.error("\n  [retrain] FAILED:", err);
  process.exit(1);
}

console.log("═".repeat(60) + "\n");
