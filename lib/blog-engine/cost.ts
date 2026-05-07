import type { SupabaseClient } from '@supabase/supabase-js';

export type BlogCostStage =
  | 'blog_research'
  | 'blog_topic_distill'
  | 'blog_draft'
  | 'blog_regen'
  | 'blog_rewrite'
  | 'blog_image_tag'
  | 'blog_correction_distill'
  | 'blog_publish_browser';

export interface BlogCostInput {
  stage: BlogCostStage;
  cost_usd_cents: number;
  post_id: string | null;
  site_id: string;
  provider: string;
  meta?: Record<string, unknown>;
}

export async function recordBlogCost(
  supabase: SupabaseClient,
  input: BlogCostInput,
): Promise<void> {
  const { error: costErr } = await supabase
    .from('cost_events')
    .insert([{
      stage: input.stage,
      cost_usd_cents: input.cost_usd_cents,
      post_id: input.post_id,
      site_id: input.site_id,
      provider: input.provider,
      meta: input.meta ?? {},
    }]);
  if (costErr) {
    throw new Error(`recordBlogCost failed: ${costErr.message}`);
  }
}
