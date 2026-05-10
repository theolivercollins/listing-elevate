# Blog Engine — Design Spec

**Date:** 2026-05-06
**Author:** Oliver + Claude (brainstorm)
**Status:** Approved, ready for implementation plan
**Supersedes:** —

---

## 1. Problem & goal

Helgemo Team needs a steady stream of SEO-relevant blog posts on its Sierra Interactive site, but writing them manually doesn't happen often enough. Sierra Interactive does **not** expose a Content/Blog CRUD API, so any automated solution has to drive the admin UI.

Goal: a portal inside Listing Elevate where Oliver can:

1. See 3 daily AI-researched topic suggestions
2. Pick one; a draft (HTML body, meta, image) is auto-prepared
3. Approve or reject the draft (with regeneration)
4. Publish to Sierra via headless browser
5. Edit live posts in the portal; edits round-trip back to Sierra
6. Have the AI **learn from corrections** so the same mistake isn't repeated
7. Eventually add a second site (AgentFire) without re-platforming

Approval-before-publish is **required** in v1. No auto-publish.

---

## 2. Where it lives

Built as a new module inside the existing **Listing Elevate** repo (`~/listing-elevate`). Hosted on the same Vercel project, same Supabase project, inheriting LE's 3-tier deploy, governance hooks, cost-tracking discipline, Gemini + Claude wiring, image-embedding infrastructure, and Supabase MCP migration workflow.

Frontend route: `/dashboard/blog`. Backend: `api/blog/*` and `lib/blog-engine/`.

Bonnieboard (where the idea originated) was rejected — would have required rebuilding most of the above.

---

## 3. Architecture

### 3.1 Components

| Component | Tech | Notes |
|---|---|---|
| Frontend | LE's existing React + Tailwind + shadcn | New `/dashboard/blog` surface |
| Backend | LE's existing API layer (`api/`) | New `api/blog/*` routes |
| DB | Supabase (LE project) | New `blog_*` tables, migration 048+ |
| Research LLM | Gemini 2.5 Pro (daily) + 2.5 Flash (distill) | Existing direct integration |
| Writing LLM | Claude Sonnet 4.6 | Existing direct integration |
| Vision tagging | Gemini 2.5 Flash + `gemini-embedding-2` | Reuse P3 image-embedding pattern |
| Headless browser | **Browserbase** + Playwright | New dependency. Persistent context per site. Session replay captured per job. |
| Storage | Vercel Blob | For uploaded blog images |
| Job runner | Supabase queue (`blog_jobs`) + Vercel Cron | Pattern ported from Bonnieboard's Reddit Bot; no new infra |
| Auth & deploy | LE inheritance | dev/staging/main, prod-only crons, `VERCEL_ENV` guards |

**Why Browserbase (not Apify, which LE already uses for Custom Listing Pages):** session replay videos, persistent contexts, captcha handling, residential IPs — better DX for an interactive publish-then-edit loop. Apify stays for Custom Listing Pages. Two specialized tools, no migration.

### 3.2 State machine

```
research_due → topics_proposed → topic_picked → draft_due → draft_ready
  → awaiting_approval → publish_due → publishing → live
  → edit_pending → editing → live
```

Gates that **never auto-progress**:
- `topics_proposed` → user picks one of 3
- `awaiting_approval` → user approves (or rejects → regenerate, max 3 regens)

Failures: `publish` and `edit` retry up to 3× with exponential backoff, then quarantine in a "Needs attention" tab with the Browserbase replay URL.

### 3.3 Job runner

`blog_jobs` rows are dequeued by a Vercel Cron poller (every minute in prod). One worker per kind; jobs of kind `publish` and `edit` are serialized per `site_id` to avoid concurrent Browserbase sessions stomping on each other.

Vercel Fluid Compute (14min ceiling) is plenty for a publish (~30–60s).

---

## 4. Data model

New tables (prefix `blog_`):

