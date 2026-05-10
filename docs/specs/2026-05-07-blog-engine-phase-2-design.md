# Blog Engine Phase 2 — Image Library + Vision Tagging — Design Spec

**Date:** 2026-05-07
**Author:** Oliver + Claude (brainstorm)
**Status:** Approved, ready for implementation plan
**Builds on:** [`2026-05-06-blog-engine-design.md`](./2026-05-06-blog-engine-design.md) (master design); Phase 1 lives on `feat/blog-phase-1` and is verified end-to-end against the live Sierra blog.

---

## 1. Goal

Populate `blog_images` from a Google Drive folder of Helgemo Team marketing assets, vision-tag every image, and auto-match the best image to a blog draft when it enters `draft_ready` state. Wire the matched image into Phase 1's publish flow so Sierra receives a featured image alongside the post.

The original master spec §8 already locks the design (manual upload + Gemini vision tagging + 768-dim embedding + cosine-rank match). Phase 2 implements that, plus a one-shot Drive ingest CLI to seed the library.

**Storage decision (override of master spec §3.1):** use **Supabase Storage** (`blog-images` bucket) rather than Vercel Blob. LE already uses Supabase for everything else; one less vendor, one less env token, ~7× cheaper per GB. The master spec's intent — "store the image so we can re-fetch at publish time" — is satisfied either way.

---

## 2. Where it lives

Same Listing Elevate repo, same Supabase project. Phase 2 ships on a sibling feature branch (e.g. `feat/blog-phase-2`) cut from the merged-to-main Phase 1.

New files:

| Path | Responsibility |
|---|---|
| `supabase/migrations/049_blog_phase_2.sql` | Storage bucket creation + DB trigger that auto-enqueues `image_match` when a post enters `draft_ready` |
| `lib/blog-engine/image-storage.ts` | Supabase Storage helpers — `uploadImageBuffer`, `downloadImageById` |
| `lib/blog-engine/image-tagging.ts` | Gemini 2.5 Flash vision: controlled-vocab tags + caption + 768-dim embedding |
| `lib/blog-engine/jobs/handlers/image-tag.ts` | Job handler that runs the tagger over a `blog_images` row |
| `lib/blog-engine/jobs/handlers/image-match.ts` | Job handler: cosine-rank candidates against post topic, soft-block recently-used, write `blog_posts.image_id`, transition state |
| `scripts/blog/import-from-drive.ts` | One-shot CLI: gdown the public folder → upload each image → enqueue `image_tag` job for each |
| `scripts/blog/manual-draft.ts` | Smoke driver: insert a post with `state='draft_ready'`, let the trigger fire image_match |
| `scripts/blog/manual-approve.ts` | Smoke driver: take a post in `awaiting_approval`, enqueue publish |

Modified files:

| Path | Change |
|---|---|
| `lib/blog-engine/jobs/handlers/index.ts` | Register `image_tag` and `image_match` handlers |
| `lib/blog-engine/jobs/handlers/publish.ts` | `loadImage` callback now fetches from Supabase Storage when `post.image_id` is set |
| `lib/blog-engine/publishers/sierra/index.ts` | Pass site_id-aware loadImage through |
| `lib/blog-engine/types.ts` | Add `BlogImage` type |

---

## 3. Data flow

```
[ingest, one-shot]
  scripts/blog/import-from-drive.ts
    → gdown public folder to a temp dir
    → for each image:
        upload to Supabase Storage (blog-images/{site_id}/{file_hash}.{ext})
        insert blog_images row with file_hash, blob_url, mime, dimensions
        enqueue image_tag job

[per-image tagging — async, async]
  image_tag job
    → Gemini 2.5 Flash vision call
       returns: { tags: string[], caption: string }  using controlled vocab
    → gemini-embedding-2 call on (caption + tags joined)
       returns: 768-dim vector
    → UPDATE blog_images SET vision_tags, vision_caption, embedding
    → cost_events row (stage=blog_image_tag, provider=gemini)

[at draft time]
  blog_posts INSERT with state='draft_ready'
    → DB trigger blog_posts_after_draft_ready_trg
       enqueues blog_jobs row (kind=image_match, post_id, site_id)

[image_match job]
  → embed(post.title + post.body_html.slice(0, 1000), 768d)  -- skip if no body yet
  → SELECT id, embedding <=> query AS distance FROM blog_images
       WHERE site_id IS NULL OR site_id = post.site_id
       ORDER BY distance LIMIT 20
  → exclude images used in blog_image_usages where used_at > now() - 14 days
  → take top remaining
  → UPDATE blog_posts SET image_id, state='awaiting_approval'
  → INSERT blog_image_usages (post_id, image_id)

[at publish time]
  publishHandler — already exists from Phase 1
    → loadImage callback (NEW): if post.image_id, fetch buffer from Supabase Storage
    → Phase 1's sierraPublish uploads buffer via Sierra's file input
```

