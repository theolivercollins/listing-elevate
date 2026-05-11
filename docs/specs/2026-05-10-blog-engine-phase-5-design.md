# Blog Engine Phase 5 — Portal UI — Design Spec

**Date:** 2026-05-10
**Author:** Oliver + Claude (brainstorm)
**Status:** Approved, ready for implementation plan
**Builds on:** Phase 1 ([`2026-05-06-blog-engine-design.md`](./2026-05-06-blog-engine-design.md)) and Phase 2 ([`2026-05-07-blog-engine-phase-2-design.md`](./2026-05-07-blog-engine-phase-2-design.md)), both shipped to main 2026-05-10.

---

## 1. Goal

Give Oliver a real UI to **manually author + publish** blog posts to the Helgemo Sierra site, and to **manage the 71-image library** ingested in Phase 2. Same UI also serves as the review queue for auto-drafts once Phases 3+4 ship (those phases just populate the queue; this UI is what makes them usable).

Without Phase 5, the only way to interact with the blog engine is `npx tsx scripts/blog/*.ts` from a terminal. Phase 5 makes the engine *operable* by Oliver (and eventually by Marketing Assistant / Brian / etc., though auth-gating to Oliver-only is fine for v1).

**Critical user need:** "I want to create our market update blog posts in here for the Helgemo Team." Manual authoring is a first-class flow, not a secondary feature behind the auto-pipeline.

---

## 2. Scope

**In v1 (Phase 5a):**
- `/dashboard/blog/posts` — Posts list (filterable table)
- `/dashboard/blog/posts/new` — Post Detail in compose mode (manual authoring)
- `/dashboard/blog/posts/:id` — Post Detail in edit/review mode
- `/dashboard/blog/images` — Image Library (browse 71 imgs + upload + retag)
- New TopNav dropdown "Blog" with subitems: Posts, Image Library
- All API endpoints needed to power the three pages
- Auth: gated to the existing LE owner email (Oliver) — same `requireOwner` pattern as other dashboard endpoints

**Deferred (Phase 5b or later phases):**
- "Today" dashboard with 3 daily topic suggestions (needs Phase 3)
- Pipeline kanban view (Posts list with state filter covers it)
- Style Rules UI (needs Phase 6)
- Sites settings page (single site for v1, env-configured)
- Jobs debug surface (fold "publish history" into Post Detail)
- Cost dashboard (fold per-post cost into Post Detail)
- Multi-user permissions / RBAC
- Mobile responsive polish — desktop-first for v1
- Schedule-by-cron-rule UI (the spec mentions but never built; `publish_at` covers ad-hoc scheduling)

---

## 3. Architecture

### 3.1 Where it lives

Same Listing Elevate repo. Phase 5 ships on `feat/blog-phase-5` branched off `main` (which has Phase 1+2). Promotion path: `feat/blog-phase-5 → dev → staging → main` via PR + `git merge --no-ff` (LE governance).

Frontend routes mounted in `src/App.tsx` under the existing `<Route element={<Dashboard />}>` group:

```
/dashboard/blog/posts                    → BlogPostsList
/dashboard/blog/posts/new                → BlogPostDetail (compose mode)
/dashboard/blog/posts/:id                → BlogPostDetail (edit/review mode)
/dashboard/blog/images                   → BlogImageLibrary
```

Files:

