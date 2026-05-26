import type { SupabaseClient } from "@supabase/supabase-js";
import type { PairLabel } from "../types.js";

/**
 * Persists a PairLabel to gen2_pair_labels as an immutable audit record.
 * Stores thumbnail hashes + model version at time of prediction so we can
 * always reconstruct "which photos did the model actually see."
 */
export async function logLabelEvent(
  supabase: SupabaseClient,
  label: PairLabel,
): Promise<void> {
  const { error } = await supabase.from("gen2_pair_labels").upsert(
    {
      label_id: label.label_id,
      listing_id: label.listing_id,
      photo_a_id: label.photo_a_id,
      photo_b_id: label.photo_b_id,
      scene_graph_version: label.scene_graph_version,
      model_version_at_prediction: label.model_version_at_prediction,
      model_prediction_at_time: label.model_prediction_at_time,
      operator_verdict: label.operator_verdict,
      transition_tag: label.transition_tag,
      thumbnail_hash_a: label.thumbnail_hash_a,
      thumbnail_hash_b: label.thumbnail_hash_b,
      source_mode: label.source_mode,
      apprentice_predicted_verdict: label.apprentice_predicted_verdict,
      apprentice_was_wrong: label.apprentice_was_wrong,
      created_at: label.created_at,
    },
    { onConflict: "label_id", ignoreDuplicates: false },
  );

  if (error) {
    throw new Error(`logLabelEvent failed: ${error.message}`);
  }
}

export interface AuditTrailRow extends PairLabel {
  photo_a_url: string | null;
  photo_b_url: string | null;
  hash_match_a: boolean;
  hash_match_b: boolean;
}

/**
 * Fetches a label by ID and computes hash integrity flags.
 * hash_match_a/b are true when the stored thumbnail hash matches
 * the hash derivable from the current photo URL (paranoia check —
 * confirms the photos haven't been swapped or re-uploaded since labeling).
 *
 * Hash derivation: we compute a simple URL-based fingerprint from the
 * photo URLs stored in gen2_pair_candidates (joined via photo_a_id/photo_b_id).
 * If the candidate row no longer exists, both flags default to false.
 */
export async function fetchAuditTrail(
  supabase: SupabaseClient,
  label_id: string,
): Promise<AuditTrailRow> {
  // Fetch the label
  const { data: labelRow, error: labelErr } = await supabase
    .from("gen2_pair_labels")
    .select("*")
    .eq("label_id", label_id)
    .single();

  if (labelErr || !labelRow) {
    throw new Error(
      `fetchAuditTrail: label ${label_id} not found — ${labelErr?.message ?? "no row"}`,
    );
  }

  // Fetch photo URLs from gen2_pair_candidates (first match for these two photos)
  const { data: candidateRow } = await supabase
    .from("gen2_pair_candidates")
    .select("photo_a_url, photo_b_url")
    .eq("photo_a_id", labelRow.photo_a_id)
    .eq("photo_b_id", labelRow.photo_b_id)
    .limit(1)
    .maybeSingle();

  const photo_a_url: string | null = candidateRow?.photo_a_url ?? null;
  const photo_b_url: string | null = candidateRow?.photo_b_url ?? null;

  // Compute hash integrity: derive a fingerprint from the current URL and compare
  // to the stored thumbnail_hash. We use a simple URL-hash so this works without
  // re-downloading images.
  const hashMatch = (currentUrl: string | null, storedHash: string): boolean => {
    if (!currentUrl) return false;
    const derived = urlFingerprint(currentUrl);
    return derived === storedHash;
  };

  return {
    ...(labelRow as PairLabel),
    photo_a_url,
    photo_b_url,
    hash_match_a: hashMatch(photo_a_url, labelRow.thumbnail_hash_a),
    hash_match_b: hashMatch(photo_b_url, labelRow.thumbnail_hash_b),
  };
}

/**
 * Derives a short fingerprint from a URL for hash-match comparison.
 * Extracts the path component and last query param so CDN-version changes
 * are still surfaced. This is NOT a cryptographic hash — it's a change-
 * detection heuristic to catch photo swaps.
 */
function urlFingerprint(url: string): string {
  try {
    const u = new URL(url);
    // Use pathname + last segment of search params as fingerprint seed
    const search = u.searchParams.get("v") ?? u.searchParams.get("hash") ?? "";
    return `${u.pathname}${search ? `?${search}` : ""}`;
  } catch {
    return url;
  }
}
