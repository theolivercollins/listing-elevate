import type { PickerFeatures } from "../types.js";
import { trainPicker, predict, type PickerModelWeights } from "./lightgbm.js";

// ---------------------------------------------------------------------------
// Retrain trigger
// ---------------------------------------------------------------------------

/**
 * Returns true when a retrain should be triggered.
 * Fires every 10 new labels since the last training run.
 */
export function shouldRetrain(
  currentLabelCount: number,
  lastTrainedAtCount: number,
): boolean {
  if (currentLabelCount < 10) return false;
  return Math.floor(currentLabelCount / 10) > Math.floor(lastTrainedAtCount / 10);
}

// ---------------------------------------------------------------------------
// Supabase row types (local to this module — no Supabase type-gen required)
// ---------------------------------------------------------------------------

interface LabelRow {
  label_id: string;
  listing_id: string;
  features_blob: PickerFeatures;
  target: 0 | 1;
}

interface PickerModelInsert {
  model_id?: string;
  weights_blob: PickerModelWeights;
  label_count_at_train: number;
  accuracy_held_out: number;
  listing_count_at_train: number;
  is_active: boolean;
}

// Minimal Supabase client surface we rely on
interface SupabaseClient {
  from(table: string): SupabaseQueryBuilder;
  rpc(fn: string, params: Record<string, unknown>): Promise<{ error: unknown }>;
}

interface SupabaseQueryBuilder {
  select(cols?: string): SupabaseQueryBuilder;
  insert(row: unknown): SupabaseQueryBuilder;
  update(vals: unknown): SupabaseQueryBuilder;
  eq(col: string, val: unknown): SupabaseQueryBuilder;
  limit(n: number): SupabaseQueryBuilder;
  then(resolve: (res: { data: unknown; error: unknown }) => void): void;
}

// ---------------------------------------------------------------------------
// Held-out split helper
// ---------------------------------------------------------------------------

/**
 * Splits labels into train/test ensuring split is by listing_id, not by row.
 * 80% of distinct listings → train; 20% → test.
 */
function splitByListing(labels: LabelRow[]): {
  train: LabelRow[];
  test: LabelRow[];
} {
  const listingIds = [...new Set(labels.map((l) => l.listing_id))];

  // Deterministic shuffle using label counts as seed (no external dep)
  const shuffled = listingIds.slice().sort((a, b) =>
    simpleHash(a) - simpleHash(b)
  );

  const splitAt = Math.max(1, Math.floor(shuffled.length * 0.8));
  const trainListings = new Set(shuffled.slice(0, splitAt));

  const train = labels.filter((l) => trainListings.has(l.listing_id));
  const test = labels.filter((l) => !trainListings.has(l.listing_id));

  // Edge case: all listings in train → put last listing in test
  if (test.length === 0 && train.length > 0) {
    const lastListing = shuffled[shuffled.length - 1];
    return {
      train: labels.filter((l) => l.listing_id !== lastListing),
      test: labels.filter((l) => l.listing_id === lastListing),
    };
  }

  return { train, test };
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0; // unsigned
}

// ---------------------------------------------------------------------------
// Evaluate accuracy on hold-out set
// ---------------------------------------------------------------------------

function evaluateHoldout(
  model: PickerModelWeights,
  holdout: LabelRow[],
): number {
  if (holdout.length === 0) return 0;
  let correct = 0;
  for (const row of holdout) {
    const prediction = predict(row.features_blob, model);
    const predicted_label = prediction.score >= 0.5 ? 1 : 0;
    if (predicted_label === row.target) correct++;
  }
  return correct / holdout.length;
}

// ---------------------------------------------------------------------------
// trainAndPersist
// ---------------------------------------------------------------------------

/**
 * Fetches all labels, trains a new model on 80% (split by listing),
 * evaluates on held-out 20%, persists to gen2_picker_models with is_active=true,
 * and deactivates the previous active model.
 *
 * @returns model_id of the newly persisted model and its held-out accuracy
 */
export async function trainAndPersist(
  supabase: SupabaseClient,
  labelsQuery: () => Promise<LabelRow[]>,
): Promise<{ model_id: string; accuracy_on_holdout: number }> {
  // Fetch all labels
  const allLabels = await labelsQuery();

  if (allLabels.length < 2) {
    throw new Error(
      `trainAndPersist: need at least 2 labels, got ${allLabels.length}`,
    );
  }

  const distinctListings = new Set(allLabels.map((l) => l.listing_id)).size;
  if (distinctListings < 2) {
    throw new Error(
      `trainAndPersist: need at least 2 labels, got ${allLabels.length}`,
    );
  }

  // Split by listing
  const { train, test } = splitByListing(allLabels);

  if (train.length === 0) {
    throw new Error("trainAndPersist: train split is empty after listing split");
  }

  // Train
  const trainingData = train.map((l) => ({
    features: l.features_blob,
    target: l.target,
  }));
  const model = trainPicker(trainingData);

  // Evaluate
  const accuracy_on_holdout = evaluateHoldout(model, test);

  // Deactivate existing active models (within a transaction via RPC, or sequentially)
  await new Promise<void>((resolve, reject) => {
    supabase
      .from("gen2_picker_models")
      .update({ is_active: false })
      .eq("is_active", true)
      .then(({ error }: { data: unknown; error: unknown }) => {
        if (error) reject(new Error(`Failed to deactivate old models: ${JSON.stringify(error)}`));
        else resolve();
      });
  });

  // Insert new active model
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
          reject(new Error(`Failed to insert picker model: ${JSON.stringify(error)}`));
        } else {
          const rows = data as Array<{ model_id: string }>;
          if (!rows || rows.length === 0) {
            reject(new Error("Insert returned no rows"));
          } else {
            resolve(rows[0].model_id);
          }
        }
      });
  });

  return { model_id, accuracy_on_holdout };
}