```
blog_sites
  id pk, name, host_kind ('sierra'|'agent_fire'), base_url,
  bot_credentials_ref (vault key), default_author_id, default_category_id,
  taxonomy_cache jsonb,                   -- discovered authors/categories
  browserbase_context_id text,            -- persistent context handle
  active bool, created_at

blog_posts
  id pk, site_id fk, state enum,          -- see 3.2
  topic_suggestion_id fk nullable,
  title, slug, body_html,
  meta_title, meta_description, meta_tags text[],
  image_id fk nullable,
  author_label, category_label,
  external_post_url, external_post_id,
  publish_at timestamptz nullable,        -- null = immediate on approval
  regen_count int default 0,              -- cost guard, max 3
  cost_usd_cents int default 0,           -- denormalized from cost_events
  created_at, updated_at

blog_topic_suggestions
  id pk, site_id fk, batch_date date, rank smallint check (rank between 1 and 3),
  title, angle text, sources jsonb,       -- which research signals fed this
  picked bool default false, post_id fk nullable,
  created_at
  unique (site_id, batch_date, rank)

blog_research_runs
  id pk, site_id fk, run_date date,
  sources_used text[],                    -- ['local_market','events','national','seasonal']
  raw_findings jsonb,
  selected_topic_ids uuid[],
  cost_usd_cents int, created_at

blog_images
  id pk, site_id fk nullable,             -- null = shared across sites
  blob_url, mime, width, height,
  uploaded_by, file_hash text unique,
  vision_tags text[],                     -- ['aerial','interior','team','area',...]
  vision_caption text,
  embedding vector(768),                  -- gemini-embedding-2
  active bool, created_at

blog_image_usages
  id pk, post_id fk, image_id fk, used_at
                                          -- prevents same image two posts in a row

blog_jobs
  id pk, post_id fk nullable, site_id fk,
  kind enum ('research'|'distill_topics'|'draft'|'image_match'
            |'publish'|'edit'|'fetch_taxonomy'|'distill_correction'),
  state enum ('queued'|'running'|'done'|'failed'),
  attempts int default 0, last_error text,
  browserbase_session_id text, replay_url text,
  payload jsonb, result jsonb,
  scheduled_at, started_at, finished_at, created_at

blog_corrections
  id pk, post_id fk, site_id fk,
  field text,                             -- 'title'|'body'|'meta_title'|'meta_description'|'tone'|'structure'
  before_text, after_text, diff_summary text,
  rule_extracted text,                    -- Claude-distilled style rule
  applies_to_site_only bool default false,
  status enum ('proposed'|'accepted'|'discarded'|'edited') default 'proposed',
  active bool default false,              -- becomes true on accept
  created_at

blog_style_rules
  id pk, site_id fk nullable,             -- null = global
  rule text, source_correction_id fk,
  weight smallint default 1,
  active bool default true,
  created_at, last_applied_at
```

**`cost_events` (existing)** gets new `stage` values, no schema change:
`blog_research`, `blog_topic_distill`, `blog_draft`, `blog_regen`, `blog_rewrite`, `blog_image_tag`, `blog_correction_distill`, `blog_publish_browser`.

`blog_posts.cost_usd_cents` is denormalized via DB trigger on `cost_events` insert (when `event.post_id` is set) — keeps the Posts table fast.

---

## 5. Sierra publisher (Browserbase + Playwright)

### 5.1 Persistent session model

- One Browserbase persistent context per `blog_sites` row. Context id stored in `blog_sites.browserbase_context_id`.
- Cookies persist across runs. Sign-in happens lazily: a publish/edit job navigates to `/blog-manager.aspx`. If redirected to a login form, the worker reads creds from Vault (referenced via `bot_credentials_ref`) and signs in, then continues.
- Every job records `browserbase_session_id` and `replay_url` on the `blog_jobs` row.

### 5.2 Publish click path (Sierra)

Source: Oliver's stated path 2026-05-06.

1. `goto {base_url}/blog-manager.aspx` (auto-login if redirected)
2. Click `Create Blog Post`
3. Fill `Post Title` ← `posts.title`
4. Upload image: file input populated from Vercel Blob URL (download → upload, or direct file-input set if Sierra accepts)
5. Switch body editor to **HTML/Source mode**, paste `posts.body_html`
6. Select `Author` (dropdown) ← `posts.author_label` matched against `taxonomy_cache.authors`
7. Select `Category` (dropdown) ← `posts.category_label` matched against `taxonomy_cache.categories`
8. Fill `Meta Title`, `Meta Description`, `Meta Tags`
9. Click `Publish`
10. Wait for success indicator; capture resulting blog URL → `posts.external_post_url`
11. Update post state → `live`

### 5.3 Edit click path

1. Navigate to the admin edit URL for `posts.external_post_url` (or list view → find by title fallback)
2. Click `Edit`
3. Diff current draft vs prior published version; touch only changed fields
4. Click `Update`; verify success; state → `live`

### 5.4 Taxonomy discovery

A `fetch_taxonomy` job runs:
- On first setup of a site
- Weekly thereafter
- Populates `blog_sites.taxonomy_cache` with the Author and Category dropdown options scraped from `/blog-manager.aspx` Create form

