/**
 * POST /api/gen2/lab/backfill-and-retrain
 *
 * Auth-gated (requireAdmin). Runs the feature backfill + full from-scratch
 * retrain pipeline in a single request. Intended for:
 *   - Post feature-extractor upgrade (to flush stale features_blob values).
 *   - On-demand full retrains triggered by Oliver / cron.
 *
 * Response:
 *   {
 *     backfill: {
 *       total: number;
 *       updated: number;
 *       skipped_missing_graph: number;
 *       skipped_missing_photo: number;
 *       embedding_cost_cents: number;
 *       elapsed_ms: number;
 *     };
 *     retrain: {
 *       model_id: string;
 *       n_train: number;
 *       n_holdout: number;
 *       accuracy_on_holdout: number;
 *       top_features: Array<{ feature: string; importance: number }>;
 *     };
 *   }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import { getPhotosForV21Listing } from "../../../lib/gen2-v21/photo-source.js";
import { extractFeatures } from "../../../lib/gen2-v21/picker/index.js";
import { retrainFromScratchAndPersist } from "../../../lib/gen2-v21/picker/index.js";
import {
  embedImage,
  isEnabled as isEmbeddingsEnabled,
  EmbeddingsDisabledError,
} from "../../../lib/embeddings-image.js";
import type {
  PropertySceneGraph,
  PhotoSceneFacts,
  PickerFeatures,
  PairCandidate,
  Verdict,
} from "../../../lib/gen2-v21/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ──────────────────────────────────────────────────────────────────────

interface LabelRow {
  label_id: string;
  listing_id: string;
  photo_a_id: string;
  photo_b_id: string;
  candidate_id: string | null;
  candidate_type: string | null;
  heuristic_score: number | null;
  portal_id: string | null;
  operator_verdict: Verdict;
  features_blob: unknown;
  target: 0 | 1 | null;
}

interface SceneGraphRow {
  listing_id: string;
  payload: PropertySceneGraph;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0.5;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0.5 : dot / denom;
}

function verdictToTarget(v: Verdict): 0 | 1 | null {
  if (v === "good") return 1;
  if (v === "bad") return 0;
  return null;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.GEN2_V21_ENABLED !== "true") {
    return res.status(404).json({ error: "Not found" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const supabase = getSupabase();
  const backfillStartMs = Date.now();

  // ── PHASE 1: Backfill ────────────────────────────────────────────────────────

  // 1a. Fetch all labels
  const { data: labelsRaw, error: labelsErr } = await supabase
    .from("gen2_pair_labels")
    .select(
      "label_id, listing_id, photo_a_id, photo_b_id, candidate_id, candidate_type, heuristic_score, portal_id, operator_verdict, features_blob, target"
    ) as { data: LabelRow[] | null; error: unknown };

  if (labelsErr) {
    return res.status(500).json({ error: "Failed to fetch labels", detail: labelsErr });
  }

  const allLabels = labelsRaw ?? [];

  // 1b. Batch-load scene graphs
  const uniqueListingIds = [...new Set(allLabels.map((l) => l.listing_id))];
  const { data: sgRows, error: sgErr } = await supabase
    .from("gen2_scene_graphs")
    .select("listing_id, payload")
    .in("listing_id", uniqueListingIds) as { data: SceneGraphRow[] | null; error: unknown };

  if (sgErr) {
    return res.status(500).json({ error: "Failed to fetch scene graphs", detail: sgErr });
  }

  const sceneGraphMap = new Map<string, PropertySceneGraph>();
  for (const row of sgRows ?? []) sceneGraphMap.set(row.listing_id, row.payload);

  // 1c. Batch-load photo URLs
  const photoUrlMap = new Map<string, Map<string, string>>();
  for (const listingId of uniqueListingIds) {
    const photos = await getPhotosForV21Listing(listingId);
    const m = new Map<string, string>();
    for (const p of photos) m.set(p.id, p.url);
    photoUrlMap.set(listingId, m);
  }

  // 1d. Embedding cache
  const embeddingCache = new Map<string, number[] | null>();
  let totalEmbeddingCostCents = 0;

  async function getEmbedding(photoId: string, url: string): Promise<number[] | null> {
    if (embeddingCache.has(photoId)) return embeddingCache.get(photoId)!;
    if (!isEmbeddingsEnabled()) { embeddingCache.set(photoId, null); return null; }
    try {
      const result = await embedImage({ imageUrl: url, photoId, surface: "backfill" });
      totalEmbeddingCostCents += 1;
      embeddingCache.set(photoId, result.vector);
      return result.vector;
    } catch (err) {
      if (err instanceof EmbeddingsDisabledError) { embeddingCache.set(photoId, null); return null; }
      embeddingCache.set(photoId, null);
      return null;
    }
  }

  // 1e. Process each label
  let updated = 0;
  let skippedMissingGraph = 0;
  let skippedMissingPhoto = 0;

  for (const label of allLabels) {
    const sceneGraph = sceneGraphMap.get(label.listing_id);
    if (!sceneGraph) { skippedMissingGraph++; continue; }

    const photoAFacts: PhotoSceneFacts | undefined = sceneGraph.photos.find(
      (p) => p.photo_id === label.photo_a_id
    );
    const photoBFacts: PhotoSceneFacts | undefined = sceneGraph.photos.find(
      (p) => p.photo_id === label.photo_b_id
    );
    if (!photoAFacts || !photoBFacts) { skippedMissingPhoto++; continue; }

    const photoUrls = photoUrlMap.get(label.listing_id) ?? new Map<string, string>();
    const urlA = photoUrls.get(label.photo_a_id);
    const urlB = photoUrls.get(label.photo_b_id);

    let embeddingSim: number | null = null;
    if (urlA && urlB) {
      const [vecA, vecB] = await Promise.all([
        getEmbedding(label.photo_a_id, urlA),
        getEmbedding(label.photo_b_id, urlB),
      ]);
      if (vecA && vecB) embeddingSim = cosineSim(vecA, vecB);
    }

    const candidate: PairCandidate = {
      candidate_id: label.candidate_id ?? `backfill-${label.label_id}`,
      listing_id: label.listing_id,
      photo_a_id: label.photo_a_id,
      photo_b_id: label.photo_b_id,
      candidate_type: (label.candidate_type as PairCandidate["candidate_type"]) ?? "same_room_different_angle",
      heuristic_score: label.heuristic_score ?? 0.5,
      reasoning: "backfilled",
      portal_id: label.portal_id ?? null,
    };

    const newFeatures: PickerFeatures = extractFeatures(candidate, photoAFacts, photoBFacts, embeddingSim);
    const newTarget = verdictToTarget(label.operator_verdict);

    const { error: updateErr } = await supabase
      .from("gen2_pair_labels")
      .update({ features_blob: newFeatures, target: newTarget })
      .eq("label_id", label.label_id);

    if (!updateErr) updated++;
  }

  const backfillElapsedMs = Date.now() - backfillStartMs;

  // ── PHASE 2: Full retrain ────────────────────────────────────────────────────

  let retrainResult: Awaited<ReturnType<typeof retrainFromScratchAndPersist>> | null = null;
  let retrainError: string | null = null;

  try {
    retrainResult = await retrainFromScratchAndPersist(
      supabase as unknown as Parameters<typeof retrainFromScratchAndPersist>[0]
    );
  } catch (err) {
    retrainError = err instanceof Error ? err.message : String(err);
    console.error("[backfill-and-retrain] retrain failed:", err);
  }

  // ── Response ─────────────────────────────────────────────────────────────────

  return res.status(retrainError ? 207 : 200).json({
    backfill: {
      total: allLabels.length,
      updated,
      skipped_missing_graph: skippedMissingGraph,
      skipped_missing_photo: skippedMissingPhoto,
      embedding_cost_cents: totalEmbeddingCostCents,
      elapsed_ms: backfillElapsedMs,
    },
    retrain: retrainResult ?? { error: retrainError },
  });
}
