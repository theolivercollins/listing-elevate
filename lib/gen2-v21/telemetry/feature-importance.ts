import type { SupabaseClient } from "@supabase/supabase-js";

export interface FeatureImportanceSnapshot {
  model_id: string;
  trained_at: string;
  top_features: Record<string, number>;
}

/**
 * Persists the top-feature importance object for a picker model.
 * Writes to gen2_picker_models.top_features (JSONB column).
 * Safe to call after every retrain cycle.
 *
 * @param supabase       Supabase client
 * @param model_id       UUID of the gen2_picker_models row
 * @param top_features   Feature name → gain/weight map (shape is caller-defined)
 */
export async function snapshotFeatureImportance(
  supabase: SupabaseClient,
  model_id: string,
  top_features: object,
): Promise<void> {
  const { error } = await supabase
    .from("gen2_picker_models")
    .update({ top_features })
    .eq("model_id", model_id);

  if (error) {
    throw new Error(
      `snapshotFeatureImportance failed for model ${model_id}: ${error.message}`,
    );
  }
}

/**
 * Fetches the feature-importance timeline for the ObservabilityPanel dashboard.
 * Returns models ordered by trained_at ascending (oldest first) so the UI can
 * render a chart of how feature weights shift over time.
 *
 * @param supabase          Supabase client
 * @param opts.activeOnly   If true, only returns rows where top_features IS NOT NULL
 */
export async function fetchTopFeatures(
  supabase: SupabaseClient,
  opts: { activeOnly: boolean },
): Promise<FeatureImportanceSnapshot[]> {
  let query = supabase
    .from("gen2_picker_models")
    .select("model_id, trained_at, top_features")
    .order("trained_at", { ascending: true });

  if (opts.activeOnly) {
    query = query.not("top_features", "is", null);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`fetchTopFeatures failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    model_id: row.model_id as string,
    trained_at: row.trained_at as string,
    top_features: (row.top_features ?? {}) as Record<string, number>,
  }));
}