| Path | Responsibility |
|---|---|
| `src/pages/dashboard/BlogPostsList.tsx` | Filterable table of posts |
| `src/pages/dashboard/BlogPostDetail.tsx` | Compose + review + edit. One component, multiple modes via URL. |
| `src/pages/dashboard/BlogImageLibrary.tsx` | Grid view + upload + retag |
| `src/components/blog/PostEditor.tsx` | Tiptap rich-text editor; reused by Post Detail |
| `src/components/blog/ImagePickerModal.tsx` | Browse library, search by tag, select. Reused in Post Detail. |
| `src/components/blog/ImageUploadDropzone.tsx` | Drag-drop upload component |
| `src/components/blog/PublishHistoryPanel.tsx` | Side panel showing publish/edit jobs + Browserbase replay links |
| `src/lib/blog/api-client.ts` | Typed fetch wrappers for /api/blog/* |
| Modified: `src/components/TopNav.tsx` | Add "Blog" dropdown |
| Modified: `src/App.tsx` | Add the four routes |

Backend (new API endpoints, all under `api/blog/*`):

| Endpoint | Method | Purpose |
|---|---|---|
| `api/blog/posts/index.ts` | GET | List posts with filters (state, q, limit, cursor) |
| `api/blog/posts/index.ts` | POST | Create post (manual or via auto-pipeline trigger) |
| `api/blog/posts/[id].ts` | GET | Single post detail (joins image, jobs, costs) |
| `api/blog/posts/[id].ts` | PATCH | Update editable fields (title, body, meta, image_id, etc.) |
| `api/blog/posts/[id]/publish.ts` | POST | Transition to `publish_due` + enqueue publish job |
| `api/blog/posts/[id]/approve.ts` | POST | Same as publish but from auto-pipeline (sets a metadata flag) |
| `api/blog/posts/[id]/reject.ts` | POST | Discard auto-draft (sets state to `quarantined`, no Sierra side-effect) |
| `api/blog/images/index.ts` | GET | List images with filters (tag, q, limit) |
| `api/blog/images/index.ts` | POST | Upload new image (multipart) — runs vision tag inline |
| `api/blog/images/[id].ts` | PATCH | Update vision_tags / active |
| `api/blog/images/[id].ts` | DELETE | Soft-delete (active=false) |

All endpoints require auth via the existing `requireOwner(req)` helper from `lib/auth.ts`. Non-owner returns 403.

### 3.2 State machine additions

Manual authoring flow:
```
[+ New Post]
   ↓ (Save as Draft)
awaiting_approval ── (Publish from detail) ─→ publish_due → publishing → live
   ↓ (Publish Now from compose)
publish_due → publishing → live
```

Auto-pipeline flow (Phase 3+4 populates; Phase 5 just renders):
```
draft_ready ── (trigger from Phase 2) ─→ image_match
  → awaiting_approval (review queue)
     ↓ (Approve & Publish)
     publish_due → publishing → live
     ↓ (Reject)
     quarantined (terminal)
     ↓ (Edit then Save)
     awaiting_approval (stays — user-edited, ready to ship)
```

No new states. Existing enum covers everything.

### 3.3 Tech stack additions

- **Tiptap** — `@tiptap/react` + `@tiptap/starter-kit` + `@tiptap/extension-link` + `@tiptap/extension-image`. Produces clean HTML matching Sierra's HTML-paste mode in publish.ts.
- **TanStack Query** (`@tanstack/react-query`) — already a dep. Use for list / detail fetches with cache invalidation on mutation.
- **No new backend deps.** All new endpoints use the existing Supabase client + auth helper.

---

## 4. Page-by-page

### 4.1 Posts list (`/dashboard/blog/posts`)

**Header:** "Posts" title + "**+ New Post**" primary button (top-right). Links to `/dashboard/blog/posts/new`.

**Filters bar (left to right):**
- State pill group: All • Draft (awaiting_approval) • Live • Quarantined
- Search input (matches title / body / meta_title)
- Site selector (hidden in v1 — single site, but the field is there for Phase 7 AgentFire)

**Table columns:**
- **Title** (link to detail)
- **State** (color-coded pill)
- **Image** (40×30 thumbnail if `image_id` set, else "—")
- **Author** + **Category**
- **Updated** (relative time)
- **Cost** (`$0.{cost_usd_cents:02d}`)
- **Live URL** (external link icon if state=live)

Sortable by **Updated** (default desc) and **Cost**. Pagination via cursor on `updated_at`.

**Row actions menu (three-dot icon):**
- Open detail
- Open on Sierra (if live)
- Re-publish (if live and quarantined edits exist — Phase 6 work, hide for v1)
- Archive (sets active=false on a new `blog_posts.active` column — minor migration in Phase 5)

### 4.2 Post Detail (`/dashboard/blog/posts/:id` and `/new`)

**Three modes, one component:**

| Mode | URL | Buttons |
|---|---|---|
| Compose | `/posts/new` | **Save as Draft**, **Publish Now**, Cancel |
| Edit (manual draft) | `/posts/:id` where state=awaiting_approval and was manually authored | **Save**, **Publish Now**, Cancel |
| Review (auto-pipeline draft) | `/posts/:id` where state=awaiting_approval and was auto-generated | **Approve & Publish**, **Save Changes**, **Reject** |
| Edit-live | `/posts/:id` where state=live | **Save & Update Sierra** (triggers edit job), **View on Sierra** |
| Read-only | `/posts/:id` where state in (publishing, editing, quarantined) | Disabled form, status banner |

"Was manually authored" is tracked via `blog_posts.metadata->>'authored'` (`'manual'` vs `'auto'`). Manual is the default; `'auto'` is set by Phase 4 when Claude drafts the body.

**Layout (3 columns on desktop, stacks on mobile):**

```
┌─────────────────────────────────────────────────────────────────┐
│ Title input (large, full-width)                                 │
│ Slug / Filename input                                           │
├──────────────────────────────────────┬──────────────────────────┤
│  Main column                          │  Sidebar                │
│  ────────────                          │  ───────                │
│  [Tiptap rich text editor]            │  Featured image          │
│  (300px min height, grows)            │  [thumbnail or          │
│                                       │   "Pick image"          │
│  Toolbar: B I U • # H2 H3 link img    │   button → modal]       │
│  Image-insert button opens picker     │                         │
│                                       │  Author      [select]   │
│                                       │  Category    [select]   │
│                                       │  Meta title  [input]    │
│                                       │  Meta desc   [textarea] │
│                                       │  Meta keys   [tag input]│
│                                       │                         │
│                                       │  Schedule for...        │
│                                       │  [datetime input]       │
├──────────────────────────────────────┴──────────────────────────┤
│ Publish history panel (collapsible, defaults open if any rows)  │
│  - 2026-05-10 14:32 — Published — [↗ Replay video]              │
│  - 2026-05-10 15:10 — Edit failed — [↗ Replay] — last_error...  │
├─────────────────────────────────────────────────────────────────┤
│ Per-post cost: $0.20 across 3 cost_events ▾                     │
└─────────────────────────────────────────────────────────────────┘
```

**Tiptap editor:**
- Extensions: StarterKit (paragraph, headings, bold, italic, code, blockquote, lists), Link, Image
- **Image insert** opens `ImagePickerModal` (image library, click to insert as `<img>` with public Supabase Storage URL)
- "Source" toggle to view raw HTML (low priority — defer to Phase 5b)

**ImagePickerModal:**
- Grid of all `active=true` images
- Filter by tag (chip toggles), text search on caption
- Click image to select; double-click to confirm
- "Upload new" button at top — opens the upload dropzone inline

**Save flow:**
- `Save as Draft` → POST /api/blog/posts (compose) or PATCH (edit), state=awaiting_approval. Toast "Saved as draft." Redirects to `/posts/:id`.
- `Publish Now` → save + POST /api/blog/posts/:id/publish. Toast "Publishing — usually live within 60s." Redirects to `/posts/:id`. The page polls via TanStack Query every 5s while state ∈ {publish_due, publishing, editing} to surface the result.
- `Save & Update Sierra` (edit-live mode) → PATCH + POST /api/blog/posts/:id/publish (the publish handler's idempotency + `state==='live'` short-circuit means a re-publish call when no Sierra edit is queued goes straight to a no-op; for an actual edit we'd really call the edit endpoint, but for v1 simplicity Phase 5 uses publish for both and we revisit if needed). Actually: cleaner to use the existing edit job kind. Phase 5 adds POST /api/blog/posts/:id/edit-on-sierra that enqueues an edit job with `fields_changed` computed from a diff against the last-known Sierra state.

### 4.3 Image Library (`/dashboard/blog/images`)

**Header:** "Image Library" + total count + "**+ Upload**" button (primary).

**Filter bar:** tag chip toggles (`aerial`, `interior`, `exterior`, `team`, `area`, `lifestyle`, `event`, `seasonal_*`, `data_chart`) + caption search.

**Grid:** 4-col on desktop, 2-col on tablet. Each card:
- Thumbnail (lazy-loaded from `blob_url`, srcset for 300/600/1200 widths)
- Caption (truncated)
- Tag chips
- Hover overlay: "Edit tags", "Use in new post", "Soft-delete"

**Edit tags modal:** click tags to toggle on/off from the vocab; click "Regenerate from vision" to re-run image_tag job. Save closes.

**Upload flow:**
1. Click "+ Upload" → modal opens with `ImageUploadDropzone`
2. Drag-drop or select files (multi-file supported, up to 10 at once for v1)
3. For each: file_hash dedup check, upload to Supabase Storage, INSERT blog_images row
4. Inline vision tag (synchronous in the upload endpoint, ~3s per image)
5. Modal shows progress per file: "Uploading… Tagging… Done" with auto-tags shown
6. **Per-image override:** before closing the modal, the user can click any auto-tag to remove it or click "+ tag" to add another from the vocab. (Q3 (c) from brainstorm.)
7. "Done" closes; grid refetches.

---

## 5. API design details

### 5.1 List posts

```
GET /api/blog/posts?state=awaiting_approval&q=community&cursor=2026-05-09T12:00:00Z&limit=50

→ 200
{
  posts: [
    {
      id, title, state, image: { id, blob_url, vision_caption } | null,
      author_label, category_label, updated_at, cost_usd_cents,
      external_post_url
    }
  ],
  next_cursor: "2026-05-08T..." | null
}
```

### 5.2 Create post

```
POST /api/blog/posts
Body: {
  title, body_html, meta_title?, meta_description?, meta_tags?,
  author_label?, category_label?, image_id?, publish_at?
  initial_state: "awaiting_approval" | "publish_due"
  authored: "manual"
}
→ 201 { id, ... }
```

If `initial_state === "publish_due"` the endpoint also enqueues a `publish` job atomically.

### 5.3 Publish

```
POST /api/blog/posts/:id/publish
→ 202 { job_id }
```

Validates state is one of `awaiting_approval` or `draft_ready`. Transitions to `publish_due`. Enqueues publish job. Idempotent: if state is already `publishing` or `live` returns 202 with the prior job.

### 5.4 Upload image

```
POST /api/blog/images   (multipart/form-data)
Fields: file, folder_hint?

→ 201
{
  id, blob_url, vision_tags, vision_caption, mime, width, height
}
```

Synchronous: upload → file_hash dedup → resize-if-huge → upload to Storage → inline vision tag → INSERT row. Returns when fully tagged. If vision call fails, row is still created with empty tags; UI prompts user to manually tag.

---

## 6. Component contracts

| Component | Props | Responsibility |
|---|---|---|
| `<PostEditor>` | `value: string, onChange, onImageInsert: (imageUrl) => void` | Tiptap wrapper. Pure controlled component. |
| `<ImagePickerModal>` | `open, onSelect: (image) => void, onClose` | Modal that fetches images + lets user pick one. |
| `<ImageUploadDropzone>` | `onUploaded: (image) => void, allowMulti?: boolean, maxFiles?: number` | Drag-drop + filepicker. POSTs each file to /api/blog/images. |
| `<PublishHistoryPanel>` | `postId` | Fetches blog_jobs for post + renders with replay links. |

---

## 7. Error handling

- **Network/API errors** → toast with message + retry button. Errors that include a Browserbase `replay_url` (publish/edit failures) render the URL as a link.
- **TipTap parse failure** when loading existing body — fall back to a textarea with the raw HTML; show a warning banner ("Editor couldn't parse this post; edit HTML directly").
- **Image upload failure** — file shows red error state in the upload modal; other files in the batch continue.
- **Auth (403)** — redirect to /login.
- **Optimistic UI** for save: PATCH fires immediately, success toast on 200, rollback + error toast on failure.

---

## 8. Testing

**Unit tests (Vitest):**
- `src/lib/blog/api-client.test.ts` — typed wrappers serialize/deserialize correctly
- `src/components/blog/PostEditor.test.tsx` — Tiptap mounts, emits HTML on change
- `src/components/blog/ImagePickerModal.test.tsx` — fetches + selects

**Component tests with React Testing Library:**
- BlogPostsList renders rows + filters
- BlogPostDetail in each mode renders correct button set

**E2E smoke (manual / browser):**
- Compose → Save as Draft → reload → still there
- Compose → Publish Now → poll until state=live → check Sierra
- Image library upload → tag override → save → image shows up in picker
- Auto-draft (from existing blog_posts row with state=awaiting_approval) → Approve & Publish → check Sierra
- Edit live post → Save & Update Sierra → check Sierra reflects change

---

## 9. Out of scope (explicit YAGNI for Phase 5)

- Topic suggestion display (Phase 3 hasn't shipped)
- Style rules UI (Phase 6)
- Multi-user permissions
- Mobile responsive polish
- Rich preview of how the post will look on the public site
- Markdown import / export
- Bulk actions (select N posts → archive)
- Drafts auto-save every N seconds (manual save only)
- Image AI generation
- Custom blog_sites add/edit UI

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Tiptap output doesn't round-trip cleanly through Sierra's TinyMCE | Tested in Phase 1 with hand-written HTML; should be fine. Add a "View Source" button (Phase 5b) for fallback. |
| Image upload eats memory on a large file | sharp pipeline already resizes to 2048px max. Reject >10MB uploads at the endpoint. |
| Publish polling burns battery on tabs left open | Stop polling after 5min or once state ∈ {live, quarantined}. |
| `requireOwner` auth pattern unclear | Inspect existing pattern in `api/admin/*` first; reuse verbatim. |

---

## 11. Definition of Done

1. ✅ All 4 routes mounted; navigation accessible from TopNav "Blog" dropdown
2. ✅ Compose mode: write + Save as Draft → appears in Posts list with state=awaiting_approval
3. ✅ Compose mode: write + Publish Now → state transitions to publish_due, publish job enqueued, lands live on Sierra within 60s
4. ✅ Posts list: state filter, search, pagination all work
5. ✅ Post Detail edit: change title, save, reload, change persists
6. ✅ Edit-live: change body of a live post, Save & Update Sierra → Sierra reflects the change
7. ✅ Image Library grid renders the 71 Phase 2 images; tag filter narrows correctly
8. ✅ Image upload: drop a new image → uploads, vision-tags inline, override-before-save works, image shows up in library
9. ✅ Auto-draft Review mode: take an existing awaiting_approval post → click Approve & Publish → lands on Sierra
10. ✅ Auth gates non-owners to 403; owner sees everything
11. ✅ tsc clean + vitest green for all new tests
12. ✅ HANDOFF.md updated; promoted feat/blog-phase-5 → dev → staging → main