The portal's site-settings UI uses the cache so Oliver picks defaults from real options — no typos at publish time.

### 5.5 Failure handling

| Failure | Handling |
|---|---|
| Login redirect | Re-auth, continue same job |
| Selector miss (Sierra UI changed) | Fail fast, post stays in prior state, replay URL surfaced, in-app alert |
| Network/timeout | Exponential backoff, max 3 attempts |
| Captcha | Browserbase transparent; if it can't, fail with replay |
| Sierra returns success but no URL | Failed (probably partial save); replay surfaces it |

---

## 6. AI memory / learning loop

### 6.1 Capture

When Oliver saves an edit:
1. `blog_corrections` row written: before, after, field, status=`proposed`
2. `distill_correction` job enqueued
3. Claude reads (before, after, field) and writes a one-sentence rule into `rule_extracted`
4. Portal surfaces the proposed rule with **Accept / Edit / Discard**
5. On accept, a `blog_style_rules` row is created (`active=true`), linked to the correction

### 6.2 Apply

- All draft, regen, and AI-rewrite Claude calls inject active `blog_style_rules` (filtered by site or global) as a `<style_rules>` block in the system prompt
- AI-rewrite for an existing post additionally injects the user's instruction note + the pre-edit body
- `last_applied_at` updated on each call → the portal shows usage age

### 6.3 Anti-bloat guards

- Soft cap: 50 active rules per site. Beyond that, the portal nudges Oliver toward the audit view.
- Audit view: rule, source correction, last applied, posts since edited.
- Retire without delete: `active=false` keeps history.

### 6.4 Explicitly NOT in v1

- No fine-tuning
- No embeddings clustering of corrections
- No automatic rule deactivation

Graduate to embedding-based correction retrieval if rule-count materially exceeds 50 per site.

---

## 7. Topic research

### 7.1 Daily run

A `research` job runs once per day per active site (Vercel Cron, prod only). Sources:
- **Local market** — Helgemo Team area listings + price trends from existing LE pipelines
- **Local events / community / neighborhood** — web search via Gemini grounded
- **National real-estate news + localize** — web search via Gemini grounded
- **Seasonal/evergreen calendar** — month-of-year prompts ("spring buyer checklist", etc.)

Output written to `blog_research_runs.raw_findings`.

### 7.2 Topic distillation

A `distill_topics` job follows: Gemini 2.5 Flash promotes the 3 best topics (rank 1–3) into `blog_topic_suggestions`, each with a `title`, an `angle` (1–2 sentences), and the `sources` that fed it.

In-app badge appears: "Today's topics ready."

### 7.3 Deferred sources

- **SEO keyword-gap** (Ahrefs / SEMrush). Needs vendor + budget. Spec'd as a future source plug-in; not in v1. Free alternative: Google Search Console for the Sierra site — possible v1.5.

---

## 8. Image library

### 8.1 Upload + auto-tag

When an image is uploaded:
1. Stored to Vercel Blob, row written to `blog_images`
2. `image_match` adjacent worker computes:
   - Vision tags via Gemini 2.5 Flash (controlled vocabulary: `aerial`, `interior`, `exterior`, `team`, `area`, `seasonal_*`, `lifestyle`, `data_chart`, `event`)
   - Free-form `vision_caption`
   - 768-dim `gemini-embedding-2` `embedding`
3. Manual override available in the library UI (correct tags, add/remove)

### 8.2 Match-to-post

When a draft is ready, an `image_match` job runs:
1. Embed the post topic + first 200 words
2. Cosine-rank `blog_images` by embedding
3. Filter: must share at least one vision tag with the post's inferred type (interior post → must have `interior` tag etc.)
4. Apply soft-block: skip images used on the most recent post
5. Write `blog_posts.image_id` + a `blog_image_usages` row

### 8.3 Scope

- v1: shared pool, tagged for Helgemo Team content
- AgentFire (later): same pool, filtered by `site_id` only when site-specific images exist

### 8.4 Out of scope

- AI image generation (real-estate AI images are a brand liability — wrong architectural style, six-fingered realtors, etc.)
- Stock image fallback (Unsplash/Pexels) — escape hatch in spec, not built

---

## 9. Portal UI (`/dashboard/blog`)

