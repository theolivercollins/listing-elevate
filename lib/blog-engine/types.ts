// lib/blog-engine/types.ts

export type BlogPostState =
  | 'research_due' | 'topics_proposed' | 'topic_picked'
  | 'draft_due' | 'draft_ready' | 'awaiting_approval'
  | 'publish_due' | 'publishing' | 'live'
  | 'edit_pending' | 'editing' | 'quarantined';

export type BlogJobKind =
  | 'research' | 'distill_topics' | 'draft' | 'image_match'
  | 'publish' | 'edit' | 'fetch_taxonomy' | 'distill_correction';

export type BlogJobState = 'queued' | 'running' | 'done' | 'failed';

export interface BlogSite {
  id: string;
  name: string;
  host_kind: 'sierra' | 'agent_fire';
  base_url: string;
  bot_credentials_ref: string | null;
  default_author_id: string | null;
  default_category_id: string | null;
  taxonomy_cache: { authors?: TaxonomyOption[]; categories?: TaxonomyOption[] };
  browserbase_context_id: string | null;
  active: boolean;
  created_at: string;
}

export interface TaxonomyOption {
  id: string;
  label: string;
}

export interface BlogPost {
  id: string;
  site_id: string;
  state: BlogPostState;
  title: string;
  slug: string | null;
  body_html: string;
  meta_title: string | null;
  meta_description: string | null;
  meta_tags: string[];
  image_id: string | null;
  author_label: string | null;
  category_label: string | null;
  external_post_url: string | null;
  external_post_id: string | null;
  publish_at: string | null;
  regen_count: number;
  cost_usd_cents: number;
  created_at: string;
  updated_at: string;
}

export interface BlogJob {
  id: string;
  post_id: string | null;
  site_id: string;
  kind: BlogJobKind;
  state: BlogJobState;
  attempts: number;
  last_error: string | null;
  browserbase_session_id: string | null;
  replay_url: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}
