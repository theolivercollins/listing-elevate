import type { SupabaseClient } from "@supabase/supabase-js";

export interface RollingAccuracyResult {
  /** Fraction of predictions that agree with operator verdict (0..1) */
  accuracy: number;
  /** Number of labels that had a non-null model_prediction_at_time */
  sampleSize: number;
  /** Total labels inspected (including cold-start rows without a prediction) */
  predictionsMade: number;
}

/**
 * Computes rolling accuracy for the picker model.
 *
 * Joins gen2_pair_labels with their model_prediction_at_time.
 * - Ignores rows where model_prediction_at_time IS NULL (cold-start, no prediction yet).
 * - Correct prediction: operator said "good" AND score >= 0.5, OR operator said "bad" AND score < 0.5.
 * - "tie" verdicts are excluded from accuracy calculation (ambiguous ground truth).
 *
 * @param supabase   Supabase client
 * @param opts.listingId  If provided, scopes to a single listing. Global otherwise.
 * @param opts.lastN      Window size: last 20, 50, or 100 labels by created_at desc.
 */
export async function computeRollingAccuracy(
  supabase: SupabaseClient,
  opts: { listingId?: string; lastN: 20 | 50 | 100 },
): Promise<RollingAccuracyResult> {
  const base = supabase
    .from("gen2_pair_labels")
    .select(
      "label_id, operator_verdict, model_prediction_at_time, created_at",
    )
    .order("created_at", { ascending: false });

  const limited = opts.listingId
    ? base.eq("listing_id", opts.listingId).limit(opts.lastN)
    : base.limit(opts.lastN);

  const { data, error } = await limited;

  if (error) {
    throw new Error(`computeRollingAccuracy query failed: ${error.message}`);
  }

  const rows = data ?? [];
  const predictionsMade = rows.length;

  // Filter to rows that have a prediction and a non-tie verdict
  const scoreable = rows.filter(
    (r) =>
      r.model_prediction_at_time !== null &&
      r.model_prediction_at_time !== undefined &&
      r.operator_verdict !== "tie",
  );

  const sampleSize = scoreable.length;

  if (sampleSize === 0) {
    return { accuracy: 0, sampleSize: 0, predictionsMade };
  }

  const correct = scoreable.filter((r) => {
    const pred: number = r.model_prediction_at_time as number;
    const verdict: string = r.operator_verdict;
    return (
      (verdict === "good" && pred >= 0.5) ||
      (verdict === "bad" && pred < 0.5)
    );
  });

  return {
    accuracy: correct.length / sampleSize,
    sampleSize,
    predictionsMade,
  };
}
