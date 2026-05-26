/**
 * V2.1 retrain hook — triggers picker retraining when enough new judged
 * outcomes have accumulated since the last retrain.
 *
 * Threshold: 10 new outcomes with status='judged' and judge_score IS NOT NULL
 * since the last retrain (tracked via gen2_picker_models.label_count_at_train).
 *
 * High judge_score outcomes contribute with weight 2x per spec:
 *   - judge_score >= 0.7 → target=1, weight=2 (positive, emphasized)
 *   - judge_score < 0.7  → target=0, weight=1 (negative)
 *
 * Weight is applied by duplicating the row in the training input.
 */

import { trainAndPersist } from "../picker/index.js";
import type { PickerFeatures } from "../types.js";

const MIN_NEW_OUTCOMES = 10;

// Minimal Supabase client surface
interface SupabaseClient {
  from(table: string): SupabaseQueryBuilder;
  rpc(fn: string, params?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

interface SupabaseQueryBuilder {
  select(cols?: string): SupabaseQueryBuilder;
  insert(row: unknown): SupabaseQueryBuilder;
  update(vals: unknown): SupabaseQueryBuilder;
  eq(col: string, val: unknown): SupabaseQueryBuilder;
  neq(col: string, val: unknown): SupabaseQueryBuilder;
  not(col: string, op: string, val: unknown): SupabaseQueryBuilder;
  order(col: string, opts?: { ascending: boolean }): SupabaseQueryBuilder;
  limit(n: number): SupabaseQueryBuilder;
  then(resolve: (res: { data: unknown; error: unknown }) => void): void;
}

interface OutcomeRow {
  outcome_id: string;
  pair_label_id: string;
  judge_score: number;
}

interface LabelRow {
  label_id: string;
  listing_id: string;
  features_blob: PickerFeatures;
  target: 0 | 1;
}

async function getLastTrainLabelCount(supabase: SupabaseClient): Promise<number> {
  return new Promise<number>((resolve) => {
    supabase
      .from("gen2_picker_models")
      .select("label_count_at_train")
      .eq("is_active", true)
      .order("created_at" as string, { ascending: false })
      .limit(1)
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (error || !data) { resolve(0); return; }
        const rows = data as Array<{ label_count_at_train: number }>;
        resolve(rows[0]?.label_count_at_train ?? 0);
      });
  });
}

async function countJudgedOutcomes(supabase: SupabaseClient): Promise<number> {
  return new Promise<number>((resolve) => {
    supabase
      .from("gen2_render_outcomes")
      .select("outcome_id")
      .eq("status", "judged")
      .not("judge_score", "is", null)
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (error || !data) { resolve(0); return; }
        resolve((data as unknown[]).length);
      });
  });
}

async function fetchJudgedOutcomes(supabase: SupabaseClient): Promise<OutcomeRow[]> {
  return new Promise<OutcomeRow[]>((resolve) => {
    supabase
      .from("gen2_render_outcomes")
      .select("outcome_id, pair_label_id, judge_score")
      .eq("status", "judged")
      .not("judge_score", "is", null)
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (error || !data) { resolve([]); return; }
        resolve(data as OutcomeRow[]);
      });
  });
}

async function fetchLabelFeatures(
  supabase: SupabaseClient,
  labelIds: string[],
): Promise<LabelRow[]> {
  if (labelIds.length === 0) return [];
  return new Promise<LabelRow[]>((resolve) => {
    supabase
      .from("gen2_pair_labels")
      .select("label_id, listing_id, features_blob")
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (error || !data) { resolve([]); return; }
        const rows = data as Array<{
          label_id: string;
          listing_id: string;
          features_blob: PickerFeatures | null;
          operator_verdict?: string;
        }>;
        // Filter to only the label_ids we want and those with features
        const filtered = rows.filter(
          (r) => labelIds.includes(r.label_id) && r.features_blob != null,
        );
        resolve(
          filtered.map((r) => ({
            label_id: r.label_id,
            listing_id: r.listing_id,
            features_blob: r.features_blob as PickerFeatures,
            target: 0 as 0 | 1, // will be overwritten by caller
          })),
        );
      });
  });
}

/**
 * Trigger a picker retrain if at least MIN_NEW_OUTCOMES judged outcomes have
 * accumulated since the last retrain. High judge_score outcomes get 2x weight.
 *
 * Returns { retrained: false } if the threshold is not met.
 * Returns { retrained: true, model_id } if retrain completed successfully.
 */
export async function triggerRetrainIfReady(
  supabase: SupabaseClient,
): Promise<{ retrained: boolean; model_id?: string }> {
  const lastTrainCount = await getLastTrainLabelCount(supabase);
  const currentJudged = await countJudgedOutcomes(supabase);
  const newSinceLast = currentJudged - lastTrainCount;

  if (newSinceLast < MIN_NEW_OUTCOMES) {
    return { retrained: false };
  }

  // Fetch judged outcomes to build weighted training data
  const outcomes = await fetchJudgedOutcomes(supabase);
  if (outcomes.length === 0) return { retrained: false };

  // Fetch features for the associated pair labels
  const labelIds = outcomes.map((o) => o.pair_label_id);
  const labelRows = await fetchLabelFeatures(supabase, labelIds);

  // Build a map from label_id to features
  const featureMap = new Map(labelRows.map((l) => [l.label_id, l]));

  // Build weighted training rows:
  //   judge_score >= 0.7 → positive (target=1), duplicated for 2x weight
  //   judge_score < 0.7  → negative (target=0), single copy
  const trainingRows: LabelRow[] = [];
  for (const outcome of outcomes) {
    const labelRow = featureMap.get(outcome.pair_label_id);
    if (!labelRow) continue;

    const isPositive = outcome.judge_score >= 0.7;
    const row: LabelRow = {
      ...labelRow,
      target: isPositive ? 1 : 0,
    };
    trainingRows.push(row);
    if (isPositive) {
      // 2x weight for positive high-score outcomes per spec
      trainingRows.push({ ...row });
    }
  }

  if (trainingRows.length < 2) {
    // Not enough valid feature rows to train
    return { retrained: false };
  }

  // Delegate to picker trainAndPersist
  const labelsQueryFn = async () => trainingRows;

  const { model_id } = await trainAndPersist(supabase as Parameters<typeof trainAndPersist>[0], labelsQueryFn);

  return { retrained: true, model_id };
}
