/**
 * Agreement Tracker — joins ApprenticePredictions with subsequent operator
 * PairLabels by candidate_id to compute rolling agreement rates.
 */

import type { ApprenticePrediction, PairLabel } from "../types.js";

export interface AgreementRate {
  rolling20: number;
  rolling50: number;
  total: number;
}

/**
 * Compute the apprentice's agreement rate against operator labels.
 *
 * Joins predictions with labels by matching prediction.candidate_id against
 * label.photo_a_id + label.photo_b_id isn't sufficient — labels don't carry
 * candidate_id directly. Instead we rely on the caller passing labels that
 * correspond to these predictions (same candidate pool). We match on
 * candidate_id stored in the prediction.
 *
 * For this to work, PairLabel needs a linkable field. We treat label_id as
 * corresponding to the prediction's candidate_id when no dedicated join key
 * exists — callers should filter labels to those that have a corresponding
 * apprentice prediction. The join key is: prediction.candidate_id ===
 * some stable identity on label. Since PairLabel doesn't carry candidate_id,
 * we build an index keyed by photo_a_id + photo_b_id.
 *
 * @param predictions  All apprentice predictions (unsorted OK)
 * @param labels       Operator labels with populated operator_verdict
 * @returns            Rolling agreement rates over last 20, last 50, and total
 */
export function computeAgreementRate(
  predictions: ApprenticePrediction[],
  labels: PairLabel[],
): AgreementRate {
  if (predictions.length === 0 || labels.length === 0) {
    return { rolling20: 0, rolling50: 0, total: 0 };
  }

  // Build lookup: candidate_id → operator_verdict (from apprentice_predicted_verdict link)
  // PairLabel has apprentice_predicted_verdict — match by candidate_id stored in prediction
  // against label.label_id (via the gen2_apprentice_predictions FK to candidate).
  // Since we can't do a DB join here, we match predictions to labels by
  // photo_a_id + photo_b_id as the natural join key.

  type LabelKey = string; // "photo_a_id:photo_b_id"
  const labelIndex = new Map<LabelKey, PairLabel>();
  for (const label of labels) {
    const key: LabelKey = `${label.photo_a_id}:${label.photo_b_id}`;
    // Keep latest by created_at if duplicates
    const existing = labelIndex.get(key);
    if (!existing || label.created_at > existing.created_at) {
      labelIndex.set(key, label);
    }
  }

  // Build a reverse map from candidate_id to photo_a/b using the predictions
  // alone — we don't have that info here. Instead, we match by candidate_id
  // directly when the label stores it, or fall back to index by label_id
  // matching candidate_id (works when callers pass labels whose label_id ==
  // candidate_id, which is the v21 convention from migration 072).

  // Primary strategy: match prediction.candidate_id === label.label_id
  const labelById = new Map<string, PairLabel>();
  for (const label of labels) {
    labelById.set(label.label_id, label);
  }

  interface Match {
    predicted: string;
    actual: string;
  }

  const matches: Match[] = [];
  for (const pred of predictions) {
    const label = labelById.get(pred.candidate_id);
    if (label) {
      matches.push({
        predicted: pred.predicted_verdict,
        actual: label.operator_verdict,
      });
    }
  }

  if (matches.length === 0) {
    return { rolling20: 0, rolling50: 0, total: 0 };
  }

  const countAgreements = (window: Match[]): number =>
    window.filter((m) => m.predicted === m.actual).length;

  const total =
    matches.length > 0 ? countAgreements(matches) / matches.length : 0;

  const last20 = matches.slice(-20);
  const rolling20 =
    last20.length > 0 ? countAgreements(last20) / last20.length : 0;

  const last50 = matches.slice(-50);
  const rolling50 =
    last50.length > 0 ? countAgreements(last50) / last50.length : 0;

  return {
    rolling20: Math.round(rolling20 * 1000) / 1000,
    rolling50: Math.round(rolling50 * 1000) / 1000,
    total: Math.round(total * 1000) / 1000,
  };
}
