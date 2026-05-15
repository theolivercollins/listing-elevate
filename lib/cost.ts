// lib/cost.ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * cost_events.stage values used across the codebase.
 * Add new values here as features land — this is just for type safety;
 * the DB column is unconstrained text.
 */
export type CostStage =
  // Blog engine (see lib/blog-engine/cost.ts for the originals)
  | "blog_research"
  | "blog_topic_distill"
  | "blog_draft"
  | "blog_regen"
  | "blog_rewrite"
  | "blog_image_tag"
  | "blog_correction_distill"
  | "blog_publish_browser"
  | "blog_ai_draft"
  // Homepage Ally
  | "marketing_chat";

export interface CostInput {
  stage: CostStage;
  cost_cents: number;
  provider: string;
  /** Free-form context written to `cost_events.metadata` (jsonb). */
  metadata?: Record<string, unknown>;
  /** Optional FK to blog_posts.id; null for non-blog stages. */
  post_id?: string | null;
  /** Optional FK to blog_sites.id; null for non-blog stages. */
  site_id?: string | null;
}

export async function recordCost(
  supabase: SupabaseClient,
  input: CostInput,
): Promise<void> {
  const { error } = await supabase.from("cost_events").insert([{
    stage: input.stage,
    cost_cents: input.cost_cents,
    provider: input.provider,
    post_id: input.post_id ?? null,
    site_id: input.site_id ?? null,
    metadata: input.metadata ?? {},
  }]);
  if (error) throw new Error(`recordCost failed: ${error.message}`);
}
