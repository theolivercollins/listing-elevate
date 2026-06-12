// src/lib/blog/types.ts
import type { BlogPostState } from "../../../lib/blog-engine/types";

export type { BlogPostState };

export interface BlogPostListItem {
  id: string;
  title: string;
  state: BlogPostState;
  image: { id: string; blob_url: string; vision_caption: string | null } | null;
  author_label: string | null;
  category_label: string | null;
  updated_at: string;
  cost_usd_cents: number;
  external_post_url: string | null;
  authored: "manual" | "auto";
}

export interface BlogPostDetail extends BlogPostListItem {
  site_id: string;
  slug: string | null;
  body_html: string;
  meta_title: string | null;
  meta_description: string | null;
  meta_tags: string[];
  image_id: string | null;
  publish_at: string | null;
  external_post_id: string | null;
  regen_count: number;
  created_at: string;
}

export interface BlogJob {
  id: string;
  kind: string;
  state: "queued" | "running" | "done" | "failed";
  last_error: string | null;
  replay_url: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface BlogImage {
  id: string;
  site_id: string | null;
  blob_url: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  vision_tags: string[];
  vision_caption: string | null;
  active: boolean;
  created_at: string;
}

export interface CreatePostInput {
  title: string;
  body_html: string;
  meta_title?: string | null;
  meta_description?: string | null;
  meta_tags?: string[];
  author_label?: string | null;
  category_label?: string | null;
  image_id?: string | null;
  publish_at?: string | null;
  initial_state: "awaiting_approval" | "publish_due";
  authored?: "manual" | "auto";
}

export interface UpdatePostInput {
  title?: string;
  body_html?: string;
  meta_title?: string | null;
  meta_description?: string | null;
  meta_tags?: string[];
  author_label?: string | null;
  category_label?: string | null;
  image_id?: string | null;
  publish_at?: string | null;
}

export interface BlogTemplate {
  id: string;
  site_id: string | null;
  name: string;
  description: string | null;
  body_html: string;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  default_author_label?: string | null;
  default_category_label?: string | null;
  default_meta_title?: string | null;
  default_meta_description?: string | null;
  default_meta_tags?: string[];
}

export interface Taxonomy {
  site_id: string;
  authors: Array<{ id: string; label: string }>;
  categories: Array<{ id: string; label: string }>;
}

export interface AIAttachment {
  kind: "pdf" | "image" | "text";
  filename: string;
  data: string;
  media_type?: string;
}

export interface AIDraftInput {
  prompt: string;
  template_id?: string | null;
  length: "short" | "standard" | "long";
  tone: "professional" | "casual" | "data_driven";
  attachments?: AIAttachment[];
  paste_data?: string | null;
}

export interface AIDraftResult {
  html: string;
  body_html: string;
  meta_title: string;
  meta_description: string;
  meta_tags: string[];
  cost_cents: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface AnalyzeTemplateResult {
  suggested_name: string;
  suggested_description: string;
  notes: string;
  detected_sections: string[];
  cost_cents: number;
  model: string;
}

// ---------------------------------------------------------------------------
// Email types
// ---------------------------------------------------------------------------

export type EmailState = "draft" | "ready" | "sending" | "sent" | "failed";

export interface EmailTemplate {
  id: string;
  site_id: string | null;
  name: string;
  description: string | null;
  design_json: any;
  body_html: string;
  thumbnail_url: string | null;
  default_subject: string | null;
  default_preheader: string | null;
  default_from_name: string | null;
  default_from_email: string | null;
  default_audience: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailListItem {
  id: string;
  subject: string;
  state: EmailState;
  preheader: string | null;
  audience: string | null;
  updated_at: string;
  sent_at: string | null;
  cost_usd_cents: number;
  source_post_id: string | null;
  authored: "manual" | "auto";
}

export interface EmailDetail extends EmailListItem {
  site_id: string;
  template_id: string | null;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  recipients_json: string[];
  design_json: any;
  body_html: string;
  body_text: string | null;
  send_provider: string | null;
  send_provider_message_id: string | null;
  sent_to: string[] | null;
  send_error: string | null;
  created_at: string;
}

export interface CreateEmailInput {
  subject?: string;
  preheader?: string | null;
  from_name?: string | null;
  from_email?: string | null;
  reply_to?: string | null;
  audience?: string | null;
  recipients_json?: string[];
  template_id?: string | null;
  source_post_id?: string | null;
  design_json?: any;
  body_html?: string;
  body_text?: string | null;
  authored?: "manual" | "auto";
  initial_state?: EmailState;
}

export interface UpdateEmailInput {
  subject?: string;
  preheader?: string | null;
  from_name?: string | null;
  from_email?: string | null;
  reply_to?: string | null;
  audience?: string | null;
  recipients_json?: string[];
  design_json?: any;
  body_html?: string;
  body_text?: string | null;
  state?: EmailState;
}

export interface AIEmailChatResponse {
  reply: string;
  subject: string | null;
  preheader: string | null;
  body_html: string;
  from_name: string | null;
  from_email: string | null;
  audience: string | null;
  action: "send" | "save_draft" | "test_send" | null;
  suggest_research: boolean;
  changes_summary: string | null;
  new_memory: { id: string; content: string } | null;
  research_sources: AIResearchSource[];
  cost_cents: number;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

export interface AIResearchSource {
  url: string;
  title: string;
  snippet?: string;
}
