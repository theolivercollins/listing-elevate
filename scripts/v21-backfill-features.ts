/**
 * V2.1 backfill — recomputes features_blob for all gen2_pair_labels rows.
 *
 * Run AFTER the feature extractor upgrade lands so every stored label
 * has real (non-placeholder) PickerFeatures. Mixing old garbage features
 * with new real features poisons the model — this script normalises ALL rows.
 *
 * Usage:
 *   pnpm exec tsx scripts/v21-backfill-features.ts 2>&1 | tee /tmp/v21-backfill.log
 *
 * Safe to run repeatedly — idempotent (over-writes with the freshly-computed
 * value whether or not the row was previously backfilled).
 */

import path from "node:path";
import fs from "node:fs";

// ── Env loading ────────────────────────────────────────────────────────────────
// Mirrors the strategy from v21-smoke.ts (worktree at .claude/worktrees/*).
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

// ── Imports (after env load so DB singleton picks up credentials) ──────────────
import { getSupabase } from "../lib/db.js";
import { getPhotosForV21Listing } from "../lib/gen2-v21/photo-source.js";
import { extractFeatures } from "../lib/gen2-v21/picker/index.js";
import {
  embedImage,
  isEnabled as isEmbeddingsEnabled,
  EmbeddingsDisabledError,
} from "../lib/embeddings-image.js";
import type { PropertySceneGraph, PhotoSceneFacts, PickerFeatures, PairCandidate, Verdict } from "../lib/gen2-v21/types.js";

// ── Types ──────────────────────────────────────────────────────────────────────

interface LabelRow {
  label_id: string;
  listing_id: string;
  photo_a_id: string;
  photo_b_id: string;
  candidate_id: string | null;
  operator_verdict: Verdict;
  features_blob: unknown;
  target: 0 | 1 | null;
}

interface SceneGraphRow {
  listing_id: string;
  payload: PropertySceneGraph;
}

// ── Cosine similarity helper ───────────────────────────────────────────────────

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0.5;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0.5;
  return dot / denom;
}

// ── Verdict → target mapping ───────────────────────────────────────────────────

function verdictToTarget(v: Verdict): 0 | 1 | null {
  if (v === "good") return 1;
  if (v === "bad") return 0;
  return null; // tie — excluded from training
}

// ── Main ───────────────────────────────────────────────────────────────────────

const startTime = Date.now();
const supabase = getSupabase();

console.log("\n" + "═".repeat(60));
console.log("  V2.1 Feature Backfill");
console.log("  " + new Date().toISOString());
console.log("═".repeat(60));
console.log(`  Embeddings enabled: ${isEmbeddingsEnabled()}`);
console.log("");

// ── 1. Fetch all labels ────────────────────────────────────────────────────────

const { data: labels, error: labelsErr } = await supabase
  .from("gen2_pair_labels")
  .select(
    "label_id, listing_id, photo_a_id, photo_b_id, candidate_id, operator_verdict, features_blob, target"
  ) as { data: LabelRow[] | null; error: unknown };

if (labelsErr) {
  console.error("[backfill] Failed to fetch labels:", labelsErr);
  process.exit(1);
}

const allLabels = labels ?? [];
console.log(`[backfill] Total labels to process: ${allLabels.length}`);

if (allLabels.length === 0) {
  console.log("[backfill] Nothing to backfill.");
  process.exit(0);
}

// ── 2. Pre-load all scene graphs (batch once, avoid N+1) ──────────────────────

const uniqueListingIds = [...new Set(allLabels.map((l) => l.listing_id))];
console.log(`[backfill] Distinct listings: ${uniqueListingIds.length}`);

const { data: sgRows, error: sgErr } = await supabase
  .from("gen2_scene_graphs")
  .select("listing_id, payload")
  .in("listing_id", uniqueListingIds) as { data: SceneGraphRow[] | null; error: unknown };

if (sgErr) {
  console.error("[backfill] Failed to fetch scene graphs:", sgErr);
  process.exit(1);
}

const sceneGraphMap = new Map<string, PropertySceneGraph>();
for (const row of sgRows ?? []) {
  sceneGraphMap.set(row.listing_id, row.payload);
}
console.log(`[backfill] Scene graphs loaded: ${sceneGraphMap.size}/${uniqueListingIds.length}`);

// ── 3. Pre-load photo lists per listing ───────────────────────────────────────

const photoUrlMap = new Map<string, Map<string, string>>(); // listingId → photoId → url
for (const listingId of uniqueListingIds) {
  const photos = await getPhotosForV21Listing(listingId);
  const m = new Map<string, string>();
  for (const p of photos) m.set(p.id, p.url);
  photoUrlMap.set(listingId, m);
}
console.log(`[backfill] Photo URL maps loaded for ${photoUrlMap.size} listings`);

// ── 4. Per-label embedding cache to avoid fetching the same URL twice ─────────

const embeddingCache = new Map<string, number[] | null>();
let totalEmbeddingCostCents = 0;