| Page | Purpose |
|---|---|
| Today | Today's 3 topic suggestions + currently-pending review post |
| Pipeline | Kanban: Topics → Draft → Review → Scheduled → Live |
| Posts | Filterable table (state, site, date, cost) |
| Post detail | Tiptap rich editor on `body_html`, meta panel, image swap (filtered by relevance), AI-rewrite side panel, publish/edit history |
| Image library | Grid view, vision tags, upload, manual retag |
| Style rules | Active rules + corrections feed + Accept / Edit / Discard |
| Sites | Per-site settings: defaults, taxonomy cache, bot creds health |
| Jobs | Recent Browserbase jobs + replay links (debug surface) |
| Cost | Spend by stage / by post / by month |

**Notifications:** in-app badges only (today's topics ready, post failed publish). No email/SMS in v1.

**AI-rewrite UX:** type instruction → preview diff → accept or discard. Diff is a styled side-by-side, not raw HTML.

---

## 10. Cost tracking

Per LE convention (`cost_events` table, explicit `{error: costErr}` checks at every insert site, never null/0 cost fields), every API call writes a `cost_events` row with one of the new `stage` values.

Approximate unit costs (for spec sanity, not budget commitment):

| Stage | Provider | Approx |
|---|---|---|
| `blog_research` | Gemini 2.5 Pro | $0.05–$0.15 / day / site |
| `blog_topic_distill` | Gemini 2.5 Flash | $0.01 / day / site |
| `blog_draft` | Claude Sonnet 4.6 | $0.05–$0.15 / post |
| `blog_regen` | Claude Sonnet 4.6 | $0.05–$0.15 / regen |
| `blog_rewrite` | Claude Sonnet 4.6 | $0.02–$0.08 / rewrite |
| `blog_image_tag` | Gemini 2.5 Flash + embedding | $0.001 / image |
| `blog_correction_distill` | Claude Sonnet 4.6 | $0.005 / correction |
| `blog_publish_browser` | Browserbase | $0.05–$0.15 / session |

Trigger on `cost_events` insert maintains `blog_posts.cost_usd_cents` (when `event.post_id` is non-null). Monthly invoice reconciliation script lives at `scripts/oneoff/blog-cost-reconcile.ts`.

---

## 11. Multi-site

Data model is multi-site from day 1 (`site_id` on every relevant row). v1 ships **only the Sierra adapter**. AgentFire is a deferred milestone:

1. New `blog_sites` row, `host_kind='agent_fire'`
2. New `lib/blog-engine/publishers/agent-fire.ts` adapter implementing the `Publisher` interface (`publish(post)`, `edit(post)`, `fetchTaxonomy()`)
3. No schema change

The `Publisher` interface is defined in v1 even though only Sierra uses it, so the abstraction shape is locked.

---

## 12. Scope cuts (YAGNI for v1)

**In:** Helgemo Sierra; daily research → 3 topics → user picks; Claude Sonnet 4.6 only; manual image upload + auto vision tag; rich editor + AI-rewrite edit flow; approval-required-before-publish; in-app notifications; multi-site data model.

**Out (deferred):** AgentFire publisher; SEO keyword-gap source; stock image fallback; AI image generation; tiered/auto publishing; embeddings-based correction retrieval; cron-rule scheduled publishing UI (ad-hoc `publish_at` covers it); email/SMS notifications; raw-HTML post editor.

---

## 13. Open / soft questions

These are not blockers but should be confirmed during implementation:

1. **Sierra image upload mechanism** — is the file input a plain `<input type="file">` or a JS-driven uploader? Affects step 4 of the publish click path. Resolved during taxonomy-discovery spike.
2. **Sierra "View Post" URL pattern** — needed for the edit click path. Captured during the first successful publish run.
3. **Vault for bot creds** — Supabase Vault vs Vercel env vars. Default to Supabase Vault (per-row reference); Vercel env if Vault adds friction.
4. **Tiptap → Sierra HTML compatibility** — verify Sierra's HTML-paste mode preserves Tiptap output cleanly. First publish run is the test.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| Sierra UI changes break selectors | Fail-fast, replay URL, in-app alert. Selectors centralized in `lib/blog-engine/publishers/sierra/selectors.ts` for one-place edits. |
| Browserbase outage | Quarantine queue; replay & retry once service is back. No data loss — drafts are in DB. |
| Style rules accumulate noise | 50-rule soft cap + audit view. Manual prune, not auto. |
| Hallucinated local facts | Approval-required gate is the firewall. Plus: research run records `sources` per topic, so the draft prompt can cite-or-skip claims that lack a source. |
| Cost runaway | `cost_events` per call + 3-regen cap + soft alert when daily spend > threshold (configurable per site). |

---

## 15. Implementation handoff

Next step: **invoke the writing-plans skill** to break this spec into a concrete, sequenced implementation plan with verification steps per milestone.