---

## 4. Controlled-vocab tags

Gemini's vision call returns 1+ tags drawn from this fixed vocabulary:

```
aerial          drone shot, exterior aerial of property/area
exterior        ground-level exterior shot of a property
interior        any interior room shot
team            includes Helgemo Team members or agents
area            neighborhood, downtown, beach, landmarks (no property)
lifestyle       people doing activities, no property focus
event           gathering, open house, community event
seasonal_spring | seasonal_summer | seasonal_fall | seasonal_winter
data_chart      market chart, infographic, statistics graphic
```

Vision prompt: "Return JSON `{tags: [...], caption: '...'}`. Pick 1–4 tags from this list: [list]. Caption is one short sentence describing the image content."

Folder-name hint (when present in the Drive import) seeds the prompt as "the file is named X" — vision can confirm or override.

---

## 5. Match algorithm (v1)

Pure cosine + soft-block. No hard tag filter for v1 — if quality is poor we add it back as a follow-up.

```sql
WITH q AS (
  SELECT $1::vector(768) AS qv
), recent AS (
  SELECT image_id FROM blog_image_usages WHERE used_at > now() - interval '14 days'
)
SELECT id, embedding <=> q.qv AS distance
FROM blog_images, q
WHERE active = true
  AND embedding IS NOT NULL
  AND id NOT IN (SELECT image_id FROM recent)
  AND (site_id IS NULL OR site_id = $2)
ORDER BY distance
LIMIT 1;
```

