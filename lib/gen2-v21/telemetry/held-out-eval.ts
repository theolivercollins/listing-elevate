import type { SupabaseClient } from "@supabase/supabase-js";

export interface HeldOutEvalResult {
  /** Accuracy on the 20% held-out listings (0..1) */
  accuracyOnHeldout: number;
  /** Number of distinct listing_ids in the training split */
  trainedListings: number;
  /** Number of distinct listing_ids in the held-out split */
  heldOutListings: number;
}

interface LabelRow {
  label_id: string;
  listing_id: string;
  operator_verdict: string;
  model_prediction_at_time: number | null;
}

/**
 * Runs a held-out evaluation of the picker by splitting labels at the
 * LISTING level (not the label level). This prevents memorization — if all
 * labels for a listing are in the train set, the model can't cheat by
 * remembering that listing's photos.
 *
 * Algorithm:
 * 1. Fetch all scored (non-null model_prediction_at_time) labels with a
 *    non-tie operator_verdict.
 * 2. Collect unique listing_ids, deterministically shuffle (stable sort by id),
 *    put 80% in train and 20% in held-out.
 * 3. Accuracy = fraction of held-out labels where prediction matches verdict.
 *
 * This function is intentionally read-only and idempotent — safe to call
 * nightly via cron without side effects.
 *
 * NOTE: This is a lightweight pseudo-held-out eval using the existing stored
 * model_prediction_at_time scores. A full retrain-from-scratch on the 80%
 * split is deferred to when a server-side training pipeline is available.
 * The current metric answers: "are the model's historical predictions on
 * unseen listings better than chance?"
 */
export async function runHeldOutEval(
  supabase: SupabaseClient,
): Promise<HeldOutEvalResult> {
  // Fetch all usable labels
  const { data, error } = await supabase
    .from("gen2_pair_labels")
    .select(
      "label_id, listing_id, operator_verdict, model_prediction_at_time",
    )
    .not("model_prediction_at_time", "is", null)
    .neq("operator_verdict", "tie")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`runHeldOutEval fetch failed: ${error.message}`);
  }

  const rows: LabelRow[] = (data ?? []) as LabelRow[];

  if (rows.length === 0) {
    return { accuracyOnHeldout: 0, trainedListings: 0, heldOutListings: 0 };
  }

  // Collect unique listing_ids in deterministic order (sort alphabetically)
  const uniqueListings = Array.from(
    new Set(rows.map((r) => r.listing_id)),
  ).sort();

  const totalListings = uniqueListings.length;

  if (totalListings < 2) {
    // Not enough listings to split — return accuracy of 0 to signal cold-start
    return { accuracyOnHeldout: 0, trainedListings: totalListings, heldOutListings: 0 };
  }

  // 80/20 split at listing boundary
  const trainCount = Math.max(1, Math.floor(totalListings * 0.8));
  const trainSet = new Set(uniqueListings.slice(0, trainCount));
  const heldOutSet = new Set(uniqueListings.slice(trainCount));

  const heldOutLabels = rows.filter((r) => heldOutSet.has(r.listing_id));

  if (heldOutLabels.length === 0) {
    return {
      accuracyOnHeldout: 0,
      trainedListings: trainSet.size,
      heldOutListings: heldOutSet.size,
    };
  }

  // Compute accuracy on held-out labels
  const correct = heldOutLabels.filter((r) => {
    const pred = r.model_prediction_at_time as number;
    return (
      (r.operator_verdict === "good" && pred >= 0.5) ||
      (r.operator_verdict === "bad" && pred < 0.5)
    );
  });

  return {
    accuracyOnHeldout: correct.length / heldOutLabels.length,
    trainedListings: trainSet.size,
    heldOutListings: heldOutSet.size,
  };
}
