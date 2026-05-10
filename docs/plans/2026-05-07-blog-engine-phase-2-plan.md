# Blog Engine Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/specs/2026-05-07-blog-engine-phase-2-design.md`](../specs/2026-05-07-blog-engine-phase-2-design.md)
**Master design:** [`docs/specs/2026-05-06-blog-engine-design.md`](../specs/2026-05-06-blog-engine-design.md)

**Goal:** Wire up the blog engine's image library — ingest from a Drive folder, vision-tag every image, auto-match images to drafts, and have Phase 1's Sierra publisher upload the matched image.

**Architecture:** New module pieces under `lib/blog-engine/` (image-storage, image-tagging, two new job handlers) + a one-shot Drive ingest CLI + a DB trigger that auto-enqueues `image_match` when a post enters `draft_ready`. Storage is **Supabase Storage** (`blog-images` bucket), not Vercel Blob — overrides master spec §3.1.

**Tech Stack:** TypeScript, Supabase Storage + Postgres, Gemini 2.5 Flash (vision) + `gemini-embedding-2`, `sharp` for image resize, `gdown` (Python tool, shelled out) for Drive download.

**Phase 2 explicitly excludes:** portal UI for image library, manual upload UI, AI-generated images, multi-site image scoping, hard tag-filter in match.

---

## File structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/049_blog_phase_2.sql` | Storage bucket + draft_ready trigger function + trigger |
| `lib/blog-engine/image-storage.ts` | `uploadImageBuffer`, `downloadImageById` |
| `lib/blog-engine/image-tagging.ts` | `tagImage` — Gemini vision + embedding |
| `lib/blog-engine/image-tagging.test.ts` | 4 unit tests with mocked Gemini |
| `lib/blog-engine/jobs/handlers/image-tag.ts` | Job handler: tag one `blog_images` row |
| `lib/blog-engine/jobs/handlers/image-match.ts` | Job handler: match an image to a post |
| `lib/blog-engine/jobs/handlers/index.ts` (modify) | Register two new handlers |
| `lib/blog-engine/jobs/handlers/publish.ts` (modify) | `loadImage` now downloads from Supabase Storage |
| `lib/blog-engine/types.ts` (modify) | Add `BlogImage` type |
| `scripts/blog/import-from-drive.ts` | One-shot Drive ingest CLI |
| `scripts/blog/manual-draft.ts` | Insert a post in `draft_ready` for smoke testing |
| `scripts/blog/manual-approve.ts` | Take a post in `awaiting_approval`, enqueue publish |

---

## Pre-flight

1. **`gdown` installed:** `pip install gdown` (or `pipx install gdown`). Python tool, the script shells out. The script will print an install hint if missing.
2. **Supabase Storage bucket `blog-images` exists:** migration 049 creates it idempotently.
3. **`sharp` npm package:** `npm install sharp` — Phase 2 adds this dep for resize.
4. **`GEMINI_API_KEY` env var:** already in `.env` from Phase 1's CREDENTIALS.md handoff. Confirm with `grep GEMINI_API_KEY .env`.
5. **`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`:** already in `.env` (used by Phase 1).

---

## Task 1: Migration 049 — storage bucket + draft_ready trigger

**Files:**
- Create: `supabase/migrations/049_blog_phase_2.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 049_blog_phase_2.sql
-- Phase 2 schema: Supabase Storage bucket for blog images + DB trigger that
-- auto-enqueues an image_match job whenever a post enters 'draft_ready'.

-- Bucket creation. Public so we don't have to generate signed URLs at publish
-- time — the URL goes straight to Browserbase, which fetches and uploads to
-- Sierra. Bucket policies still apply (we add a permissive read policy below).
insert into storage.buckets (id, name, public)
  values ('blog-images', 'blog-images', true)
  on conflict (id) do nothing;

-- Allow service-role inserts/updates (used by the import script).
-- Public read is implicit when bucket.public = true.
create policy if not exists "blog-images service role write"
  on storage.objects for all
  to service_role
  using (bucket_id = 'blog-images')
  with check (bucket_id = 'blog-images');

-- Trigger function: enqueue image_match when a post first becomes draft_ready.
create or replace function blog_posts_enqueue_image_match()
returns trigger language plpgsql as $$
begin
  if new.state = 'draft_ready'
     and (old.state is null or old.state <> 'draft_ready') then
    insert into blog_jobs (post_id, site_id, kind, payload)
      values (new.id, new.site_id, 'image_match', '{}'::jsonb);
  end if;
  return new;
end;
$$;

create trigger blog_posts_after_draft_ready_trg
  after insert or update of state on blog_posts
  for each row execute function blog_posts_enqueue_image_match();
```

