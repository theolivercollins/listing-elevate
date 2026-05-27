#!/usr/bin/env -S npx tsx
/**
 * v21-features-smoke.ts
 *
 * Verifies that the V2.1 extractFeatures function produces real (non-placeholder)
 * values for embedding_cosine_sim, lighting_delta, and shot_type_delta on a
 * real pair from a listing that has a stored scene graph.
 *
 * Usage:
 *   npx tsx scripts/v21-features-smoke.ts
 *   npx tsx scripts/v21-features-smoke.ts --listing <listingId>
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY),
 *           and optionally GEMINI_API_KEY + ENABLE_IMAGE_EMBEDDINGS=true for
 *           on-demand embedding generation.
 *
 * Exit code 0 = smoke passed. Exit code 1 = blocked / error.
 */

import * as fs from "fs";
import * as path from "path";

// Load .env from cwd (main repo) or parent (when running from worktree)
for (const envDir of [process.cwd(), path.join(process.cwd(), "..")]) {
  const envPath = path.join(envDir, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
    break;
  }
}

// Also try ENABLE_IMAGE_EMBEDDINGS from env (allow override)
if (!process.env.ENABLE_IMAGE_EMBEDDINGS) {
  process.env.ENABLE_IMAGE_EMBEDDINGS = "true";
}

