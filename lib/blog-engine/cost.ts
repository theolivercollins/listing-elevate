import type { SupabaseClient } from "@supabase/supabase-js";
import { recordCost, type CostStage } from "../cost.js";

export type BlogCostStage = Extract<CostStage,
  | "blog_research"
  | "blog_topic_distill"
  | "blog_draft"
  | "blog_regen"
  | "blog_rewrite"
  | "blog_image_tag"
  | "blog_correction_distill"
  | "blog_publish_browser"
  | "blog_ai_draft"
>;

export interface BlogCostInput {
  stage: BlogCostStage;
  /** Cost in integer cents — matches the existing `cost_events.cost_cents` column. */
  cost_cents: number;
  post_id: string | null;
  site_id: string;
  provider: string;
  /** Free-form context — written to `cost_events.metadata` (jsonb). */
  metadata?: Record<string, unknown>;
}

export async function recordBlogCost(
  supabase: SupabaseClient,
  input: BlogCostInput,
): Promise<void> {
  await recordCost(supabase, {
    stage: input.stage,
    cost_cents: input.cost_cents,
    provider: input.provider,
    post_id: input.post_id,
    site_id: input.site_id,
    metadata: input.metadata,
  });
}