- [ ] **Step 2: Controller applies via Supabase MCP after this task commits.**

(Note for the implementer: do NOT try to apply the migration yourself — the controller has the MCP. Just write the file and commit.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/049_blog_phase_2.sql
git commit -m "feat(blog): migration 049 — storage bucket + draft_ready trigger

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: BlogImage type

**Files:**
- Modify: `lib/blog-engine/types.ts`

- [ ] **Step 1: Append**

```ts
export interface BlogImage {
  id: string;
  site_id: string | null;
  blob_url: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  uploaded_by: string | null;
  file_hash: string;
  vision_tags: string[];
  vision_caption: string | null;
  embedding: number[] | null;
  active: boolean;
  metadata: Record<string, unknown>;       // Phase 2 additions live here (folder_hint, etc.)
  created_at: string;
}
```

- [ ] **Step 2: TS check + commit**

`npx tsc --noEmit` — clean.

```bash
git add lib/blog-engine/types.ts
git commit -m "feat(blog): BlogImage type

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Note: the Phase 1 migration declared `blog_images` without a `metadata` column. We'll add it in a tiny migration in Task 3 since the import script and tagger both want it. (Could fold into 049, but separating keeps that migration purely about Phase 2 storage/trigger concerns.)

---

## Task 3: Migration 049a — `blog_images.metadata`

**Files:**
- Create: `supabase/migrations/049a_blog_images_metadata.sql`

- [ ] **Step 1: Write**

```sql
-- 049a_blog_images_metadata.sql
-- Add a free-form metadata jsonb column to blog_images. Used by Phase 2's
-- Drive import script to capture folder_hint and original filename, and by
-- the vision tagger to record raw model output for future debugging.
alter table blog_images add column if not exists metadata jsonb not null default '{}'::jsonb;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/049a_blog_images_metadata.sql
git commit -m "feat(blog): migration 049a — blog_images.metadata column

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Image storage helpers

**Files:**
- Create: `lib/blog-engine/image-storage.ts`

- [ ] **Step 1: Add `sharp` dep**

```bash
npm install sharp
```

- [ ] **Step 2: Implement**

```ts
// lib/blog-engine/image-storage.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "blog-images";
const MAX_WIDTH = 2048;

export interface UploadInput {
  buffer: Buffer;
  siteId: string;
  fileHash: string;
  mime: string;
  filenameExt: string;                    // ".jpg", ".png", ".webp"
}

export interface UploadResult {
  blob_url: string;
  width: number;
  height: number;
  mime: string;
}

export async function uploadImageBuffer(
  supabase: SupabaseClient,
  input: UploadInput,
): Promise<UploadResult> {
  // Resize-if-huge to control storage cost. Always re-encode to JPEG quality 85
  // for predictable size, EXCEPT keep PNG for transparency. Sharp infers source.
  let pipeline = sharp(input.buffer);
  const meta = await pipeline.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  let resized: Buffer = input.buffer;
  let outMime = input.mime;
  let outExt = input.filenameExt;
  let outWidth = width;
  let outHeight = height;

  if (width > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH });
  }
  if (input.mime !== "image/png") {
    resized = await pipeline.jpeg({ quality: 85 }).toBuffer();
    outMime = "image/jpeg";
    outExt = ".jpg";
    const newMeta = await sharp(resized).metadata();
    outWidth = newMeta.width ?? outWidth;
    outHeight = newMeta.height ?? outHeight;
  } else if (width > MAX_WIDTH) {
    resized = await pipeline.png().toBuffer();
    const newMeta = await sharp(resized).metadata();
    outWidth = newMeta.width ?? outWidth;
    outHeight = newMeta.height ?? outHeight;
  }

  const path = `${input.siteId}/${input.fileHash}${outExt}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, resized, {
    contentType: outMime,
    upsert: true,
  });
  if (error) throw new Error(`uploadImageBuffer: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { blob_url: data.publicUrl, width: outWidth, height: outHeight, mime: outMime };
}

export interface DownloadResult {
  buffer: Buffer;
  filename: string;
  mime: string;
}

export async function downloadImageById(
  supabase: SupabaseClient,
  imageId: string,
): Promise<DownloadResult> {
  const { data: row, error } = await supabase
    .from("blog_images").select("blob_url, mime, file_hash").eq("id", imageId).single();
  if (error || !row) throw new Error(`downloadImageById: image ${imageId} not found`);

  const res = await fetch(row.blob_url);
  if (!res.ok) throw new Error(`downloadImageById: fetch ${row.blob_url} failed (${res.status})`);
  const arr = new Uint8Array(await res.arrayBuffer());
  const ext = row.mime === "image/png" ? ".png" : ".jpg";
  return { buffer: Buffer.from(arr), filename: `${row.file_hash}${ext}`, mime: row.mime ?? "image/jpeg" };
}
```

- [ ] **Step 3: TS check + commit**

```bash
git add lib/blog-engine/image-storage.ts package.json package-lock.json
git commit -m "feat(blog): image-storage upload + download helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Vision tagger with TDD

**Files:**
- Create: `lib/blog-engine/image-tagging.ts`
- Create: `lib/blog-engine/image-tagging.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/blog-engine/image-tagging.test.ts
import { describe, it, expect, vi } from "vitest";
import { tagImage, _testing } from "./image-tagging";

describe("tagImage", () => {
  const fakeBuffer = Buffer.from("fake");

  it("returns parsed tags + caption + embedding on happy path", async () => {
    const visionCall = vi.fn().mockResolvedValue({
      text: '{"tags": ["interior", "lifestyle"], "caption": "A bright living room"}',
    });
    const embedCall = vi.fn().mockResolvedValue(new Array(768).fill(0.1));

    const result = await tagImage(
      { buffer: fakeBuffer, filename: "x.jpg" },
      { vision: visionCall, embed: embedCall },
    );

    expect(result.tags).toEqual(["interior", "lifestyle"]);
    expect(result.caption).toBe("A bright living room");
    expect(result.embedding).toHaveLength(768);
    expect(result.costCents).toBeGreaterThan(0);
  });

  it("drops out-of-vocab tags but keeps in-vocab", async () => {
    const visionCall = vi.fn().mockResolvedValue({
      text: '{"tags": ["interior", "kitchen"], "caption": "Kitchen"}',
    });
    const embedCall = vi.fn().mockResolvedValue(new Array(768).fill(0));

    const result = await tagImage(
      { buffer: fakeBuffer, filename: "x.jpg" },
      { vision: visionCall, embed: embedCall },
    );

    // "kitchen" not in vocab; only "interior" survives.
    expect(result.tags).toEqual(["interior"]);
  });

  it("throws on non-JSON vision response", async () => {
    const visionCall = vi.fn().mockResolvedValue({ text: "not json" });
    const embedCall = vi.fn();
    await expect(
      tagImage({ buffer: fakeBuffer, filename: "x.jpg" }, { vision: visionCall, embed: embedCall }),
    ).rejects.toThrow(/parse/i);
  });

  it("includes folderHint in the vision prompt", async () => {
    const visionCall = vi.fn().mockResolvedValue({
      text: '{"tags": ["aerial"], "caption": "An aerial drone shot"}',
    });
    const embedCall = vi.fn().mockResolvedValue(new Array(768).fill(0));
    await tagImage(
      { buffer: fakeBuffer, filename: "x.jpg", folderHint: "aerials" },
      { vision: visionCall, embed: embedCall },
    );
    const callArgs = visionCall.mock.calls[0][0];
    expect(callArgs.prompt).toMatch(/aerials/i);
  });

  it("vocab list is exhaustive", () => {
    expect(_testing.VOCAB).toEqual([
      "aerial","exterior","interior","team","area","lifestyle","event",
      "seasonal_spring","seasonal_summer","seasonal_fall","seasonal_winter",
      "data_chart",
    ]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

`npx vitest run lib/blog-engine/image-tagging.test.ts` — FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// lib/blog-engine/image-tagging.ts

const VOCAB = [
  "aerial", "exterior", "interior", "team", "area", "lifestyle", "event",
  "seasonal_spring", "seasonal_summer", "seasonal_fall", "seasonal_winter",
  "data_chart",
] as const;

export type ImageTag = typeof VOCAB[number];

export interface TagImageInput {
  buffer: Buffer;
  filename: string;
  folderHint?: string;
}

export interface TagImageResult {
  tags: ImageTag[];
  caption: string;
  embedding: number[];
  costCents: number;
}

export interface TagImageDeps {
  vision: (args: { prompt: string; imageBase64: string; mime: string }) => Promise<{ text: string }>;
  embed: (text: string) => Promise<number[]>;
}

function buildPrompt(folderHint?: string): string {
  const vocabList = VOCAB.join(", ");
  const hintLine = folderHint ? `The file is in a folder named "${folderHint}", which may hint at category. ` : "";
  return (
    `${hintLine}` +
    `Categorize this image and write a short caption. Return ONLY JSON in this exact shape, no commentary: ` +
    `{"tags": [...], "caption": "..."}\n\n` +
    `Pick 1-4 tags from this exact list: [${vocabList}]. Use only tags from this list. ` +
    `Caption is one short sentence describing what's in the image.`
  );
}

export async function tagImage(input: TagImageInput, deps: TagImageDeps): Promise<TagImageResult> {
  const prompt = buildPrompt(input.folderHint);
  const imageBase64 = input.buffer.toString("base64");
  const mime = guessMimeFromFilename(input.filename);

  const visionResp = await deps.vision({ prompt, imageBase64, mime });
  let parsed: { tags: string[]; caption: string };
  try {
    // Strip code-fences if Gemini wraps JSON in ```json ... ```
    const cleaned = visionResp.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (e: any) {
    throw new Error(`tagImage: failed to parse vision response: ${e?.message ?? e}; raw: ${visionResp.text.slice(0, 200)}`);
  }

  const validTags = (parsed.tags ?? []).filter((t): t is ImageTag => (VOCAB as readonly string[]).includes(t));
  const caption = String(parsed.caption ?? "");
  const embedding = await deps.embed(caption + " | " + validTags.join(", "));

  // Approx cost: ~$0.0007 vision + $0.0001 embedding = ~$0.001. Round up to 1¢ minimum.
  const costCents = 1;

  return { tags: validTags, caption, embedding, costCents };
}

function guessMimeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export const _testing = { VOCAB };
```

- [ ] **Step 4: Run, expect pass**

`npx vitest run lib/blog-engine/image-tagging.test.ts` — PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/blog-engine/image-tagging.ts lib/blog-engine/image-tagging.test.ts
git commit -m "feat(blog): image-tagging — Gemini vision + embedding with TDD

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: image_tag job handler

**Files:**
- Create: `lib/blog-engine/jobs/handlers/image-tag.ts`

- [ ] **Step 1: Implement**

```ts
// lib/blog-engine/jobs/handlers/image-tag.ts
import type { JobHandler } from "../runner";
import { recordBlogCost } from "../../cost";
import { tagImage } from "../../image-tagging";
import { GoogleGenAI } from "@google/genai";

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const imageTagHandler: JobHandler = async ({ supabase, job }) => {
  const imageId = (job.payload?.image_id as string | undefined);
  if (!imageId) throw new Error("image_tag job requires payload.image_id");

  const { data: img, error } = await supabase
    .from("blog_images").select("*").eq("id", imageId).single();
  if (error || !img) throw new Error(`image_tag: image ${imageId} not found`);

  // Idempotency: if already tagged, no-op.
  if (img.embedding && img.vision_tags?.length) {
    return { result: { skipped: "already_tagged" } };
  }

  // Pull image bytes from Supabase Storage.
  const res = await fetch(img.blob_url);
  if (!res.ok) throw new Error(`image_tag: fetch ${img.blob_url} failed (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const folderHint = img.metadata?.folder_hint as string | undefined;

  const result = await tagImage(
    { buffer, filename: `${img.file_hash}.jpg`, folderHint },
    {
      vision: async ({ prompt, imageBase64, mime }) => {
        const resp = await gemini.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{
            role: "user",
            parts: [
              { inlineData: { data: imageBase64, mimeType: mime } },
              { text: prompt },
            ],
          }],
        });
        return { text: resp.text ?? "" };
      },
      embed: async (text: string) => {
        const resp = await gemini.models.embedContent({
          model: "gemini-embedding-2",
          contents: text,
          config: { outputDimensionality: 768 },
        });
        const v = resp.embeddings?.[0]?.values;
        if (!v || v.length !== 768) throw new Error("embed: empty or wrong-dim vector");
        return v;
      },
    },
  );

  await supabase.from("blog_images").update({
    vision_tags: result.tags,
    vision_caption: result.caption,
    embedding: result.embedding,
  }).eq("id", imageId);

  await recordBlogCost(supabase, {
    stage: "blog_image_tag",
    cost_cents: result.costCents,
    post_id: null,
    site_id: img.site_id ?? "",
    provider: "gemini",
    metadata: { image_id: imageId, vision_tags: result.tags },
  });

  return { result: { tags: result.tags, caption: result.caption.slice(0, 80) } };
};
```

(Note for the implementer: if the `@google/genai` SDK's API shape differs from the one above — `models.generateContent` and `models.embedContent` — check `node_modules/@google/genai/dist/index.d.ts` and adjust to match. The same SDK is already used elsewhere in LE; align with that usage.)

- [ ] **Step 2: TS check**

`npx tsc --noEmit` — clean.

- [ ] **Step 3: Commit**

```bash
git add lib/blog-engine/jobs/handlers/image-tag.ts
git commit -m "feat(blog): image_tag job handler

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: image_match job handler

**Files:**
- Create: `lib/blog-engine/jobs/handlers/image-match.ts`

- [ ] **Step 1: Implement**

```ts
// lib/blog-engine/jobs/handlers/image-match.ts
import type { JobHandler } from "../runner";
import { GoogleGenAI } from "@google/genai";

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const RECENT_USAGE_DAYS = 14;

export const imageMatchHandler: JobHandler = async ({ supabase, job }) => {
  if (!job.post_id) throw new Error("image_match job requires post_id");

  const { data: post, error: pErr } = await supabase
    .from("blog_posts").select("*").eq("id", job.post_id).single();
  if (pErr || !post) throw new Error(`image_match: post ${job.post_id} not found`);

  // Idempotency: if already matched, transition state and return.
  if (post.image_id) {
    if (post.state === "draft_ready") {
      await supabase.from("blog_posts").update({ state: "awaiting_approval" }).eq("id", post.id);
    }
    return { result: { skipped: "already_matched", image_id: post.image_id } };
  }

  // Build query text from title + first ~1000 chars of body.
  const queryText = (post.title + "\n" + (post.body_html ?? "").slice(0, 1000))
    .replace(/<[^>]+>/g, " ")              // strip HTML
    .replace(/\s+/g, " ")
    .trim();
  if (!queryText) throw new Error(`image_match: post ${post.id} has no title/body to embed`);

  const embedResp = await gemini.models.embedContent({
    model: "gemini-embedding-2",
    contents: queryText,
    config: { outputDimensionality: 768 },
  });
  const queryEmbedding = embedResp.embeddings?.[0]?.values;
  if (!queryEmbedding || queryEmbedding.length !== 768) {
    throw new Error("image_match: empty or wrong-dim query embedding");
  }

  // Run the cosine match via an RPC/SQL. Inline raw SQL via supabase.rpc isn't
  // available without a stored function, so use .from + post-filter for v1.
  // Pull top 50 candidates by vector distance, exclude recently-used in-app.
  const { data: candidates, error: cErr } = await supabase.rpc("blog_match_image", {
    q_embedding: queryEmbedding,
    q_site_id: post.site_id,
    recent_days: RECENT_USAGE_DAYS,
    n_limit: 1,
  });
  if (cErr) throw new Error(`image_match: rpc failed: ${cErr.message}`);

  let imageId = (candidates as { id: string }[] | null)?.[0]?.id;

  // Fallback: if soft-block excluded everything, retry without recent-usage filter.
  if (!imageId) {
    const { data: fallback, error: fErr } = await supabase.rpc("blog_match_image", {
      q_embedding: queryEmbedding,
      q_site_id: post.site_id,
      recent_days: 0,
      n_limit: 1,
    });
    if (fErr) throw new Error(`image_match: fallback rpc failed: ${fErr.message}`);
    imageId = (fallback as { id: string }[] | null)?.[0]?.id;
  }
  if (!imageId) throw new Error("image_match: no candidate images in library");

  await supabase.from("blog_posts").update({
    image_id: imageId,
    state: "awaiting_approval",
    updated_at: new Date().toISOString(),
  }).eq("id", post.id);

  await supabase.from("blog_image_usages").insert([{ post_id: post.id, image_id: imageId }]);

  return { result: { image_id: imageId } };
};
```

- [ ] **Step 2: Add the matching RPC in a third migration**

**File:** `supabase/migrations/049b_blog_match_image_rpc.sql`

```sql
-- 049b_blog_match_image_rpc.sql
-- Server-side cosine match: returns the closest image (by embedding) excluding
-- ones used on a post within `recent_days` days. Service role only — invoked
-- by image_match job handler.

create or replace function blog_match_image(
  q_embedding vector(768),
  q_site_id uuid,
  recent_days int default 14,
  n_limit int default 1
)
returns table (id uuid, distance float8)
language sql stable as $$
  select bi.id, bi.embedding <=> q_embedding as distance
  from blog_images bi
  where bi.active = true
    and bi.embedding is not null
    and (bi.site_id is null or bi.site_id = q_site_id)
    and (recent_days <= 0 or bi.id not in (
      select biu.image_id from blog_image_usages biu
      where biu.used_at > now() - make_interval(days => recent_days)
    ))
  order by bi.embedding <=> q_embedding
  limit n_limit;
$$;
```

(Note for the implementer: do NOT apply via MCP — controller does that. Just write the SQL file and commit.)

- [ ] **Step 3: TS check + commit**

```bash
git add lib/blog-engine/jobs/handlers/image-match.ts supabase/migrations/049b_blog_match_image_rpc.sql
git commit -m "feat(blog): image_match handler + cosine RPC

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire handlers + update publish loadImage

**Files:**
- Modify: `lib/blog-engine/jobs/handlers/index.ts`
- Modify: `lib/blog-engine/jobs/handlers/publish.ts`

- [ ] **Step 1: Register new handlers**

```ts
// lib/blog-engine/jobs/handlers/index.ts
import type { Handlers } from "../runner";
import { fetchTaxonomyHandler } from "./fetch-taxonomy";
import { publishHandler } from "./publish";
import { editHandler } from "./edit";
import { imageTagHandler } from "./image-tag";
import { imageMatchHandler } from "./image-match";

export const handlers: Handlers = {
  fetch_taxonomy: fetchTaxonomyHandler,
  publish: publishHandler,
  edit: editHandler,
  image_tag: imageTagHandler,
  image_match: imageMatchHandler,
};
```

- [ ] **Step 2: Wire loadImage in publish handler**

In `lib/blog-engine/jobs/handlers/publish.ts`, change the `createSierraPublisher` call from:

```ts
  const publisher = createSierraPublisher({
    loadImage: async () => null,
    diffFields: async () => new Set(),
  });
```

to:

```ts
  const publisher = createSierraPublisher({
    loadImage: async (p) => {
      if (!p.image_id) return null;
      const { downloadImageById } = await import("../../image-storage");
      return downloadImageById(supabase, p.image_id);
    },
    diffFields: async () => new Set(),
  });
```

- [ ] **Step 3: TS check**

`npx tsc --noEmit` — clean. `npx vitest run lib/blog-engine` — 8 tests pass (5 image-tagging + 2 cost + 3 runner — wait, runner had 3, total should be 11? Re-count after running).

- [ ] **Step 4: Commit**

```bash
git add lib/blog-engine/jobs/handlers/index.ts lib/blog-engine/jobs/handlers/publish.ts
git commit -m "feat(blog): register image handlers + wire loadImage from Supabase Storage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Drive ingest CLI

**Files:**
- Create: `scripts/blog/import-from-drive.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/blog/import-from-drive.ts
import "dotenv/config";
import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, basename, relative, dirname } from "node:path";
import { createHash } from "node:crypto";
import { getSupabase } from "../../lib/client.js";
import { uploadImageBuffer } from "../../lib/blog-engine/image-storage.js";

const FOLDER_URL = process.argv[2];
if (!FOLDER_URL) {
  console.error("usage: import-from-drive <google-drive-folder-url>");
  process.exit(2);
}

function checkGdownInstalled() {
  try {
    execSync("gdown --version", { stdio: "ignore" });
  } catch {
    console.error("gdown not installed. Install with: pip install gdown   (or pipx install gdown)");
    process.exit(2);
  }
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function* walkImages(dir: string, base: string): Generator<{ path: string; rel: string; folderHint: string | null }> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkImages(full, base);
    else if (IMAGE_EXTS.has(extname(entry.name).toLowerCase())) {
      const rel = relative(base, full);
      const parent = dirname(rel);
      yield { path: full, rel, folderHint: parent && parent !== "." ? parent : null };
    }
  }
}

async function main() {
  checkGdownInstalled();
  const supabase = getSupabase();
  const { data: site, error: sErr } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (sErr || !site) throw new Error("no Sierra blog_sites row — run seed-helgemo-site.ts first");

  const tmp = mkdtempSync(join(tmpdir(), "blog-import-"));
  console.log(`downloading to ${tmp} ...`);
  execSync(`gdown --folder "${FOLDER_URL}" -O "${tmp}"`, { stdio: "inherit" });

  let imported = 0, skipped = 0, failed = 0;
  for (const { path, rel, folderHint } of walkImages(tmp, tmp)) {
    try {
      const buffer = readFileSync(path);
      const hash = createHash("sha256").update(buffer).digest("hex");

      const { data: existing } = await supabase
        .from("blog_images").select("id").eq("file_hash", hash).maybeSingle();
      if (existing) {
        skipped++;
        console.log(`  skip (already imported) ${rel}`);
        continue;
      }

      const ext = extname(path).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      const { blob_url, width, height, mime: outMime } = await uploadImageBuffer(supabase, {
        buffer, siteId: site.id, fileHash: hash, mime, filenameExt: ext,
      });

      const { data: imgRow, error: iErr } = await supabase
        .from("blog_images").insert([{
          site_id: site.id,
          blob_url, mime: outMime, width, height,
          file_hash: hash,
          metadata: { folder_hint: folderHint, original_filename: basename(path) },
        }]).select("id").single();
      if (iErr) throw iErr;

      await supabase.from("blog_jobs").insert([{
        site_id: site.id, kind: "image_tag", payload: { image_id: imgRow!.id },
      }]);

      imported++;
      console.log(`  imported ${rel}`);
    } catch (e: any) {
      failed++;
      console.error(`  FAIL ${rel}: ${e?.message ?? e}`);
    }
  }

  console.log(`\ndone. imported=${imported} skipped=${skipped} failed=${failed}`);
  console.log(`tmp dir: ${tmp}  (failed images stay here for inspection)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add `npm script`**

In `package.json` `"scripts"`:

```json
"blog:import-drive": "tsx scripts/blog/import-from-drive.ts"
```

- [ ] **Step 3: TS check + commit**

```bash
git add scripts/blog/import-from-drive.ts package.json
git commit -m "chore(blog): Drive folder ingest CLI

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Smoke-driver scripts

**Files:**
- Create: `scripts/blog/manual-draft.ts`
- Create: `scripts/blog/manual-approve.ts`

- [ ] **Step 1: manual-draft.ts**

```ts
// scripts/blog/manual-draft.ts
import "dotenv/config";
import { getSupabase } from "../../lib/client.js";

async function main() {
  const supabase = getSupabase();
  const { data: site } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) throw new Error("no Sierra site row — run seed-helgemo-site.ts first");

  const { data: post, error } = await supabase
    .from("blog_posts").insert([{
      site_id: site.id,
      state: "draft_ready",
      title: "Phase 2 image-match smoke — please ignore",
      body_html: "<p>Smoke test draft. The image-match job should populate posts.image_id.</p>",
      meta_title: "Phase 2 smoke",
      meta_description: "Image-match smoke test for the blog engine.",
      meta_tags: ["smoke", "phase2"],
      author_label: process.env.SIERRA_DEFAULT_AUTHOR ?? null,
      category_label: process.env.SIERRA_DEFAULT_CATEGORY ?? null,
    }]).select("id").single();
  if (error) throw error;
  console.log("draft", post!.id, "(image_match job auto-enqueued via trigger)");
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: manual-approve.ts**

```ts
// scripts/blog/manual-approve.ts
import "dotenv/config";
import { getSupabase } from "../../lib/client.js";

const POST_ID = process.argv[2];
if (!POST_ID) { console.error("usage: manual-approve <post_id>"); process.exit(2); }

async function main() {
  const supabase = getSupabase();
  const { data: post, error: pErr } = await supabase
    .from("blog_posts").select("site_id, state, image_id").eq("id", POST_ID).single();
  if (pErr || !post) throw new Error(`post ${POST_ID} not found`);
  if (post.state !== "awaiting_approval") {
    throw new Error(`post is in state '${post.state}', expected 'awaiting_approval'`);
  }
  if (!post.image_id) {
    console.warn("post has no image_id — proceeding anyway (publish will go without an image)");
  }

  const { data: job, error: jErr } = await supabase
    .from("blog_jobs").insert([{
      site_id: post.site_id,
      post_id: POST_ID,
      kind: "publish",
      payload: {},
    }]).select("id").single();
  if (jErr) throw jErr;
  console.log("publish job", job!.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Commit**

```bash
git add scripts/blog/manual-draft.ts scripts/blog/manual-approve.ts
git commit -m "chore(blog): smoke drivers — manual-draft + manual-approve

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: End-to-end smoke (controller-driven, not subagent)

The controller (NOT a subagent) drives this with the local `run-tick.ts` driver and Supabase MCP.

- [ ] Apply migration 049 + 049a + 049b via MCP
- [ ] `npm run blog:import-drive -- "<user's Drive URL>"` — ingest images
- [ ] Run tick repeatedly until all `image_tag` jobs drain to `state=done`
- [ ] Verify `select count(*) from blog_images where embedding is not null` matches imported count
- [ ] `npx tsx scripts/blog/manual-draft.ts` — get the draft post id
- [ ] Run tick — `image_match` job should run, post moves to `awaiting_approval` with `image_id` set
- [ ] `npx tsx scripts/blog/manual-approve.ts <post_id>` — enqueues publish
- [ ] Run tick — publish runs, Sierra receives the post WITH the matched image
- [ ] Verify on the live Sierra blog manager that the post has the image attached

---

## Phase 2 Definition of Done

1. ✅ Migration 049 + 049a + 049b applied
2. ✅ Drive folder ingested, all images tagged + embedded
3. ✅ `image_match` populates `image_id` on a `draft_ready` post
4. ✅ Publish flow uploads the matched image to Sierra
5. ✅ Per-image `cost_events` rows present
6. ✅ Unit tests pass (image-tagging 5 tests + Phase 1 7 tests = 12 total)
7. ✅ tsc clean
8. ✅ `docs/HANDOFF.md` updated with Phase 2 entry before promotion
