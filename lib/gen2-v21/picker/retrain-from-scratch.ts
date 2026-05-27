/**
 * lib/gen2-v21/picker/retrain-from-scratch.ts
 *
 * Full from-scratch retrain on ALL stored labels. Distinct from the
 * incremental every-10-label trigger in retrain-trigger.ts.
 *
 * Use this:
 *   - After running scripts/v21-backfill-features.ts to flush stale feature
 *     blobs following a feature-extractor upgrade.
 *   - On demand from scripts/v21-retrain.ts or POST /api/gen2/lab/backfill-and-retrain.
 *
 * The function loads every label with non-null features_blob AND non-null target,
 * performs an 80/20 listing-level split, trains via trainPicker (LR + stump boost),
 * and persists to gen2_picker_models with is_active=true (deactivating previous active rows).
 */

import { trainPicker, predict, featureImportance, type PickerModelWeights } from "./lightgbm.js";
import type { PickerFeatures } from "../types.js";

// ── Minimal Supabase surface (same pattern as retrain-trigger.ts) ─────────────

interface LabelRow {
  label_id: string;
  listing_id: string;
  features_blob: PickerFeatures;
  target: 0 | 1;
}

interface PickerModelInsert {
  weights_blob: PickerModelWeights;
  label_count_at_train: number;
  accuracy_held_out: number;
  listing_count_at_train: number;
  is_active: boolean;
}

interface SupabaseClient {
  from(table: string): SupabaseQueryBuilder;
}

interface SupabaseQueryBuilder {
  select(cols?: string, opts?: object): SupabaseQueryBuilder;
  insert(row: unknown): SupabaseQueryBuilder;
  update(vals: unknown): SupabaseQueryBuilder;
  eq(col: string, val: unknown): SupabaseQueryBuilder;
  not(col: string, op: string, val: unknown): SupabaseQueryBuilder;
  order(col: string, opts?: object): SupabaseQueryBuilder;
  limit(n: number): SupabaseQueryBuilder;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
  then(resolve: (res: { data: unknown; error: unknown }) => void): void;
}

// ── Held-out split (listing-level, mirrors retrain-trigger.ts) ────────────────

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function splitByListing(labels: LabelRow[]): { train: LabelRow[]; test: LabelRow[] } {
  const listingIds = [...new Set(labels.map((l) => l.listing_id))];
  const shuffled = listingIds.slice().sort((a, b) => simpleHash(a) - simpleHash(b));
  const splitAt = Math.max(1, Math.floor(shuffled.length * 0.8));
  const trainSet = new Set(shuffled.slice(0, splitAt));

  const train = labels.filter((l) => trainSet.has(l.listing_id));
  const test = labels.filter((l) => !trainSet.has(l.listing_id));

  // Edge case: all listings fell into train — put last listing in test
  if (test.length === 0 && train.length > 0) {
    const lastListing = shuffled[shuffled.length - 1];
    return {
      train: labels.filter((l) => l.listing_id !== lastListing),
      test: labels.filter((l) => l.listing_id === lastListing),
    };
  }

  return { train, test };
}

// ── Accuracy on holdout ───────────────────────────────────────────────────────

function evaluateHoldout(model: PickerModelWeights, holdout: LabelRow[]): number {
  if (holdout.length === 0) return 0;
  let correct = 0;
  for (const row of holdout) {
    const pred = predict(row.features_blob, model);
    if ((pred.score >= 0.5 ? 1 : 0) === row.target) correct++;
  }
  return correct / holdout.length;
}

// ── Public return type ────────────────────────────────────────────────────────

export interface RetrainResult {
  model_id: string;
  n_train: number;
  n_holdout: number;
  accuracy_on_holdout: number;
  top_features: Array<{ feature: keyof PickerFeatures; importance: number }>;
}

// ── retrainFromScratchAndPersist ───────────────────────────────────────────────