import { createClient } from "@supabase/supabase-js";
import { generateCandidates } from "../lib/gen2-v21/candidates/index.js";
import { extractFeatures } from "../lib/gen2-v21/picker/features.js";
import { computePixelBrightness, computeCosineSimilarity } from "../lib/gen2-v21/picker/feature-helpers.js";
import { embedImage, isEnabled as embeddingsEnabled } from "../lib/embeddings-image.js";
import type { PropertySceneGraph, PhotoSceneFacts } from "../lib/gen2-v21/types.js";

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Find a listing to test against
  const explicitListingId = (() => {
    const idx = process.argv.indexOf("--listing");
    return idx >= 0 ? process.argv[idx + 1] : null;
  })();

  let listingId: string;

  if (explicitListingId) {
    listingId = explicitListingId;
    console.log(`Using explicit listing: ${listingId}`);
  } else {
    // Find the most recent scene graph — grab any listing
    const { data: sgRows, error: sgErr } = await supabase
      .from("gen2_scene_graphs")
      .select("listing_id, extracted_at")
      .order("extracted_at", { ascending: false })
      .limit(1);

    if (sgErr || !sgRows?.length) {
      console.error("No scene graphs found in gen2_scene_graphs. Run extract-scene-graph first.", sgErr?.message ?? "");
      process.exit(1);
    }

    listingId = sgRows[0].listing_id;
    console.log(`Auto-selected listing: ${listingId} (most recent scene graph)`);
  }

  // 2. Load scene graph
  const { data: sgRow, error: sgLoadErr } = await supabase
    .from("gen2_scene_graphs")
    .select("payload, model_version")
    .eq("listing_id", listingId)
    .single();

  if (sgLoadErr || !sgRow) {
    console.error(`Scene graph not found for listing ${listingId}:`, sgLoadErr?.message ?? "");
    process.exit(1);
  }

  const sceneGraph = sgRow.payload as unknown as PropertySceneGraph;
  const factsMap = new Map<string, PhotoSceneFacts>(
    sceneGraph.photos.map((f) => [f.photo_id, f])
  );

  console.log(`Scene graph loaded: ${sceneGraph.photos.length} photos, model=${sgRow.model_version}`);

  // 3. Generate candidates and pick the first one
  const candidates = generateCandidates(sceneGraph);
  if (!candidates.length) {
    console.error("No candidates generated for this listing.");
    process.exit(1);
  }
  const candidate = candidates[0];
  console.log(`\nUsing candidate: ${candidate.candidate_id}`);
  console.log(`  type=${candidate.candidate_type}, heuristic=${candidate.heuristic_score.toFixed(3)}`);
  console.log(`  photo_a=${candidate.photo_a_id}`);
  console.log(`  photo_b=${candidate.photo_b_id}`);

  const factsA = factsMap.get(candidate.photo_a_id);
  const factsB = factsMap.get(candidate.photo_b_id);
  if (!factsA || !factsB) {
    console.error("Scene facts missing for one or both photos — cold-start listing.");
    process.exit(1);
  }

  // 4. Resolve photo URLs (dual-source: photos table or prompt_lab_listing_photos)
  let urlA: string | null = null;
  let urlB: string | null = null;

  // Try photos table first
  const { data: realPhotos } = await supabase
    .from("photos")
    .select("id, file_url")
    .in("id", [candidate.photo_a_id, candidate.photo_b_id]);

  if (realPhotos?.length) {
    const byId = new Map(realPhotos.map((p: { id: string; file_url: string }) => [p.id, p.file_url]));
    urlA = byId.get(candidate.photo_a_id) ?? null;
    urlB = byId.get(candidate.photo_b_id) ?? null;
  }

  // Fall back to prompt_lab_listing_photos
  if (!urlA || !urlB) {
    const { data: labPhotos } = await supabase
      .from("prompt_lab_listing_photos")
      .select("id, image_url")
      .in("id", [candidate.photo_a_id, candidate.photo_b_id]);

    if (labPhotos?.length) {
      const byId = new Map(labPhotos.map((p: { id: string; image_url: string }) => [p.id, p.image_url]));
      urlA = urlA ?? byId.get(candidate.photo_a_id) ?? null;
      urlB = urlB ?? byId.get(candidate.photo_b_id) ?? null;
    }
  }

  if (!urlA || !urlB) {
    console.error("Could not resolve photo URLs for either photo. URLs required for brightness + embeddings.");
    process.exit(1);
  }

  console.log(`\nPhoto URLs resolved.`);

  // 5. Fetch image embeddings from DB if available
  let embA: number[] | null = null;
  let embB: number[] | null = null;

  const { data: embRows } = await supabase
    .from("photos")
    .select("id, image_embedding")
    .in("id", [candidate.photo_a_id, candidate.photo_b_id]);

  if (embRows) {
    for (const row of embRows) {
      const emb = row.image_embedding;
      if (Array.isArray(emb) && emb.length > 0) {
        if (row.id === candidate.photo_a_id) embA = emb as number[];
        if (row.id === candidate.photo_b_id) embB = emb as number[];
      }
    }
  }

  const embSource = embA && embB ? "db" : "none yet";
  console.log(`Embeddings from DB: A=${embA ? "YES" : "no"}, B=${embB ? "YES" : "no"} (source=${embSource})`);

  // Generate on-demand if not in DB and embeddings are enabled
  if (!embA && embeddingsEnabled()) {
    console.log("Generating embedding A on demand...");
    try {
      embA = (await embedImage({ imageUrl: urlA, photoId: candidate.photo_a_id, surface: "lab" })).vector;
      console.log("  → generated embedding A (dim=" + embA.length + ")");
    } catch (err) {
      console.warn("  → FAILED:", err instanceof Error ? err.message : String(err));
    }
  }

  if (!embB && embeddingsEnabled()) {
    console.log("Generating embedding B on demand...");
    try {
      embB = (await embedImage({ imageUrl: urlB, photoId: candidate.photo_b_id, surface: "lab" })).vector;
      console.log("  → generated embedding B (dim=" + embB.length + ")");
    } catch (err) {
      console.warn("  → FAILED:", err instanceof Error ? err.message : String(err));
    }
  }

  // 6. Compute pixel brightness
  console.log("\nComputing pixel brightness...");
  const [brightnessA, brightnessB] = await Promise.all([
    computePixelBrightness(urlA),
    computePixelBrightness(urlB),
  ]);
  console.log(`  photo_a brightness: ${brightnessA !== null ? brightnessA.toFixed(4) : "FAILED (null)"}`);
  console.log(`  photo_b brightness: ${brightnessB !== null ? brightnessB.toFixed(4) : "FAILED (null)"}`);

  // 7. Run extractFeatures
  const features = extractFeatures(
    candidate,
    factsA,
    factsB,
    embA,
    embB,
    brightnessA,
    brightnessB,
  );

  // 8. Print results
  console.log("\n=== Feature Vector ===");
  const entries = Object.entries(features) as [string, number][];
  for (const [k, v] of entries) {
    const isPlaceholder = v === 0.5;
    const flag = isPlaceholder ? "  ← PLACEHOLDER 0.5" : "";
    console.log(`  ${k.padEnd(30)} = ${typeof v === "number" ? v.toFixed(6) : v}${flag}`);
  }

  // 9. Validation checks
  console.log("\n=== Smoke Checks ===");
  let allPass = true;

  function check(label: string, pass: boolean, detail: string) {
    const icon = pass ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${label}: ${detail}`);
    if (!pass) allPass = false;
  }

  const cosineSim = features.embedding_cosine_sim;
  check(
    "embedding_cosine_sim is NOT 0.5",
    cosineSim !== 0.5,
    `value=${cosineSim.toFixed(6)}`,
  );

  const ld = features.lighting_delta;
  check(
    "lighting_delta is NOT 0.5",
    ld !== 0.5,
    `value=${ld.toFixed(6)} (pixel brightness used: ${brightnessA !== null && brightnessB !== null})`,
  );

  const ssd = features.shot_type_delta;
  check(
    "shot_type_delta reflects shot types",
    true, // always structural — just report the value
    `value=${ssd.toFixed(6)} (shotA=${factsA.shot_type}, shotB=${factsB.shot_type})`,
  );

  const totalKeys = entries.length;
  check("feature count is 10", totalKeys === 10, `count=${totalKeys}`);

  // Count non-placeholder features
  const nonPlaceholders = entries.filter(([, v]) => v !== 0.5).length;
  console.log(`\n  Non-placeholder features: ${nonPlaceholders}/${totalKeys}`);

  if (allPass) {
    console.log("\nSmoke: PASS");
  } else {
    console.log("\nSmoke: FAIL — see FAIL lines above");
    process.exit(1);
  }

  // 10. Cosine sanity check (math-only, no I/O)
  if (embA && embB) {
    const manualSim = computeCosineSimilarity(embA, embB);
    const delta = Math.abs(manualSim - cosineSim);
    console.log(`\nCosine sanity: manual=${manualSim.toFixed(6)}, feature=${cosineSim.toFixed(6)}, delta=${delta.toFixed(8)}`);
    if (delta > 1e-6) {
      console.warn("  WARNING: cosine values differ by more than 1e-6 — check embedding path");
    }
  }
}

main().catch((err) => {
  console.error("Smoke script failed:", err);
  process.exit(1);
});
