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
  EmailTemplate,
  EmailListItem,
  EmailDetail,
  CreateEmailInput,
  UpdateEmailInput,
  AIEmailChatResponse,
} from "./types";
import type { AIAttachment } from "./types";

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

// Ally persistent memory (per-site facts the user told her to remember).
export interface AllyMemory {
  id: string;
  site_id: string;
  content: string;
  created_at: string;
  active: boolean;
}
export async function listAllyMemories(): Promise<{ memories: AllyMemory[] }> {
  const res = await fetch("/api/blog/ai/memories", { headers: await authHeaders() });
  return asJson(res);
}
export async function deleteAllyMemory(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/ai/memories?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
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
  new_memory: { id: string; content: string } | null;
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

// ---------------------------------------------------------------------------
// Email Templates
// ---------------------------------------------------------------------------
export async function listEmailTemplates(): Promise<{ templates: EmailTemplate[] }> {
  const res = await fetch("/api/blog/email-templates", { headers: await authHeaders() });
  return asJson(res);
}
export async function getEmailTemplate(id: string): Promise<{ template: EmailTemplate }> {
  const res = await fetch(`/api/blog/email-templates/${id}`, { headers: await authHeaders() });
  return asJson(res);
}
export async function createEmailTemplate(input: {
  name: string;
  description?: string | null;
  design_json?: any;
  body_html?: string;
  default_subject?: string | null;
  default_preheader?: string | null;
  default_from_name?: string | null;
  default_from_email?: string | null;
  default_audience?: string | null;
}): Promise<{ id: string }> {
  const res = await fetch("/api/blog/email-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
  });
  return asJson(res);
}
export async function updateEmailTemplate(id: string, patch: Partial<{
  name: string;
  description: string | null;
  design_json: any;
  body_html: string;
  default_subject: string | null;
  default_preheader: string | null;
  default_from_name: string | null;
  default_from_email: string | null;
  default_audience: string | null;
  active: boolean;
}>): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/email-templates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(patch),
  });
  return asJson(res);
}
export async function deleteEmailTemplate(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/email-templates/${id}`, { method: "DELETE", headers: await authHeaders() });
  return asJson(res);
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------
export async function listEmails(
  params: { state?: string; q?: string; limit?: number } = {}
): Promise<{ emails: EmailListItem[] }> {
  const qs = new URLSearchParams();
  if (params.state) qs.set("state", params.state);
  if (params.q) qs.set("q", params.q);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(`/api/blog/emails?${qs.toString()}`, { headers: await authHeaders() });
  return asJson(res);
}
export async function getEmail(id: string): Promise<{ email: EmailDetail }> {
  const res = await fetch(`/api/blog/emails/${id}`, { headers: await authHeaders() });
  return asJson(res);
}
export async function createEmail(input: CreateEmailInput): Promise<{ id: string }> {
  const res = await fetch("/api/blog/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
  });
  return asJson(res);
}
export async function updateEmail(id: string, patch: UpdateEmailInput): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/emails/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(patch),
  });
  return asJson(res);
}
export async function deleteEmail(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/emails/${id}`, { method: "DELETE", headers: await authHeaders() });
  return asJson(res);
}
export async function sendEmail(
  id: string,
  opts?: { list_ids?: string[] }
): Promise<{ ok: true; message_id: string | null; sent_to_list_ids: string[]; sendy_response: string }> {
  const res = await fetch(`/api/blog/emails/${id}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(opts ?? {}),
  });
  return asJson(res);
}
export async function testSendEmail(
  id: string,
  listId?: string,
): Promise<{ ok: true; message_id: string | null; sent_to_list_id: string; subject: string; sendy_response: string }> {
  const res = await fetch(`/api/blog/emails/${id}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(listId ? { list_id: listId } : {}),
  });
  return asJson(res);
}

// ---------------------------------------------------------------------------
// Ally Email AI
// ---------------------------------------------------------------------------
export async function aiEmailChat(
  messages: AIChatMessage[],
  currentBodyHtml: string,
  opts: {
    researchMode?: "auto" | "always" | "never";
    attachments?: AIAttachment[];
    sourcePostId?: string | null;
  } = {}
): Promise<AIEmailChatResponse> {
  const res = await fetch("/api/blog/ai/email-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      messages,
      current_html: currentBodyHtml,
      research_mode: opts.researchMode ?? "auto",
      attachments: opts.attachments && opts.attachments.length ? opts.attachments : undefined,
      source_post_id: opts.sourcePostId ?? null,
    }),
  });
  return asJson(res);
}

export async function aiEmailFromPost(postId: string): Promise<{
  subject: string;
  preheader: string;
  body_html: string;
  from_name: string;
  from_email: string;
  audience: string;
  cost_cents: number;
  model: string;
}> {
  const res = await fetch("/api/blog/ai/email-from-post", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ post_id: postId }),
  });
  return asJson(res);
}

