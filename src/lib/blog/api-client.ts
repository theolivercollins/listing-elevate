// src/lib/blog/api-client.ts
import { supabase } from "../supabase";
import type {
  BlogPostListItem,
  BlogPostDetail,
  BlogImage,
  BlogJob,
  CreatePostInput,
  UpdatePostInput,
  BlogPostState,
  BlogTemplate,
  AIDraftInput,
  AIDraftResult,
  AnalyzeTemplateResult,
  Taxonomy,
} from "./types";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body || "request failed"}`);
  }
  return res.json() as Promise<T>;
}

export interface ListPostsParams {
  state?: BlogPostState | BlogPostState[];
  q?: string;
  cursor?: string;
  limit?: number;
}

export async function listPosts(
  params: ListPostsParams = {}
): Promise<{ posts: BlogPostListItem[]; next_cursor: string | null }> {
  const qs = new URLSearchParams();
  if (params.state)
    qs.set(
      "state",
      Array.isArray(params.state) ? params.state.join(",") : params.state
    );
  if (params.q) qs.set("q", params.q);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(`/api/blog/posts?${qs.toString()}`, {
    headers: await authHeaders(),
  });
  return asJson(res);
}

export async function getPost(
  id: string
): Promise<{ post: BlogPostDetail; jobs: BlogJob[]; cost_events: number }> {
  const res = await fetch(`/api/blog/posts/${id}`, {
    headers: await authHeaders(),
  });
  return asJson(res);
}

export async function createPost(input: CreatePostInput): Promise<{ id: string }> {
  const res = await fetch("/api/blog/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
  });
  return asJson(res);
}

export async function updatePost(
  id: string,
  patch: UpdatePostInput
): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/posts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(patch),
  });
  return asJson(res);
}

export async function publishPost(id: string): Promise<{ job_id: string }> {
  const res = await fetch(`/api/blog/posts/${id}/publish`, {
    method: "POST",
    headers: await authHeaders(),
  });
  return asJson(res);
}

export async function rejectPost(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/posts/${id}/reject`, {
    method: "POST",
    headers: await authHeaders(),
  });
  return asJson(res);
}

export async function deletePost(
  id: string,
  opts: { fromDashboard?: boolean; fromSierra?: boolean } = {},
): Promise<{ ok: true; job_id: string | null }> {
  const res = await fetch(`/api/blog/posts/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      fromDashboard: opts.fromDashboard !== false,
      fromSierra: opts.fromSierra === true,
    }),
  });
  return asJson(res);
}

export async function setHold(id: string, hold: boolean): Promise<{ ok: true; state: string }> {
  const res = await fetch(`/api/blog/posts/${id}/hold`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ hold }),
  });
  return asJson(res);
}

export async function editOnSierra(
  id: string,
  fields_changed: string[]
): Promise<{ job_id: string }> {
  const res = await fetch(`/api/blog/posts/${id}/edit-on-sierra`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ fields_changed }),
  });
  return asJson(res);
}

export async function listImages(
  params: { tag?: string; q?: string; limit?: number } = {}
): Promise<{ images: BlogImage[] }> {
  const qs = new URLSearchParams();
  if (params.tag) qs.set("tag", params.tag);
  if (params.q) qs.set("q", params.q);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(`/api/blog/images?${qs.toString()}`, {
    headers: await authHeaders(),
  });
  return asJson(res);
}

export async function uploadImage(
  file: File,
  folderHint?: string
): Promise<BlogImage> {
  const fd = new FormData();
  fd.append("file", file);
  if (folderHint) fd.append("folder_hint", folderHint);
  const res = await fetch("/api/blog/images", {
    method: "POST",
    headers: await authHeaders(), // do NOT set Content-Type for multipart
    body: fd,
  });
  return asJson<{ image: BlogImage }>(res).then((j) => j.image);
}

export async function updateImage(
  id: string,
  patch: { vision_tags?: string[]; active?: boolean }
): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/images/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(patch),
  });
  return asJson(res);
}

export async function deleteImage(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/images/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return asJson(res);
}

// Templates
export async function listTemplates(): Promise<{ templates: BlogTemplate[] }> {
  const res = await fetch("/api/blog/templates", { headers: await authHeaders() });
  return asJson(res);
}
export async function getTemplate(id: string): Promise<{ template: BlogTemplate }> {
  const res = await fetch(`/api/blog/templates/${id}`, { headers: await authHeaders() });
  return asJson(res);
}
export async function createTemplate(input: {
  name: string;
  description?: string;
  body_html: string;
  default_author_label?: string | null;
  default_category_label?: string | null;
  default_meta_title?: string | null;
  default_meta_description?: string | null;
  default_meta_tags?: string[];
}): Promise<{ id: string }> {
  const res = await fetch("/api/blog/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
  });
  return asJson(res);
}
export async function updateTemplate(id: string, patch: Partial<{
  name: string;
  description: string | null;
  body_html: string;
  default_author_label: string | null;
  default_category_label: string | null;
  default_meta_title: string | null;
  default_meta_description: string | null;
  default_meta_tags: string[];
}>): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/templates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(patch),
  });
  return asJson(res);
}
export async function deleteTemplate(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/templates/${id}`, { method: "DELETE", headers: await authHeaders() });
  return asJson(res);
}

// Taxonomy
export async function getTaxonomy(): Promise<Taxonomy> {
  const res = await fetch("/api/blog/taxonomy", { headers: await authHeaders() });
  return asJson(res);
}

// AI draft
export async function generateAIDraft(input: AIDraftInput): Promise<AIDraftResult> {
  const res = await fetch("/api/blog/ai/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
  });
  return asJson(res);
}

// AI multi-turn chat — builds a post conversationally.
export interface AIChatMessage { role: "user" | "assistant"; content: string; }
export interface AIResearchSource { url: string; title: string; snippet?: string; }
export interface AIChatOptions {
  templateId?: string | null;
  includeRecentPosts?: boolean;
  /**
   * "auto"   — Ally decides per turn (default)
   * "always" — research every turn
   * "never"  — never research
   */
  researchMode?: "auto" | "always" | "never";
  attachments?: AIAttachment[];
}
export interface AIChatResponse {
  reply: string;
  body_html: string;
  title: string | null;
  meta_title: string | null;
  meta_description: string | null;
  meta_tags: string[] | null;
  author: string | null;
  category: string | null;
  action: "publish" | "save_draft" | null;
  suggest_research: boolean;
  changes_summary: string | null;
  research_sources: AIResearchSource[];
  cost_cents: number;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}
export async function aiChat(
  messages: AIChatMessage[],
  currentHtml: string,
  opts: AIChatOptions = {},
): Promise<AIChatResponse> {
  const res = await fetch("/api/blog/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      messages,
      current_html: currentHtml,
      template_id: opts.templateId ?? null,
      include_recent_posts: opts.includeRecentPosts === true,
      research_mode: opts.researchMode ?? "auto",
      attachments: opts.attachments && opts.attachments.length ? opts.attachments : undefined,
    }),
  });
  return asJson(res);
}

// Analyze template
export async function analyzeTemplate(body_html: string): Promise<AnalyzeTemplateResult> {
  const res = await fetch("/api/blog/ai/analyze-template", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ body_html }),
  });
  return asJson(res);
}