Edge cases:
- **No images in library** → fail the job, post stays in `draft_ready`, log `last_error: "no candidate images"`. Operator backfills.
- **All candidates recently used** → fall back to ignoring the soft-block. Better to reuse than fail to publish.
- **Embedding column NULL** (image_tag job hasn't completed) → skipped via `embedding IS NOT NULL` filter.

---

## 6. State trigger

DB trigger fires `image_match` automatically when a post enters `draft_ready`:

```sql
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

Idempotency: a duplicate `draft_ready` write doesn't double-enqueue thanks to the `old.state <> 'draft_ready'` guard. Manually setting the state back-and-forth still re-queues a job, which is fine — the handler's idempotency check (post.image_id already set & is_within_recent_usage) short-circuits.

---

## 7. Drive ingest — `import-from-drive.ts`

Public-link only (gdown). Single shell-out command, no Google Cloud auth.

```bash
npm run blog:import-drive -- "https://drive.google.com/drive/folders/14-dmacrhf9sa8x..."
```

Steps:
1. Resolve site row by host_kind=sierra (single-site assumption holds for v1).
2. `gdown --folder <url> -O /tmp/blog-import-<timestamp>` — downloads everything to a temp dir. Requires `pip install gdown` (we'll print the install hint if not found).
3. For each `*.{jpg,jpeg,png,webp}` in the temp tree (recursive):
   - Compute SHA-256 (`file_hash`) — used as the dedup key
   - If a `blog_images` row with that hash already exists → skip with a log line
   - Resize-if-huge (max 2048 px wide, JPEG quality 85) using `sharp` — keeps storage costs predictable
   - Upload buffer to Supabase Storage at `{site_id}/{file_hash}.{ext}`, get public URL
   - INSERT `blog_images` row (`site_id`, `blob_url`, `mime`, `width`, `height`, `file_hash`, `vision_tags=[]`, `vision_caption=null`, `embedding=null`, parent folder name in a temporary `metadata` jsonb column)
   - Enqueue `image_tag` job
4. Print summary: `imported N, skipped M (already present), failed P`. Failed images stay in `/tmp/...` for inspection.

The script does **not** wait for tag jobs to finish — those drain via the cron poller (or the local `run-tick.ts` driver during smoke).

**Folder hint:** when an image is in a subfolder, that folder name is captured into `blog_images.metadata->>'folder_hint'` and prepended to the Gemini prompt.

---

## 8. Vision tagger — `image-tagging.ts`

```ts
export async function tagImage(args: {
  buffer: Buffer | string,            // Buffer or public URL
  filename: string,
  folderHint?: string,
}): Promise<{
  tags: string[],
  caption: string,
  embedding: number[],                // 768-dim
  costCents: number,                  // for cost_events
}>;
```

Implementation:
1. Build the prompt embedding the controlled-vocab list + folder hint.
2. Call Gemini 2.5 Flash with `inlineData` (base64 of buffer) or `fileData` (URL).
3. Parse JSON response. Fail fast if tags aren't from the vocab list (warn + accept first valid tag, dropping invalid ones).
4. Compose embedding input as `caption + " | " + tags.join(", ")`.
5. Call `gemini-embedding-2` (existing in LE). Return 768-dim vector.
6. Sum vision call cost (~$0.0007) + embedding cost (~$0.0001) → ~10 ths of a cent. Convert to integer cents (round up to 1).

Tests (unit, with mocked Gemini client):
- Returns parsed tags + caption + embedding on a happy-path response
- Fails when Gemini returns non-JSON
- Drops out-of-vocab tags but keeps in-vocab ones
- Throws on embedding API error (no silent failure)

---

## 9. Publish-handler integration

The `loadImage` extension point in Phase 1 currently returns null. Phase 2 wires it up:

```ts
const publisher = createSierraPublisher({
  loadImage: async (post: BlogPost) => {
    if (!post.image_id) return null;
    return downloadImageById(supabase, post.image_id);   // returns { buffer, filename }
  },
  diffFields: async () => new Set(),
});
```

`downloadImageById` reads `blog_images.blob_url`, fetches the bytes from Supabase Storage, returns `{ buffer, filename: file_hash + ext }`. No retries — if the image fetch fails, the publish job fails too and the existing retry path covers it.

**Idempotency:** Phase 1's `if state===live && external_post_url` short-circuit means re-publishing an already-live post skips browser entirely, including the image upload. So if Sierra accepts the image once, we don't re-upload it on retries.

---

## 10. Cost tracking

New `cost_events` rows:

| Stage | Provider | Trigger | Approx |
|---|---|---|---|
| `blog_image_tag` | gemini | per image during ingest | ~$0.001 / image |

Image-match doesn't write a cost row in v1 — the embedding call and the SQL query are both ~$0.0001 collectively, not worth a row. (We can revisit if we wire match into a billing audit later.)

`provider='gemini'` was added to the `cost_events_provider_check` allowlist in 048a (Phase 1 smoke fix) — already done.

---

## 11. Failure modes & mitigations

| Failure | Mitigation |
|---|---|
| gdown not installed | Script prints install hint, exits 1 |
| Drive folder not public | gdown errors clearly; user re-shares as public |
| Image too large for Gemini | Pre-resize to 2048 px max during ingest |
| Vision returns junk | Tags filtered to vocab; caption used regardless |
| No images in library when first draft posts | image_match job fails with `last_error: 'no candidate images'`; operator runs the import |
| Same Drive run twice | file_hash dedup → skip with log line |
| Storage bucket doesn't exist | Migration 049 creates it idempotently |

---

## 12. Scope cuts (Phase 2 explicit YAGNI)

In: Drive ingest + vision tagging + auto-match + publish-time image upload.

Out (deferred):
- Manual upload UI / portal (Phase 5)
- Manual re-tag / override (Phase 5)
- Stock photo / AI image fallback (master spec §8.4)
- Multi-site image scoping (Phase 7+)
- Hard tag-filter in match (revisit if v1 quality is poor)
- Per-site preferred-tag profiles
- Image rotation / pruning of stale assets

---

## 13. Definition of Done

1. ✅ Migration 049 applied (storage bucket + state trigger)
2. ✅ `npm run blog:import-drive` ingests the user's Drive folder, uploads to Supabase Storage, enqueues N tag jobs
3. ✅ `image_tag` job populates `vision_tags`, `vision_caption`, `embedding` for each image
4. ✅ `manual-draft.ts` + DB trigger → `image_match` job runs → post moves to `awaiting_approval` with `image_id` set
5. ✅ `manual-approve.ts` + Phase 1 publisher → live Sierra post with the matched image attached
6. ✅ At least 1 cost_events row per ingested image (`stage=blog_image_tag`)
7. ✅ Unit tests: `image-tagging.test.ts` (4 cases) green
8. ✅ tsc + full vitest suite green

When all 8 are checked, Phase 2 is done. Promote `feat/blog-phase-2 → dev → staging → main`.
