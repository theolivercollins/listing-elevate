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