/**
 * Full from-scratch retrain.
 *
 * 1. Loads ALL gen2_pair_labels rows where features_blob IS NOT NULL and
 *    target IS NOT NULL (excludes ties and pre-backfill rows).
 * 2. 80/20 listing-level train/test split for held-out accuracy.
 * 3. Trains via trainPicker (LR + stump boost).
 * 4. Persists new row to gen2_picker_models with is_active=true.
 * 5. Deactivates all previously active models in the same logical transaction
 *    (deactivate-then-insert order for safety).
 *
 * @param supabase  Service-role Supabase client (needs write access to
 *                  gen2_pair_labels, gen2_picker_models)
 */
export async function retrainFromScratchAndPersist(
  supabase: SupabaseClient,
): Promise<RetrainResult> {
  // ── Load labels ─────────────────────────────────────────────────────────────
  const { data: rawLabels, error: fetchErr } = await new Promise<{
    data: unknown;
    error: unknown;
  }>((resolve) => {
    supabase
      .from("gen2_pair_labels")
      .select("label_id, listing_id, features_blob, target")
      .not("features_blob", "is", null)
      .not("target", "is", null)
      .then(resolve);
  });

  if (fetchErr) {
    throw new Error(`retrainFromScratch: label fetch failed: ${JSON.stringify(fetchErr)}`);
  }

  const allLabels = (rawLabels as LabelRow[] | null) ?? [];

  if (allLabels.length < 2) {
    throw new Error(
      `retrainFromScratch: need at least 2 trainable labels, got ${allLabels.length}`
    );
  }

  const distinctListings = new Set(allLabels.map((l) => l.listing_id)).size;
  if (distinctListings < 2) {
    throw new Error(
      `retrainFromScratch: need labels from at least 2 listings for held-out split, ` +
        `got ${distinctListings} distinct listing(s) across ${allLabels.length} label(s)`
    );
  }

  // ── Split ────────────────────────────────────────────────────────────────────
  const { train, test } = splitByListing(allLabels);

  if (train.length === 0) {
    throw new Error("retrainFromScratch: train split is empty after listing split");
  }

  // ── Train ────────────────────────────────────────────────────────────────────
  const trainingData = train.map((l) => ({ features: l.features_blob, target: l.target }));
  const model = trainPicker(trainingData);

  // ── Evaluate ─────────────────────────────────────────────────────────────────
  const accuracy_on_holdout = evaluateHoldout(model, test);
  const top_features = featureImportance(model).slice(0, 5);

  // ── Deactivate existing active models ────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    supabase
      .from("gen2_picker_models")
      .update({ is_active: false })
      .eq("is_active", true)
      .then(({ error }: { data: unknown; error: unknown }) => {
        if (error) {
          reject(new Error(`retrainFromScratch: deactivate old models failed: ${JSON.stringify(error)}`));
        } else {
          resolve();
        }
      });
  });

  // ── Insert new active model ───────────────────────────────────────────────────
  const modelInsert: PickerModelInsert = {
    weights_blob: model,
    label_count_at_train: allLabels.length,
    listing_count_at_train: distinctListings,
    accuracy_held_out: accuracy_on_holdout,
    is_active: true,
  };

  const model_id = await new Promise<string>((resolve, reject) => {
    supabase
      .from("gen2_picker_models")
      .insert(modelInsert)
      .select("model_id")
      .limit(1)
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (error) {
          reject(new Error(`retrainFromScratch: model insert failed: ${JSON.stringify(error)}`));
        } else {
          const rows = data as Array<{ model_id: string }>;
          if (!rows || rows.length === 0) {
            reject(new Error("retrainFromScratch: insert returned no rows"));
          } else {
            resolve(rows[0].model_id);
          }
        }
      });
  });

  return {
    model_id,
    n_train: train.length,
    n_holdout: test.length,
    accuracy_on_holdout,
    top_features,
  };
}
