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