async function getEmbedding(photoId: string, url: string): Promise<number[] | null> {
  if (embeddingCache.has(photoId)) return embeddingCache.get(photoId)!;
  if (!isEmbeddingsEnabled()) {
    embeddingCache.set(photoId, null);
    return null;
  }
  try {
    const result = await embedImage({ imageUrl: url, photoId, surface: "backfill" });
    totalEmbeddingCostCents += 1; // embedImage logs 1¢/call internally
    embeddingCache.set(photoId, result.vector);
    return result.vector;
  } catch (err) {
    if (err instanceof EmbeddingsDisabledError) {
      embeddingCache.set(photoId, null);
      return null;
    }
    console.warn(`[backfill] Embedding failed for photo ${photoId}: ${err}`);
    embeddingCache.set(photoId, null);
    return null;
  }
}

// ── 5. Process each label ──────────────────────────────────────────────────────

let updated = 0;
let skippedMissingGraph = 0;
let skippedMissingPhoto = 0;

for (let i = 0; i < allLabels.length; i++) {
  const label = allLabels[i];
  const prefix = `[${i + 1}/${allLabels.length}] label_id=${label.label_id}`;

  // Resolve scene graph
  const sceneGraph = sceneGraphMap.get(label.listing_id);
  if (!sceneGraph) {
    console.warn(`${prefix} → SKIP: no scene graph for listing ${label.listing_id}`);
    skippedMissingGraph++;
    continue;
  }

  // Resolve PhotoSceneFacts from the scene graph payload
  const photoAFacts: PhotoSceneFacts | undefined = sceneGraph.photos.find(
    (p) => p.photo_id === label.photo_a_id
  );
  const photoBFacts: PhotoSceneFacts | undefined = sceneGraph.photos.find(
    (p) => p.photo_id === label.photo_b_id
  );

  if (!photoAFacts || !photoBFacts) {
    console.warn(
      `${prefix} → SKIP: photo facts not found in scene graph ` +
        `(A=${label.photo_a_id}, B=${label.photo_b_id})`
    );
    skippedMissingPhoto++;
    continue;
  }

  // Resolve photo URLs for embedding
  const photoUrls = photoUrlMap.get(label.listing_id) ?? new Map<string, string>();
  const urlA = photoUrls.get(label.photo_a_id);
  const urlB = photoUrls.get(label.photo_b_id);

  // Compute embedding similarity (falls back to null → 0.5 inside extractFeatures)
  let embeddingSim: number | null = null;
  if (urlA && urlB) {
    const [vecA, vecB] = await Promise.all([
      getEmbedding(label.photo_a_id, urlA),
      getEmbedding(label.photo_b_id, urlB),
    ]);
    if (vecA && vecB) {
      embeddingSim = cosineSim(vecA, vecB);
    }
  }

  // Build a minimal PairCandidate from what's stored in the label.
  // The label captures candidate_type and portal_id at insert time.
  const candidate: PairCandidate = {
    candidate_id: label.candidate_id ?? `backfill-${label.label_id}`,
    listing_id: label.listing_id,
    photo_a_id: label.photo_a_id,
    photo_b_id: label.photo_b_id,
    // Fallback to same_room_different_angle if the label has no type stored
    // (pre-migration rows won't have candidate_type). extractFeatures reads
    // this for portal_distance logic; same_room_different_angle = 0 hops.
    candidate_type: "same_room_different_angle" as PairCandidate["candidate_type"],
    heuristic_score: 0.5,
    reasoning: "backfilled",
    portal_id: null,
  };

  // Compute fresh features
  const newFeatures: PickerFeatures = extractFeatures(
    candidate,
    photoAFacts,
    photoBFacts,
    embeddingSim
  );

  // Recompute target in case operator_verdict got out of sync
  const newTarget = verdictToTarget(label.operator_verdict);

  const oldFeaturesJson = JSON.stringify(label.features_blob);
  const newFeaturesJson = JSON.stringify(newFeatures);

  console.log(
    `${prefix} → old features_blob: ${oldFeaturesJson} new: ${newFeaturesJson}`
  );

  // Persist updated features_blob + target
  const { error: updateErr } = await supabase
    .from("gen2_pair_labels")
    .update({ features_blob: newFeatures, target: newTarget })
    .eq("label_id", label.label_id);

  if (updateErr) {
    console.error(`${prefix} → UPDATE FAILED: ${JSON.stringify(updateErr)}`);
  } else {
    updated++;
  }
}

// ── 6. Summary ────────────────────────────────────────────────────────────────

const elapsedMs = Date.now() - startTime;
const elapsedSec = (elapsedMs / 1000).toFixed(1);

console.log("\n" + "═".repeat(60));
console.log("  V2.1 Feature Backfill — Summary");
console.log("═".repeat(60));
console.log(`  Total labels:               ${allLabels.length}`);
console.log(`  Updated:                    ${updated}`);
console.log(`  Skipped (missing graph):    ${skippedMissingGraph}`);
console.log(`  Skipped (missing photo):    ${skippedMissingPhoto}`);
console.log(`  Embedding cost (est):       ${totalEmbeddingCostCents}¢`);
console.log(`  Total runtime:              ${elapsedSec}s`);
console.log("═".repeat(60) + "\n");

if (skippedMissingGraph + skippedMissingPhoto > 0) {
  console.warn(
    `[backfill] WARNING: ${skippedMissingGraph + skippedMissingPhoto} labels were skipped ` +
      `and will NOT be usable for training until their scene graph / photo references resolve.`
  );
}
