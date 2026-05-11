# Blog Engine Phase 5 Implementation Plan

> Use superpowers:subagent-driven-development to execute. Checkboxes track progress.

**Spec:** [`docs/specs/2026-05-10-blog-engine-phase-5-design.md`](../specs/2026-05-10-blog-engine-phase-5-design.md)

**Goal:** Three-page portal UI under `/dashboard/blog/*` — Posts list, Post Detail (compose/edit/review/edit-live), Image Library. Manual authoring is first-class. Both flows (manual + auto-pipeline review) share the same editor.

**Tech stack additions:** Tiptap (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-image`). Everything else (TanStack Query, shadcn, Supabase client, auth helper) already in LE.

**Architecture summary:**
- New `api/blog/posts/*` and `api/blog/images/*` endpoints, all auth-gated via `requireAdmin`
- New `src/pages/dashboard/Blog*.tsx` pages mounted in `src/App.tsx`
- New `src/components/blog/*` shared components (editor, picker, upload)
- Migration 050 adds `blog_posts.metadata` + `blog_posts.active` columns
- No backend logic changes to Phase 1/2 — UI consumes existing job runner

---

## File structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/050_blog_posts_metadata_active.sql` | Two new columns on blog_posts |
| `api/blog/posts/index.ts` | GET (list) + POST (create) |
| `api/blog/posts/[id].ts` | GET (detail) + PATCH (update) |
| `api/blog/posts/[id]/publish.ts` | POST → transition state + enqueue publish job |
| `api/blog/posts/[id]/reject.ts` | POST → state=quarantined |
| `api/blog/posts/[id]/edit-on-sierra.ts` | POST → enqueue edit job with diff |
| `api/blog/images/index.ts` | GET (list) + POST (upload multipart) |
| `api/blog/images/[id].ts` | PATCH (retag) + DELETE (soft) |
| `src/lib/blog/api-client.ts` | Typed fetch wrappers |
| `src/lib/blog/types.ts` | Frontend-side types (mirrors backend rows) |
| `src/components/blog/PostEditor.tsx` | Tiptap wrapper |
| `src/components/blog/ImagePickerModal.tsx` | Browse + select |
| `src/components/blog/ImageUploadDropzone.tsx` | Drag-drop upload |
| `src/components/blog/PublishHistoryPanel.tsx` | Jobs + replay links |
| `src/pages/dashboard/BlogPostsList.tsx` | List page |
| `src/pages/dashboard/BlogPostDetail.tsx` | Compose/edit/review/edit-live |
| `src/pages/dashboard/BlogImageLibrary.tsx` | Grid + upload |
| Modified: `src/App.tsx` | Mount 4 routes |
| Modified: `src/components/TopNav.tsx` | "Blog" dropdown with 2 items |

---

## Task 1: Migration 050

**File:** `supabase/migrations/050_blog_posts_metadata_active.sql`

```sql
-- 050_blog_posts_metadata_active.sql
-- Phase 5: add metadata jsonb (for authored='manual'|'auto' flag and any
-- future free-form fields) and active boolean (for soft-archive from the
-- Posts list "Archive" row action).

alter table blog_posts add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table blog_posts add column if not exists active boolean not null default true;

create index if not exists blog_posts_active_idx on blog_posts(active) where active = true;
```

Controller applies via Supabase MCP after the commit. Implementer just writes the file + commits.

```bash
git add supabase/migrations/050_blog_posts_metadata_active.sql
git commit -m "feat(blog): migration 050 — blog_posts.metadata + active"
```

---

## Task 2: Frontend types + API client

**Files:**
- `src/lib/blog/types.ts`
- `src/lib/blog/api-client.ts`

**types.ts:**

```ts
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
```

**api-client.ts:** typed fetch helpers. Use `supabase.auth.getSession()` to attach the Bearer token to each request, mirroring the pattern in `src/components/Login.tsx` or similar.

```ts
// src/lib/blog/api-client.ts
import { supabase } from "../supabase";
import type {
  BlogPostListItem, BlogPostDetail, BlogImage,
  CreatePostInput, UpdatePostInput, BlogPostState,
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

export async function listPosts(params: ListPostsParams = {}): Promise<{ posts: BlogPostListItem[]; next_cursor: string | null }> {
  const qs = new URLSearchParams();
  if (params.state) qs.set("state", Array.isArray(params.state) ? params.state.join(",") : params.state);
  if (params.q) qs.set("q", params.q);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(`/api/blog/posts?${qs.toString()}`, { headers: await authHeaders() });
  return asJson(res);
}

export async function getPost(id: string): Promise<{ post: BlogPostDetail; jobs: BlogJob[]; cost_events: number }> {
  const res = await fetch(`/api/blog/posts/${id}`, { headers: await authHeaders() });
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

export async function updatePost(id: string, patch: UpdatePostInput): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/posts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(patch),
  });
  return asJson(res);
}

export async function publishPost(id: string): Promise<{ job_id: string }> {
  const res = await fetch(`/api/blog/posts/${id}/publish`, { method: "POST", headers: await authHeaders() });
  return asJson(res);
}

export async function rejectPost(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/posts/${id}/reject`, { method: "POST", headers: await authHeaders() });
  return asJson(res);
}

export async function editOnSierra(id: string, fields_changed: string[]): Promise<{ job_id: string }> {
  const res = await fetch(`/api/blog/posts/${id}/edit-on-sierra`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ fields_changed }),
  });
  return asJson(res);
}

export async function listImages(params: { tag?: string; q?: string; limit?: number } = {}): Promise<{ images: BlogImage[] }> {
  const qs = new URLSearchParams();
  if (params.tag) qs.set("tag", params.tag);
  if (params.q) qs.set("q", params.q);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(`/api/blog/images?${qs.toString()}`, { headers: await authHeaders() });
  return asJson(res);
}

export async function uploadImage(file: File, folderHint?: string): Promise<BlogImage> {
  const fd = new FormData();
  fd.append("file", file);
  if (folderHint) fd.append("folder_hint", folderHint);
  const res = await fetch("/api/blog/images", {
    method: "POST",
    headers: await authHeaders(),         // do NOT set Content-Type for multipart
    body: fd,
  });
  return asJson<{ image: BlogImage }>(res).then(j => j.image);
}

export async function updateImage(id: string, patch: { vision_tags?: string[]; active?: boolean }): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/images/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(patch),
  });
  return asJson(res);
}

export async function deleteImage(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/images/${id}`, { method: "DELETE", headers: await authHeaders() });
  return asJson(res);
}
```

Verify: `npx tsc --noEmit` clean.

```bash
git add src/lib/blog/types.ts src/lib/blog/api-client.ts
git commit -m "feat(blog/ui): frontend types + api-client"
```

---

## Task 3: Posts API endpoints

**Files:**
- `api/blog/posts/index.ts`
- `api/blog/posts/[id].ts`
- `api/blog/posts/[id]/publish.ts`
- `api/blog/posts/[id]/reject.ts`
- `api/blog/posts/[id]/edit-on-sierra.ts`

All use `requireAdmin(req, res)` from `lib/auth.ts`. All use `getSupabase()` from `lib/client.ts`. Return JSON. Standard handler shape:

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../lib/auth.js";
import { getSupabase } from "../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  // ...
}
```

**`api/blog/posts/index.ts` (GET list, POST create):**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    const state = req.query.state as string | undefined;
    const q = (req.query.q as string | undefined)?.trim();
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);

    let qb = supabase
      .from("blog_posts")
      .select(`
        id, title, state, author_label, category_label, updated_at,
        cost_usd_cents, external_post_url, image_id, metadata,
        image:image_id (id, blob_url, vision_caption)
      `)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (state) {
      const states = state.split(",");
      qb = qb.in("state", states);
    }
    if (q) qb = qb.or(`title.ilike.%${q}%,meta_title.ilike.%${q}%`);
    if (cursor) qb = qb.lt("updated_at", cursor);

    const { data, error } = await qb;
    if (error) return res.status(500).json({ error: error.message });

    const posts = (data ?? []).map((row: any) => ({
      ...row,
      authored: row.metadata?.authored ?? "manual",
      image: Array.isArray(row.image) ? row.image[0] ?? null : row.image,
    }));
    const next_cursor = posts.length === limit ? posts[posts.length - 1].updated_at : null;
    return res.status(200).json({ posts, next_cursor });
  }

  if (req.method === "POST") {
    const b = req.body ?? {};
    if (!b.title || !b.body_html || !b.initial_state) {
      return res.status(400).json({ error: "title, body_html, initial_state required" });
    }
    if (!["awaiting_approval", "publish_due"].includes(b.initial_state)) {
      return res.status(400).json({ error: "initial_state must be awaiting_approval or publish_due" });
    }

    const { data: site } = await supabase
      .from("blog_sites").select("id").eq("host_kind", "sierra").single();
    if (!site) return res.status(500).json({ error: "no Sierra site" });

    const authored = b.authored ?? "manual";
    const { data: post, error } = await supabase.from("blog_posts").insert([{
      site_id: site.id,
      state: b.initial_state,
      title: b.title,
      body_html: b.body_html,
      meta_title: b.meta_title ?? null,
      meta_description: b.meta_description ?? null,
      meta_tags: b.meta_tags ?? [],
      author_label: b.author_label ?? null,
      category_label: b.category_label ?? null,
      image_id: b.image_id ?? null,
      publish_at: b.publish_at ?? null,
      metadata: { authored },
    }]).select("id").single();
    if (error) return res.status(500).json({ error: error.message });

    if (b.initial_state === "publish_due") {
      const { error: jErr } = await supabase.from("blog_jobs").insert([{
        site_id: site.id, post_id: post!.id, kind: "publish", payload: {},
      }]);
      if (jErr) return res.status(500).json({ error: `post created but enqueue failed: ${jErr.message}` });
    }

    return res.status(201).json({ id: post!.id });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
```

**`api/blog/posts/[id].ts` (GET detail, PATCH update):**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

const EDITABLE = [
  "title", "body_html", "meta_title", "meta_description", "meta_tags",
  "author_label", "category_label", "image_id", "publish_at",
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  if (req.method === "GET") {
    const { data: post, error: pErr } = await supabase
      .from("blog_posts").select("*, image:image_id (id, blob_url, vision_caption, vision_tags)")
      .eq("id", id).single();
    if (pErr || !post) return res.status(404).json({ error: "not found" });

    const { data: jobs } = await supabase
      .from("blog_jobs")
      .select("id, kind, state, last_error, replay_url, started_at, finished_at, created_at")
      .eq("post_id", id)
      .order("created_at", { ascending: false })
      .limit(20);

    const { count: cost_events } = await supabase
      .from("cost_events").select("*", { count: "exact", head: true }).eq("post_id", id);

    return res.status(200).json({
      post: { ...post, authored: post.metadata?.authored ?? "manual" },
      jobs: jobs ?? [],
      cost_events: cost_events ?? 0,
    });
  }

  if (req.method === "PATCH") {
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) if (k in (req.body ?? {})) patch[k] = req.body[k];
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no editable fields in body" });
    patch.updated_at = new Date().toISOString();

    const { error } = await supabase.from("blog_posts").update(patch).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
```

**`api/blog/posts/[id]/publish.ts`:**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;

  const { data: post, error: pErr } = await supabase
    .from("blog_posts").select("id, site_id, state").eq("id", id).single();
  if (pErr || !post) return res.status(404).json({ error: "not found" });

  if (!["awaiting_approval", "draft_ready", "publish_due"].includes(post.state)) {
    return res.status(409).json({ error: `cannot publish from state '${post.state}'` });
  }

  if (post.state !== "publish_due") {
    await supabase.from("blog_posts").update({ state: "publish_due", updated_at: new Date().toISOString() }).eq("id", id);
  }
  const { data: job, error: jErr } = await supabase
    .from("blog_jobs").insert([{ site_id: post.site_id, post_id: id, kind: "publish", payload: {} }])
    .select("id").single();
  if (jErr) return res.status(500).json({ error: jErr.message });
  return res.status(202).json({ job_id: job!.id });
}
```

**`api/blog/posts/[id]/reject.ts`:**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;
  const { error } = await supabase
    .from("blog_posts").update({ state: "quarantined", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
```

**`api/blog/posts/[id]/edit-on-sierra.ts`:**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;
  const fieldsChanged = (req.body?.fields_changed as string[] | undefined) ?? [];
  if (!Array.isArray(fieldsChanged) || fieldsChanged.length === 0) {
    return res.status(400).json({ error: "fields_changed must be a non-empty array" });
  }

  const { data: post, error: pErr } = await supabase
    .from("blog_posts").select("id, site_id, state, external_post_url").eq("id", id).single();
  if (pErr || !post) return res.status(404).json({ error: "not found" });
  if (post.state !== "live") return res.status(409).json({ error: "post is not live" });
  if (!post.external_post_url) return res.status(409).json({ error: "post has no external_post_url" });

  const { data: job, error: jErr } = await supabase.from("blog_jobs").insert([{
    site_id: post.site_id, post_id: id, kind: "edit",
    payload: { fields_changed: fieldsChanged },
  }]).select("id").single();
  if (jErr) return res.status(500).json({ error: jErr.message });
  return res.status(202).json({ job_id: job!.id });
}
```

Verify: `npx tsc --noEmit` clean.

```bash
git add api/blog/posts/
git commit -m "feat(blog/api): posts CRUD + publish/reject/edit endpoints"
```

---

## Task 4: Images API endpoints

**Files:**
- `api/blog/images/index.ts` — GET list + POST upload (multipart)
- `api/blog/images/[id].ts` — PATCH + DELETE

**Upload** uses `formidable` or busboy to parse multipart. LE doesn't have one installed yet — use `busboy` (lightweight, fewer deps): `npm install busboy @types/busboy`. The upload handler:

1. Parse multipart with busboy
2. Read file into Buffer
3. Compute SHA-256 (file_hash)
4. Check dedup: if exists, return existing row
5. Determine mime + ext
6. Call `uploadImageBuffer` from `lib/blog-engine/image-storage.ts`
7. INSERT blog_images row with `metadata: { folder_hint, original_filename }`
8. **Inline vision tag** — call the tagger directly (not via job) so the user sees tags immediately:
   - Import `tagImage` + `recordBlogCost`
   - Same `GoogleGenAI` wiring as `lib/blog-engine/jobs/handlers/image-tag.ts`
   - Update the just-inserted row with tags + caption + embedding
   - Record cost event
9. Return `{ image: { ... fully populated ... } }`

**Important:** vision tagging adds ~3-5s of latency to the upload. That's acceptable for a single drag-drop, but for multi-file batches the UI should call /upload once per file in parallel (with a small concurrency cap like 3).

```ts
// api/blog/images/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Busboy from "busboy";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { uploadImageBuffer } from "../../../lib/blog-engine/image-storage.js";
import { tagImage } from "../../../lib/blog-engine/image-tagging.js";
import { recordBlogCost } from "../../../lib/blog-engine/cost.js";

export const config = { api: { bodyParser: false } };

let _gemini: GoogleGenAI | null = null;
function gemini() {
  if (!_gemini) _gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return _gemini;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    const tag = req.query.tag as string | undefined;
    const q = (req.query.q as string | undefined)?.trim();
    const limit = Math.min(Number(req.query.limit ?? 200), 500);

    let qb = supabase.from("blog_images").select("*").eq("active", true)
      .order("created_at", { ascending: false }).limit(limit);
    if (tag) qb = qb.contains("vision_tags", [tag]);
    if (q) qb = qb.ilike("vision_caption", `%${q}%`);

    const { data, error } = await qb;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ images: data ?? [] });
  }

  if (req.method === "POST") {
    return parseAndUpload(req, res, supabase);
  }

  return res.status(405).end();
}

async function parseAndUpload(req: VercelRequest, res: VercelResponse, supabase: any) {
  const bb = Busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024 } });
  let fileBuffer: Buffer | null = null;
  let originalFilename = "image.jpg";
  let folderHint: string | undefined;

  await new Promise<void>((resolve, reject) => {
    bb.on("file", (_name, stream, info) => {
      originalFilename = info.filename || originalFilename;
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => { fileBuffer = Buffer.concat(chunks); });
      stream.on("limit", () => reject(new Error("file > 10MB")));
    });
    bb.on("field", (name, val) => { if (name === "folder_hint") folderHint = val; });
    bb.on("close", () => resolve());
    bb.on("error", reject);
    req.pipe(bb);
  });

  if (!fileBuffer) return res.status(400).json({ error: "file required" });

  const hash = createHash("sha256").update(fileBuffer).digest("hex");
  const { data: existing } = await supabase
    .from("blog_images").select("*").eq("file_hash", hash).maybeSingle();
  if (existing) return res.status(200).json({ image: existing, deduped: true });

  const { data: site } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) return res.status(500).json({ error: "no Sierra site" });

  const ext = extname(originalFilename).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

  const upload = await uploadImageBuffer(supabase, {
    buffer: fileBuffer, siteId: site.id, fileHash: hash, mime, filenameExt: ext,
  });

  const { data: imgRow, error: iErr } = await supabase.from("blog_images").insert([{
    site_id: site.id,
    blob_url: upload.blob_url, mime: upload.mime,
    width: upload.width, height: upload.height,
    file_hash: hash,
    metadata: { folder_hint: folderHint ?? null, original_filename: originalFilename },
  }]).select("*").single();
  if (iErr) return res.status(500).json({ error: iErr.message });

  // Inline vision tag.
  try {
    const tagged = await tagImage(
      { buffer: fileBuffer, filename: originalFilename, folderHint },
      {
        vision: async ({ prompt, imageBase64, mime }) => {
          const r = await gemini().models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ inlineData: { data: imageBase64, mimeType: mime } }, { text: prompt }] }],
            config: { responseMimeType: "application/json", temperature: 0.1 },
          });
          return { text: (r as any).text ?? "" };
        },
        embed: async (text: string) => {
          const r = await gemini().models.embedContent({
            model: "gemini-embedding-2",
            contents: [{ parts: [{ text }] }],
            config: { outputDimensionality: 768 },
          });
          const v = (r as any)?.embeddings?.[0]?.values ?? (r as any)?.embedding?.values;
          if (!v || v.length !== 768) throw new Error("embed bad shape");
          return v;
        },
      },
    );
    await supabase.from("blog_images").update({
      vision_tags: tagged.tags, vision_caption: tagged.caption, embedding: tagged.embedding,
    }).eq("id", imgRow.id);
    await recordBlogCost(supabase, {
      stage: "blog_image_tag", cost_cents: tagged.costCents,
      post_id: null, site_id: site.id, provider: "gemini",
      metadata: { image_id: imgRow.id, vision_tags: tagged.tags, inline: true },
    });

    return res.status(201).json({
      image: { ...imgRow, vision_tags: tagged.tags, vision_caption: tagged.caption },
    });
  } catch (e: any) {
    // Tagging failed — image is still uploaded + row exists. Surface to client.
    return res.status(201).json({
      image: imgRow,
      tagging_error: e?.message ?? String(e),
    });
  }
}
```

**`api/blog/images/[id].ts`:**

```ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

const VOCAB = ["aerial","exterior","interior","team","area","lifestyle","event",
  "seasonal_spring","seasonal_summer","seasonal_fall","seasonal_winter","data_chart"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;

  if (req.method === "PATCH") {
    const patch: Record<string, unknown> = {};
    if (Array.isArray(req.body?.vision_tags)) {
      const tags = req.body.vision_tags.filter((t: any) => typeof t === "string" && VOCAB.includes(t));
      patch.vision_tags = tags;
    }
    if (typeof req.body?.active === "boolean") patch.active = req.body.active;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no editable fields" });
    const { error } = await supabase.from("blog_images").update(patch).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { error } = await supabase.from("blog_images").update({ active: false }).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
```

Install busboy:

```bash
npm install busboy @types/busboy
```

```bash
git add api/blog/images/ package.json package-lock.json
git commit -m "feat(blog/api): images list + multipart upload + retag + soft-delete"
```

---

## Task 5: Frontend dependencies + PostEditor component

**Install Tiptap:**

```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-image
```

**`src/components/blog/PostEditor.tsx`:**

```tsx
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExt from "@tiptap/extension-link";
import ImageExt from "@tiptap/extension-image";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Heading2, Heading3, Link2, Image as ImageIcon, List, ListOrdered, Quote, Undo, Redo } from "lucide-react";

interface PostEditorProps {
  value: string;
  onChange: (html: string) => void;
  onInsertImageClick: () => void;
}

export function PostEditor({ value, onChange, onInsertImageClick }: PostEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, LinkExt.configure({ openOnClick: false }), ImageExt],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  if (!editor) return null;

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b p-2">
        <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} icon={Bold} />
        <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} icon={Italic} />
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} icon={Heading2} />
        <ToolbarButton active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} icon={Heading3} />
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} icon={List} />
        <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={ListOrdered} />
        <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} icon={Quote} />
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton active={false} onClick={() => {
          const url = window.prompt("Link URL");
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }} icon={Link2} />
        <ToolbarButton active={false} onClick={onInsertImageClick} icon={ImageIcon} />
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton active={false} onClick={() => editor.chain().focus().undo().run()} icon={Undo} />
        <ToolbarButton active={false} onClick={() => editor.chain().focus().redo().run()} icon={Redo} />
      </div>
      <EditorContent editor={editor} className="prose prose-sm max-w-none p-4 min-h-[300px] focus-within:outline-none" />
    </div>
  );
}

function ToolbarButton({ active, onClick, icon: Icon }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Button type="button" variant={active ? "secondary" : "ghost"} size="sm" onClick={onClick} className="h-7 w-7 p-0">
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}
```

```bash
git add src/components/blog/PostEditor.tsx package.json package-lock.json
git commit -m "feat(blog/ui): Tiptap-based PostEditor component"
```

---

## Task 6: ImagePickerModal + ImageUploadDropzone + PublishHistoryPanel

**`src/components/blog/ImageUploadDropzone.tsx`:**

```tsx
import { useState, useCallback } from "react";
import { uploadImage } from "@/lib/blog/api-client";
import type { BlogImage } from "@/lib/blog/types";
import { Upload as UploadIcon } from "lucide-react";

interface Props {
  onUploaded: (img: BlogImage) => void;
  maxFiles?: number;
}

export function ImageUploadDropzone({ onUploaded, maxFiles = 10 }: Props) {
  const [progress, setProgress] = useState<Record<string, "uploading" | "tagging" | "done" | "error">>({});

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).slice(0, maxFiles);
    await Promise.all(arr.map(async (f) => {
      const key = `${f.name}-${f.size}`;
      setProgress(p => ({ ...p, [key]: "uploading" }));
      try {
        const img = await uploadImage(f);
        setProgress(p => ({ ...p, [key]: "done" }));
        onUploaded(img);
      } catch (e) {
        setProgress(p => ({ ...p, [key]: "error" }));
      }
    }));
  }, [maxFiles, onUploaded]);

  return (
    <div
      className="flex h-32 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/40 bg-muted/20 text-sm text-muted-foreground hover:bg-muted/40"
      onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
      onDragOver={e => e.preventDefault()}
      onClick={() => document.getElementById("blog-img-upload-input")?.click()}
    >
      <input id="blog-img-upload-input" type="file" accept="image/*" multiple className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
      <div className="flex flex-col items-center gap-2">
        <UploadIcon className="h-6 w-6" />
        <span>Drop images here or click to select</span>
        {Object.entries(progress).map(([k, v]) => <span key={k} className="text-xs">{k}: {v}</span>)}
      </div>
    </div>
  );
}
```

**`src/components/blog/ImagePickerModal.tsx`:** dialog with grid + tag-filter chips + search input + Upload tab. Click image to select, click confirm.

```tsx
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listImages } from "@/lib/blog/api-client";
import { ImageUploadDropzone } from "./ImageUploadDropzone";
import type { BlogImage } from "@/lib/blog/types";

const TAGS = ["aerial","exterior","interior","team","area","lifestyle","event","seasonal_summer","data_chart"];

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (img: BlogImage) => void;
}

export function ImagePickerModal({ open, onClose, onSelect }: Props) {
  const [images, setImages] = useState<BlogImage[]>([]);
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"library" | "upload">("library");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listImages({ tag: tag ?? undefined, q: q || undefined, limit: 200 })
      .then(r => setImages(r.images))
      .finally(() => setLoading(false));
  }, [open, tag, q]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Pick an image</DialogTitle></DialogHeader>
        <div className="flex gap-2 border-b pb-2">
          <Button size="sm" variant={tab === "library" ? "default" : "ghost"} onClick={() => setTab("library")}>Library</Button>
          <Button size="sm" variant={tab === "upload" ? "default" : "ghost"} onClick={() => setTab("upload")}>Upload new</Button>
        </div>

        {tab === "library" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 py-2">
              <Input placeholder="search caption…" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
              <Button size="sm" variant={tag === null ? "default" : "outline"} onClick={() => setTag(null)}>All</Button>
              {TAGS.map(t => (
                <Button key={t} size="sm" variant={tag === t ? "default" : "outline"} onClick={() => setTag(t)}>{t}</Button>
              ))}
            </div>
            {loading ? <div>Loading…</div> : (
              <div className="grid max-h-[60vh] grid-cols-4 gap-3 overflow-y-auto">
                {images.map(img => (
                  <button key={img.id} type="button" onClick={() => { onSelect(img); onClose(); }} className="overflow-hidden rounded-md border hover:ring-2 hover:ring-primary">
                    <img src={img.blob_url} alt={img.vision_caption ?? ""} className="aspect-[4/3] w-full object-cover" />
                    <div className="truncate p-1 text-left text-xs">{img.vision_caption ?? "—"}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <ImageUploadDropzone onUploaded={(img) => { setImages(prev => [img, ...prev]); setTab("library"); }} />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**`src/components/blog/PublishHistoryPanel.tsx`:** read-only table.

```tsx
import { useQuery } from "@tanstack/react-query";
import { getPost } from "@/lib/blog/api-client";

interface Props { postId: string; }

export function PublishHistoryPanel({ postId }: Props) {
  const { data } = useQuery({ queryKey: ["blog-post", postId], queryFn: () => getPost(postId) });
  const jobs = data?.jobs ?? [];
  if (jobs.length === 0) return null;
  return (
    <div className="mt-6 rounded-md border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">Publish history</h3>
      <ul className="space-y-1 text-xs">
        {jobs.map(j => (
          <li key={j.id} className="flex items-center gap-2">
            <span className="text-muted-foreground">{new Date(j.created_at).toLocaleString()}</span>
            <span className="font-mono">{j.kind}</span>
            <span className={j.state === "done" ? "text-green-600" : j.state === "failed" ? "text-red-600" : "text-muted-foreground"}>{j.state}</span>
            {j.last_error && <span className="text-red-500">— {j.last_error.slice(0, 80)}</span>}
            {j.replay_url && <a href={j.replay_url} target="_blank" rel="noreferrer" className="text-primary underline">replay ↗</a>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

```bash
git add src/components/blog/
git commit -m "feat(blog/ui): ImagePicker + UploadDropzone + PublishHistory"
```

---

## Task 7: BlogPostsList page

**`src/pages/dashboard/BlogPostsList.tsx`:**

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listPosts } from "@/lib/blog/api-client";
import type { BlogPostState } from "@/lib/blog/types";
import { Plus, ExternalLink } from "lucide-react";

const STATE_FILTERS: Array<{ label: string; value: BlogPostState | "all" }> = [
  { label: "All", value: "all" },
  { label: "Drafts", value: "awaiting_approval" },
  { label: "Live", value: "live" },
  { label: "Quarantined", value: "quarantined" },
];

export default function BlogPostsList() {
  const [state, setState] = useState<BlogPostState | "all">("all");
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["blog-posts-list", state, q],
    queryFn: () => listPosts({
      state: state === "all" ? undefined : state,
      q: q || undefined,
      limit: 100,
    }),
  });

  const posts = data?.posts ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Blog posts</h1>
        <Link to="/dashboard/blog/posts/new">
          <Button><Plus className="mr-1 h-4 w-4" /> New post</Button>
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATE_FILTERS.map(f => (
          <Button key={f.value} size="sm" variant={state === f.value ? "default" : "outline"} onClick={() => setState(f.value)}>
            {f.label}
          </Button>
        ))}
        <Input placeholder="Search title…" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs">
            <tr><th className="p-3">Title</th><th>State</th><th>Image</th><th>Author</th><th>Updated</th><th>Cost</th><th></th></tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
            ) : posts.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No posts</td></tr>
            ) : posts.map(p => (
              <tr key={p.id} className="border-t hover:bg-muted/20">
                <td className="p-3"><Link to={`/dashboard/blog/posts/${p.id}`} className="font-medium underline-offset-2 hover:underline">{p.title}</Link></td>
                <td><StatePill state={p.state} /></td>
                <td>{p.image ? <img src={p.image.blob_url} className="h-8 w-12 rounded object-cover" alt="" /> : "—"}</td>
                <td>{p.author_label ?? "—"}</td>
                <td className="text-xs text-muted-foreground">{new Date(p.updated_at).toLocaleString()}</td>
                <td className="text-xs">${(p.cost_usd_cents / 100).toFixed(2)}</td>
                <td>{p.external_post_url && <a href={p.external_post_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatePill({ state }: { state: BlogPostState }) {
  const color = state === "live" ? "bg-green-100 text-green-800" :
                state === "quarantined" ? "bg-red-100 text-red-800" :
                state === "awaiting_approval" ? "bg-amber-100 text-amber-800" :
                "bg-muted text-muted-foreground";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${color}`}>{state}</span>;
}
```

```bash
git add src/pages/dashboard/BlogPostsList.tsx
git commit -m "feat(blog/ui): Posts list page"
```

---

## Task 8: BlogPostDetail page (compose / edit / review / edit-live)

**`src/pages/dashboard/BlogPostDetail.tsx`:**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PostEditor } from "@/components/blog/PostEditor";
import { ImagePickerModal } from "@/components/blog/ImagePickerModal";
import { PublishHistoryPanel } from "@/components/blog/PublishHistoryPanel";
import {
  createPost, getPost, updatePost, publishPost, rejectPost, editOnSierra,
} from "@/lib/blog/api-client";
import type { BlogImage, BlogPostDetail, CreatePostInput, UpdatePostInput } from "@/lib/blog/types";
import { toast } from "sonner";

type Mode = "compose" | "edit-manual" | "review-auto" | "edit-live" | "readonly";

interface FormState {
  title: string;
  body_html: string;
  meta_title: string;
  meta_description: string;
  meta_tags: string;          // comma-separated for the input
  author_label: string;
  category_label: string;
  image: BlogImage | null;
  publish_at: string;         // ISO datetime or empty
}

const empty: FormState = {
  title: "", body_html: "", meta_title: "", meta_description: "", meta_tags: "",
  author_label: "", category_label: "", image: null, publish_at: "",
};

export default function BlogPostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isCompose = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["blog-post", id],
    queryFn: () => getPost(id!),
    enabled: !isCompose,
    refetchInterval: (query) => {
      const state = (query.state.data as any)?.post?.state;
      return state && ["publish_due","publishing","editing"].includes(state) ? 5000 : false;
    },
  });

  const post = data?.post;
  const mode: Mode = useMemo(() => {
    if (isCompose) return "compose";
    if (!post) return "readonly";
    if (post.state === "live") return "edit-live";
    if (post.state === "awaiting_approval") {
      return post.authored === "auto" ? "review-auto" : "edit-manual";
    }
    return "readonly";
  }, [isCompose, post]);

  const [form, setForm] = useState<FormState>(empty);
  useEffect(() => {
    if (post) {
      setForm({
        title: post.title,
        body_html: post.body_html,
        meta_title: post.meta_title ?? "",
        meta_description: post.meta_description ?? "",
        meta_tags: (post.meta_tags ?? []).join(", "),
        author_label: post.author_label ?? "",
        category_label: post.category_label ?? "",
        image: (post as any).image ?? null,
        publish_at: post.publish_at ?? "",
      });
    }
  }, [post]);

  const [pickerOpen, setPickerOpen] = useState(false);

  function patchFromForm(): UpdatePostInput {
    return {
      title: form.title,
      body_html: form.body_html,
      meta_title: form.meta_title || null,
      meta_description: form.meta_description || null,
      meta_tags: form.meta_tags ? form.meta_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      author_label: form.author_label || null,
      category_label: form.category_label || null,
      image_id: form.image?.id ?? null,
      publish_at: form.publish_at || null,
    };
  }

  const createDraft = useMutation({
    mutationFn: () => createPost({
      ...(patchFromForm() as Omit<CreatePostInput, "initial_state">),
      initial_state: "awaiting_approval",
      authored: "manual",
    } as CreatePostInput),
    onSuccess: (r) => { toast.success("Saved as draft"); navigate(`/dashboard/blog/posts/${r.id}`); },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const createPublish = useMutation({
    mutationFn: () => createPost({
      ...(patchFromForm() as Omit<CreatePostInput, "initial_state">),
      initial_state: "publish_due",
      authored: "manual",
    } as CreatePostInput),
    onSuccess: (r) => { toast.success("Publishing — should be live within 60s"); navigate(`/dashboard/blog/posts/${r.id}`); },
    onError: (e: any) => toast.error(`Publish failed: ${e.message}`),
  });

  const saveEdit = useMutation({
    mutationFn: () => updatePost(id!, patchFromForm()),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["blog-post", id] }); },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const publishIt = useMutation({
    mutationFn: async () => { await updatePost(id!, patchFromForm()); return publishPost(id!); },
    onSuccess: () => { toast.success("Publishing — should be live within 60s"); qc.invalidateQueries({ queryKey: ["blog-post", id] }); },
    onError: (e: any) => toast.error(`Publish failed: ${e.message}`),
  });

  const updateSierra = useMutation({
    mutationFn: async () => {
      // Diff against current post.* to compute fields_changed.
      if (!post) return null;
      const diffs: string[] = [];
      if (form.title !== post.title) diffs.push("title");
      if (form.body_html !== post.body_html) diffs.push("body_html");
      if (form.meta_title !== (post.meta_title ?? "")) diffs.push("meta_title");
      if (form.meta_description !== (post.meta_description ?? "")) diffs.push("meta_description");
      if (form.meta_tags !== (post.meta_tags ?? []).join(", ")) diffs.push("meta_tags");
      if (form.author_label !== (post.author_label ?? "")) diffs.push("author");
      if (form.category_label !== (post.category_label ?? "")) diffs.push("category");
      if (diffs.length === 0) return null;
      await updatePost(id!, patchFromForm());
      return editOnSierra(id!, diffs);
    },
    onSuccess: (r) => {
      if (!r) { toast.info("No changes to push"); return; }
      toast.success("Update queued — Sierra in ~60s");
      qc.invalidateQueries({ queryKey: ["blog-post", id] });
    },
    onError: (e: any) => toast.error(`Sierra update failed: ${e.message}`),
  });

  const reject = useMutation({
    mutationFn: () => rejectPost(id!),
    onSuccess: () => { toast.success("Rejected"); navigate("/dashboard/blog/posts"); },
    onError: (e: any) => toast.error(`Reject failed: ${e.message}`),
  });

  if (!isCompose && isLoading) return <div>Loading…</div>;

  const readOnly = mode === "readonly";

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{isCompose ? "New post" : form.title || "Post"}</h1>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} disabled={readOnly} />
          </div>
          <div>
            <Label>Body</Label>
            <PostEditor value={form.body_html} onChange={(html) => setForm({ ...form, body_html: html })} onInsertImageClick={() => setPickerOpen(true)} />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Featured image</Label>
            {form.image ? (
              <div className="space-y-2">
                <img src={form.image.blob_url} className="w-full rounded-md" alt={form.image.vision_caption ?? ""} />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>Change</Button>
                  <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, image: null })}>Remove</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setPickerOpen(true)}>Pick image</Button>
            )}
          </div>
          <div><Label>Author</Label><Input value={form.author_label} onChange={e => setForm({ ...form, author_label: e.target.value })} disabled={readOnly} /></div>
          <div><Label>Category</Label><Input value={form.category_label} onChange={e => setForm({ ...form, category_label: e.target.value })} disabled={readOnly} /></div>
          <div><Label>Meta title</Label><Input value={form.meta_title} onChange={e => setForm({ ...form, meta_title: e.target.value })} disabled={readOnly} /></div>
          <div><Label>Meta description</Label><Textarea value={form.meta_description} onChange={e => setForm({ ...form, meta_description: e.target.value })} disabled={readOnly} /></div>
          <div><Label>Meta keywords (comma sep)</Label><Input value={form.meta_tags} onChange={e => setForm({ ...form, meta_tags: e.target.value })} disabled={readOnly} /></div>
          <div><Label>Schedule for (optional)</Label><Input type="datetime-local" value={form.publish_at?.slice(0, 16) ?? ""} onChange={e => setForm({ ...form, publish_at: e.target.value ? new Date(e.target.value).toISOString() : "" })} disabled={readOnly} /></div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {mode === "compose" && (
          <>
            <Button onClick={() => createDraft.mutate()} disabled={createDraft.isPending}>Save as draft</Button>
            <Button onClick={() => createPublish.mutate()} disabled={createPublish.isPending}>Publish now</Button>
          </>
        )}
        {mode === "edit-manual" && (
          <>
            <Button variant="outline" onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending}>Save</Button>
            <Button onClick={() => publishIt.mutate()} disabled={publishIt.isPending}>Publish now</Button>
          </>
        )}
        {mode === "review-auto" && (
          <>
            <Button variant="outline" onClick={() => saveEdit.mutate()}>Save changes</Button>
            <Button onClick={() => publishIt.mutate()}>Approve & publish</Button>
            <Button variant="destructive" onClick={() => reject.mutate()}>Reject</Button>
          </>
        )}
        {mode === "edit-live" && (
          <>
            <Button onClick={() => updateSierra.mutate()} disabled={updateSierra.isPending}>Save & update Sierra</Button>
            {post?.external_post_url && <a href={post.external_post_url} target="_blank" rel="noreferrer"><Button variant="outline">View on Sierra</Button></a>}
          </>
        )}
      </div>

      {!isCompose && id && <PublishHistoryPanel postId={id} />}

      <ImagePickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(img) => setForm({ ...form, image: img })} />
    </div>
  );
}
```

```bash
git add src/pages/dashboard/BlogPostDetail.tsx
git commit -m "feat(blog/ui): Post Detail page (compose/edit/review/edit-live)"
```

---

## Task 9: BlogImageLibrary page

**`src/pages/dashboard/BlogImageLibrary.tsx`:**

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageUploadDropzone } from "@/components/blog/ImageUploadDropzone";
import { deleteImage, listImages, updateImage } from "@/lib/blog/api-client";
import type { BlogImage } from "@/lib/blog/types";
import { Plus, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";

const VOCAB = ["aerial","exterior","interior","team","area","lifestyle","event","seasonal_spring","seasonal_summer","seasonal_fall","seasonal_winter","data_chart"];

export default function BlogImageLibrary() {
  const qc = useQueryClient();
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<BlogImage | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["blog-images", tag, q],
    queryFn: () => listImages({ tag: tag ?? undefined, q: q || undefined, limit: 500 }),
  });
  const images = data?.images ?? [];

  const patch = useMutation({
    mutationFn: ({ id, tags }: { id: string; tags: string[] }) => updateImage(id, { vision_tags: tags }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blog-images"] }),
  });
  const softDelete = useMutation({
    mutationFn: (id: string) => deleteImage(id),
    onSuccess: () => { toast.success("Archived"); qc.invalidateQueries({ queryKey: ["blog-images"] }); },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Image library <span className="ml-2 text-sm font-normal text-muted-foreground">{images.length}</span></h1>
        <Button onClick={() => setUploadOpen(true)}><Plus className="mr-1 h-4 w-4" /> Upload</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search caption…" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
        <Button size="sm" variant={tag === null ? "default" : "outline"} onClick={() => setTag(null)}>All</Button>
        {VOCAB.map(t => (
          <Button key={t} size="sm" variant={tag === t ? "default" : "outline"} onClick={() => setTag(t)}>{t}</Button>
        ))}
      </div>

      {isLoading ? <div>Loading…</div> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {images.map(img => (
            <div key={img.id} className="overflow-hidden rounded-md border bg-card">
              <img src={img.blob_url} className="aspect-[4/3] w-full object-cover" alt={img.vision_caption ?? ""} />
              <div className="space-y-1 p-2">
                <div className="text-xs">{img.vision_caption ?? "—"}</div>
                <div className="flex flex-wrap gap-1">{img.vision_tags.map(t => (
                  <span key={t} className="rounded bg-muted px-1 text-[10px]">{t}</span>
                ))}</div>
                <div className="flex gap-1 pt-1">
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditing(img)}><Tag className="mr-1 h-3 w-3" /> Tags</Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => softDelete.mutate(img.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Upload images</DialogTitle></DialogHeader>
          <ImageUploadDropzone onUploaded={() => qc.invalidateQueries({ queryKey: ["blog-images"] })} />
        </DialogContent>
      </Dialog>

      {editing && (
        <Dialog open onOpenChange={() => setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit tags</DialogTitle></DialogHeader>
            <img src={editing.blob_url} className="mb-2 rounded" alt="" />
            <div className="text-sm text-muted-foreground">{editing.vision_caption}</div>
            <div className="flex flex-wrap gap-2 pt-2">
              {VOCAB.map(t => {
                const on = editing.vision_tags.includes(t);
                return (
                  <Button key={t} size="sm" variant={on ? "default" : "outline"} onClick={() => {
                    const next = on ? editing.vision_tags.filter(x => x !== t) : [...editing.vision_tags, t];
                    setEditing({ ...editing, vision_tags: next });
                  }}>{t}</Button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => { patch.mutate({ id: editing.id, tags: editing.vision_tags }); setEditing(null); }}>Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
```

```bash
git add src/pages/dashboard/BlogImageLibrary.tsx
git commit -m "feat(blog/ui): Image Library page (grid + upload + retag + soft-delete)"
```

---

## Task 10: Wire routes + TopNav

**Modify `src/App.tsx`:**

Add imports (alphabetic with existing imports):

```ts
import BlogPostsList from "./pages/dashboard/BlogPostsList";
import BlogPostDetail from "./pages/dashboard/BlogPostDetail";
import BlogImageLibrary from "./pages/dashboard/BlogImageLibrary";
```

Add routes inside the existing `<Route element={<RequireAuth />} >` / `<Route element={<Dashboard />}>` group:

```tsx
<Route path="/dashboard/blog/posts" element={<BlogPostsList />} />
<Route path="/dashboard/blog/posts/new" element={<BlogPostDetail />} />
<Route path="/dashboard/blog/posts/:id" element={<BlogPostDetail />} />
<Route path="/dashboard/blog/images" element={<BlogImageLibrary />} />
```

**Modify `src/components/TopNav.tsx`:**

Add a new "Blog" dropdown menu adjacent to the existing menus (look for the dropdown pattern with `<Code2 className="mr-2 h-3.5 w-3.5" /> Overview` to find the section). Add:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger className="...">Blog</DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem asChild>
      <Link to="/dashboard/blog/posts" className="cursor-pointer">
        <FileText className="mr-2 h-3.5 w-3.5" /> Posts
      </Link>
    </DropdownMenuItem>
    <DropdownMenuItem asChild>
      <Link to="/dashboard/blog/images" className="cursor-pointer">
        <ImageIcon className="mr-2 h-3.5 w-3.5" /> Image library
      </Link>
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Use `FileText` and `Image` (aliased as `ImageIcon`) from `lucide-react`. Place between two existing dropdowns — the exact spot is at the implementer's discretion; "after Lab and before Development" is a reasonable choice.

Verify: `npx tsc --noEmit` clean.

```bash
git add src/App.tsx src/components/TopNav.tsx
git commit -m "feat(blog/ui): mount blog routes + TopNav 'Blog' dropdown"
```

---

## Task 11: Local smoke (controller-driven)

The controller (NOT subagent) drives this:

- [ ] Apply migration 050 via Supabase MCP
- [ ] `npm run dev` and verify:
  - `/dashboard/blog/posts` lists the existing Phase 1/2 smoke posts (4 rows)
  - `/dashboard/blog/images` shows the 71 Phase 2 images
  - "+ New post" → compose form opens
  - Fill title + body in Tiptap + pick an image + click "Publish now"
  - Watch state poll: publish_due → publishing → live, with Sierra reflecting the post
  - Click into a live post → edit body → "Save & update Sierra" → state transitions, Sierra reflects edit
  - Open the image library → upload one new image → confirm inline tagging
  - Take an existing auto-pipeline post (just rerun manual-draft.ts to seed one) → confirm "Review" mode shows Approve & Publish + Reject
- [ ] tsc clean across the whole repo
- [ ] vitest run — all existing tests + any new ones green
- [ ] Update HANDOFF.md with Phase 5 entry
- [ ] Push branch + open PR feat/blog-phase-5 → dev → staging → main

---

## Phase 5 Definition of Done

1. ✅ Migration 050 applied
2. ✅ All 4 routes accessible from TopNav
3. ✅ Compose → Save as Draft works end-to-end (round-trip via reload)
4. ✅ Compose → Publish Now → live on Sierra in <90s
5. ✅ Edit-live → Save & Update Sierra → Sierra reflects change
6. ✅ Image library grid renders + tag filter works
7. ✅ Image upload (drag-drop) → inline vision tag → grid refresh
8. ✅ Auth gates: non-owner → 403
9. ✅ tsc clean + all vitest green
10. ✅ HANDOFF.md updated; promoted feat/blog-phase-5 → dev → staging → main
