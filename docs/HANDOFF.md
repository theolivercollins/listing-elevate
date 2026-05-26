# Listing Elevate — Handoff

Last updated: 2026-05-23 PM (V2 pair-picker day-1 build on worktree-gen2-v21-today — pushed; migrations applied)

See also:
- [README.md](./README.md) — folder guide + session hygiene
- [state/PROJECT-STATE.md](./state/PROJECT-STATE.md) — authoritative state
- [plans/back-on-track-plan.md](./plans/back-on-track-plan.md) — condensed roadmap
- [specs/2026-05-05-listing-elevate-consolidation-design.md](./specs/2026-05-05-listing-elevate-consolidation-design.md) — repo + 3-tier deploy + governance overhaul
- [specs/2026-04-20-back-on-track-design.md](./specs/2026-04-20-back-on-track-design.md) — full roadmap spec
- [audits/ML-AUDIT-2026-04-20.md](./audits/ML-AUDIT-2026-04-20.md) — Phase M.1 verdict
- [sessions/](./sessions/) — per-session notes
- `../CLAUDE.md` — session-start brief; read this before doing anything

## Right now

**2026-05-23 PM: V2 pair-picker day-1 build pushed on `worktree-gen2-v21-today`.** Naming clarified: V1 = original single-image, V1.1 = Seedance push-in (other session, already on main), V2 = this work (Kling 3 Omni pair-picker). 16 commits, 12.5k LOC, ~191 tests passing. Scene graph extractor (Gemini 2.5 Pro) + rule-based pair candidate generator + pure-TS LR+stump-boost picker (LightGBM stand-in) + Gemini Apprentice Labeler + DB-driven outcome-feedback worker + per-clip geometric guardrail + 97% room-confidence fall-through to V1 single-image (Kling 2.6 Pro + Seedance 2.0) + Director's Cut UI + Apprentice Review UI + Observability Panel + V1↔V2 toggle in Lab + new route /dashboard/development/lab/v21. Migrations 067-072 APPLIED to LE Supabase (project vrhmaeywqsohlztoouxu). Vercel preview deploy LIVE at listingelevate-git-worktree-gen2-v21-today-recasi.vercel.app. Internal paths (`lib/gen2-v21/`, `gen2_*` tables, `/v21` route, `GEN2_V21_ENABLED` env var) kept verbatim; only user-facing labels say "V2". Full spec/plan/handoff: docs/specs/2026-05-23-v21-pair-picker-design.md + docs/sessions/2026-05-23-v21-day1-handoff.md.

**Next action**: set `GEN2_V21_ENABLED=true` on Vercel preview env (gated on Oliver — either drop Vercel personal token into ~/credentials.md, or run `vercel env add` himself). Without it, V2 Lab UI loads but its API routes return 404.

---

**2026-05-23 (latest): v1.1 Seedance push-in pipeline + FFmpeg speed-ramp polish — opt-in toggle on every order.** New `properties.pipeline_mode` column (`v1` | `v1.1`, default `v1`, CHECK constraint live in prod). When set to `v1.1`, every non-paired clip routes to the new `seedance-pro-pushin` Atlas SKU (Bytedance Seedance, env-overridable slug via `SEEDANCE_ATLAS_SLUG`, default `bytedance/seedance-pro/image-to-video`, 14¢/sec placeholder); the scene's prompt is overridden at render time to a stable "slow push in" directive via `forceSeedancePushInPrompt` (stored prompt unmutated for audit). After each Seedance clip downloads in `api/cron/poll-scenes.ts`, `applySpeedRampToBuffer` runs a 3-segment FFmpeg `trim`+`setpts`+`concat` filter that slows the first and last 0.5s of the clip to 0.8× — subtle cinematic "breathe" feel on the head and tail. On any ramp failure: log warn and ship the raw clip rather than failing the scene. **Paired scenes always still use Kling 2.1 (`kling-v2-1-pair`) regardless of mode — v2.1 logic untouched.** UI toggle lives in the Upload form Step 1 (Property) as a Pipeline field. Fallback chain: Seedance permanent fail → Atlas `kling-v2-6-pro`. Migration 062 applied to prod via Management API. Tests: 37/37 green across `router.v1.1`, `ffmpeg.speed-ramp`, plus the 9 existing router + 12 atlas tests unchanged. Branch `feat/v1-1-seedance-pushin` cascaded directly to `main` per Oliver's authorization.

**Before this can render a real clip on prod:** confirm `SEEDANCE_ATLAS_SLUG` is correct for the Atlas catalog (default guess `bytedance/seedance-pro/image-to-video`; if Atlas hosts it under a different path, set the env var on Vercel prod). Validate the 14¢/sec price against the first Atlas invoice; adjust `priceCentsPerSecond` in `lib/providers/atlas.ts`.

---

**2026-05-20: Email composer — replacing Stripo + Claude Co-work with Ally + open-source drag-and-drop. Send target is Sendy (the team's existing self-hosted SES-backed bulk mailer). Blog → email handoff wired. On feature branch `worktree-blog-post-fix-2`, PR #82 open against `main`. Migration 058 NOT applied to prod yet (waiting on Oliver). Sendy env vars NOT set in prod yet (waiting on Oliver).**

### Email composer (end-to-end Ally flow)

The team's previous workflow was: Claude Co-work → Stripo (visual builder) → send to Cindy. This whole loop is replaced by:

- **`/dashboard/blog/emails`** — list of all emails (drafts, ready, sent), with state filters and "New email" + "New from blog post" entry points
- **`/dashboard/blog/emails/new?chat=1`** — `EmailChatCompose` — full-page chat with Ally to draft an email from scratch, exact mirror of `BlogPostChatCompose`. Sidebar shows subject, preheader, from name/email, audience as Ally fills them.
- **`/dashboard/blog/emails/[id]`** — detail page with two tabs:
  - **Visual Builder** — `EmailDesigner` wraps `react-email-editor` (Unlayer MIT). Full drag-and-drop editor in an iframe. `loadDesign(design_json)` resumes, `exportHtml()` produces `{design, html}` which we persist as `design_json` + `body_html`.
  - **Ally Chat** — `AllyEmailFloatingChat` widget; same Brain icon / memory popover / proposal cards / "See diff" dialog as the blog `AllyFloatingChat`, but proposals patch email fields (subject, preheader, body, from, audience).
- **`/dashboard/blog/email-templates`** + **`/dashboard/blog/email-templates/[id]`** — drag-and-drop email template library. Templates store `design_json` + `body_html` + defaults (subject, preheader, from name/email, audience). "Use template" on a new email copies the template's design_json into the new row, then opens in the builder.
- **Blog → email handoff** — `BlogPostDetail` has a new "Send as email" action button → calls `aiEmailFromPost(post_id)` one-shot endpoint → creates a draft email + navigates to its detail page. Replaces the manual copy-paste-into-Stripo step.

### Ally's email brain

- **Model**: same `claude-sonnet-4-6` as blog chat
- **Endpoint**: `POST /api/blog/ai/email-chat` (multi-turn) + `POST /api/blog/ai/email-from-post` (one-shot conversion)
- **System prompt**: `lib/blog-engine/ally-email-prompt.ts` exports `BASE_EMAIL_SYSTEM_PROMPT`. Strict email-safe HTML rules: table-based layout (role="presentation"), max-width 600px, inline CSS only (no `<style>` blocks — Gmail strips them), bulletproof CTA buttons (table-cell + bgcolor + padding + anchor), Helvetica/Arial fallback stack, hero `<img>` placeholder, footer with `{{UNSUBSCRIBE_URL}}`. Brand colors: `#0A2540` for headers, `#E97316` for CTAs. No `<script>`, `<iframe>`, `<form>`, `<link>`.
- **Schema**: namespaced envelope mirrors blog chat. New tags: `<email_subject>` (≤90 chars), `<email_preheader>` (≤100 chars), `<email_body>` (full HTML), `<email_from_name>`, `<email_from_email>`, `<email_audience>`, `<email_action>` (`send | save_draft | test_send`). Reuses `<reply>`, `<changes_summary>`, `<ally_suggest_research>`, `<ally_remember>` unchanged.
- **Reuses entire blog stack**: ally-memory + source-allowlist + Gemini research (auto/always/never) + team archive injection + per-post chat localStorage (with prefix `ally-email-chat:` to avoid collision) + attachments (PDF/image/text). Zero duplication — every infrastructure improvement to Ally helps both surfaces.
- **Source post mode**: `email-chat` accepts an optional `source_post_id` body field. When present, the post's title + body_html + external_post_url are injected as a SOURCE POST block so Ally can convert/excerpt/reference it in the email.
- **Cost stages**: `blog_email_ai` (chat), `blog_email_from_post` (one-shot), `blog_email_send` (Sendy).

### Send pipeline — Sendy

The team already has a self-hosted Sendy install hooked up to Amazon SES, with subscriber lists curated for sphere / past clients / new leads. LE doesn't replicate any of that — it just calls Sendy's `POST /api/campaigns/create.php` to fire a campaign at one or more pre-existing lists.

- **`POST /api/blog/emails/[id]/send`** — body `{ list_ids: string[] }` overrides the row's `recipients_json` (semantics changed: `recipients_json` now stores Sendy list IDs, not email addresses). Form-urlencoded POST to Sendy with `send_campaign=1`. Sendy returns plain text (not JSON) — happy paths include the string `"Campaign created"`, `"now sending"`, `"queued"`, or a campaign URL. Any other response is surfaced verbatim as a 502 error. State transitions: `draft / ready → sending → sent | failed`. Stores Sendy's campaign URL as `send_provider_message_id`, list IDs in `sent_to[]`. Records cost at 0.04¢/list (accounting line; real per-email SES cost ~0.01¢, reconciled monthly vs invoice).
- **`POST /api/blog/emails/[id]/test`** — body `{ list_id?: string }`. Sendy has no single-recipient primitive, so we fire a campaign at a small dedicated "Tests" list (env-default `SENDY_TEST_LIST_ID`, body override available). Prepends `[TEST] ` to subject. Doesn't mutate email state. Records cost.
- **Env vars needed in prod** (not yet set — Oliver greenlights): `SENDY_URL`, `SENDY_API_KEY`, `SENDY_BRAND_ID`, `SENDY_TEST_LIST_ID`, `DEFAULT_EMAIL_FROM_NAME`, `DEFAULT_EMAIL_FROM_EMAIL`, `DEFAULT_EMAIL_REPLY_TO` (optional).

### Database — migration 058 (NOT applied yet)

`supabase/migrations/058_emails.sql` creates two tables:

- **`email_templates`** — site-scoped, soft-delete (active=false). Columns: name, description, `design_json` (Unlayer schema), `body_html`, thumbnail_url, default_subject, default_preheader, default_from_name, default_from_email, default_audience, metadata, timestamps. Mirrors `blog_templates`.
- **`emails`** — site-scoped, soft-delete. FK to optional `template_id` (set null) and optional `source_post_id` (set null — so the original blog post can be deleted without orphaning the email). State CHECK constraint: `draft | ready | sending | sent | failed`. Columns include subject, preheader, from_name, from_email, reply_to, audience, recipients_json (jsonb array), design_json, body_html, body_text, send_provider, send_provider_message_id, sent_to (text[]), sent_at, send_error, authored ('manual' | 'auto'), cost_usd_cents, metadata, timestamps.
- Indexes: `emails(site_id, state, updated_at desc) where active=true`, `emails(source_post_id) where source_post_id is not null`, `email_templates(site_id, active) where active=true`.

**Action item**: apply via Supabase MCP when Oliver greenlights. Single dev/staging/prod project — applying = applying to prod.

### Library choice (the open-source question)

Picked **`react-email-editor` (Unlayer)** for v1:
- MIT-licensed React wrapper, drop-in component
- Drag-and-drop editor with templates, custom blocks, merge tags
- `exportHtml()` returns `{design, html}`; `loadDesign(json)` restores
- Free for embedded use, no API key
- Battle-tested by major SaaS products

Storage schema (`design_json` jsonb + `body_html` text) is library-agnostic. If we ever need pure-self-hosted (the editor UI is loaded from Unlayer's CDN even though the wrapper is MIT), swap to **GrapesJS + grapesjs-mjml** without changing the database — just remap the `design_json` schema. The migration path is one-component.

### vercel.json — 4 new route rewrites

Right after `blog/templates/[id]`:

```
{ "src": "/api/blog/email-templates/([^/]+)", "dest": "/api/blog/email-templates/[id]?id=$1" },
{ "src": "/api/blog/emails/([^/]+)/send", "dest": "/api/blog/emails/[id]/send?id=$1" },
{ "src": "/api/blog/emails/([^/]+)/test", "dest": "/api/blog/emails/[id]/test?id=$1" },
{ "src": "/api/blog/emails/([^/]+)", "dest": "/api/blog/emails/[id]?id=$1" }
```

Sub-routes (`/send`, `/test`) come BEFORE the bare `[id]` catch to prevent shadowing.

### Key files (email build)

- `supabase/migrations/058_emails.sql`
- `api/blog/email-templates/index.ts`, `[id].ts`
- `api/blog/emails/index.ts`, `[id].ts`, `[id]/send.ts`, `[id]/test.ts`
- `api/blog/ai/email-chat.ts`, `email-from-post.ts`
- `lib/blog-engine/ally-email-prompt.ts`
- `lib/blog-engine/cost.ts` — added 3 new cost stages
- `src/lib/blog/types.ts`, `api-client.ts` — extended with email types + client functions
- `src/components/blog/EmailDesigner.tsx` — Unlayer wrapper, forwardRef for imperative exportHtml
- `src/components/blog/AllyEmailFloatingChat.tsx` — port of AllyFloatingChat
- `src/components/blog/ally-email-storage.ts` — per-email localStorage chat persistence
- `src/pages/dashboard/EmailsList.tsx`, `EmailDetail.tsx`, `EmailChatCompose.tsx`, `EmailTemplates.tsx`, `EmailTemplateDetail.tsx`
- `src/App.tsx` — 6 new routes; `src/components/TopNav.tsx` — Email links in BlogNav dropdown
- `src/pages/dashboard/BlogPostDetail.tsx` — "Send as email" button

### Gates (waiting on Oliver)

1. **Apply migration 058** to Supabase prod via MCP. Touches no existing tables. Rollback: `drop table emails; drop table email_templates;`.
2. **Set Sendy env vars** in Vercel prod: `SENDY_URL`, `SENDY_API_KEY`, `SENDY_BRAND_ID`, `SENDY_TEST_LIST_ID`, `DEFAULT_EMAIL_FROM_NAME`, `DEFAULT_EMAIL_FROM_EMAIL`, `DEFAULT_EMAIL_REPLY_TO` (optional). Without these, `/send` returns 500 with a config error.
3. **Open PR** from `worktree-blog-post-fix-2` to `main` (or push the branch to GitHub first).

### Open follow-ups (post-merge)

- Wire saved-audience presets per site (map "Sphere", "Past clients", "New leads" → Sendy list IDs in a `site_audiences` table) so the user doesn't paste list IDs each time
- Fetch Sendy lists via `/api/lists/get-lists.php` and present them as a checkbox group instead of free-text list ID input
- Move email send to an `email_jobs` async queue (like `blog_jobs`) instead of inline if Sendy ever rate-limits or campaigns take >10s to queue
- Persist user's last-used builder vs chat tab per email
- Click + open tracking — Sendy tracks both natively; surface the stats inline on the email detail after send

---

**2026-05-15 (PRs #50-#70): Built "Ally" — the blog AI editor that runs the entire post-creation + improvement workflow. The blog system went from "publish endpoint works" to a full AI-first product surface in one session.**

### What Ally is, end to end

**For new posts** — `/dashboard/blog/posts/new?chat=1` is a dedicated full-page chat-compose experience (replaces the old modal). 60/40 split: chat thread + composer on the left, live form sidebar on the right (title, image, author, category, meta title/desc/keywords). Hero "Ready when you are." empty state with daily-rotating starter chips (pool of 30 topics, day-of-year rotation). Ally populates every field as you chat; each sidebar field shows a green `✓ filled` pill once she fills it. "Publish now" + "Save draft" pinned in the header; chat commands ("publish it", "save as draft") render an in-thread confirm card with a form-state snapshot so later edits can't drift what ships.

**For existing posts** — `AllyFloatingChat` is a bottom-right Intercom-style widget on every post-detail page (drafts / live / on-hold). Closed = pill button "Improve with Ally". Open = ~440×640 panel with thread + composer + proposal cards. AI replies that touch title/body/meta render an Apply button that patches the parent form (advisory — Save still goes through the existing buttons). "See the diff" opens a side-by-side dialog (Current vs Proposed) with full HTML previews. Per-post chat history persists in localStorage; reopen = resume.

**Conversation history** — `/dashboard/blog/ally-history` lists every persisted chat across all posts (resume, search, delete). Linked from the Blog Posts header.

### Ally's brain

- **Model**: Claude Sonnet 4.6 (`claude-sonnet-4-6`).
- **Schema**: Ally returns a namespaced envelope per turn — `<reply>`, `<post_title>`, `<post_body>`, `<seo_title>`, `<seo_description>`, `<seo_tags>`, `<post_author>`, `<post_category>`, `<post_action>` (publish | save_draft), plus four advisory tags: `<changes_summary>` (bulleted "what I changed"), `<ally_suggest_research>` (true when she'd benefit from web data), `<ally_remember>` (persistent memory), `<ally_forget>` (not yet emitted but parsable). All tag names are `post_*`/`seo_*`/`ally_*` prefixed to avoid colliding with real HTML elements (the `<html>` collision bug bit us once already).
- **Status indicator**: `AllyThinking` (in `src/components/blog/ally-status.tsx`) drives a phase-aware progress display — Eye/Globe/BookOpenText/PenLine/ScrollText/Sparkles icons rotate as Ally moves through Reading → Searching (research-on only) → Reading sources → Drafting → Polishing. 3-5 rotating label variants per phase cycled every 2.5s. Replaces the old single "Working on it…" text. Live status owns the pending bubble — no separate loader.
- **Queued messages**: Composer stays sendable while a turn is in flight. Sends while pending append to the thread with a "queued" badge + ring outline. A `useEffect` watching `chat.isPending` promotes the first queued message + fires the next turn when ready.

### Team archive integration (the big SEO unlock)

`buildSystemPrompt` fetches up to 50 live team posts and injects two sections into every chat:

1. **ARCHIVE CATALOG** — all 50 posts as one-liners with title + category + date + URL so Ally knows what exists.
2. **DETAILED EXCERPTS** — top 8 topically-ranked posts (word-overlap score on title × 3 + category × 2 + tags × 1 + 0–5 recency bonus over 150 days) with ~1100-char body excerpts.

System prompt is explicit: *"The posts below ARE the URLs. You do NOT need to fetch anything. NEVER say 'I can't access URLs'."* + concrete cross-link rules ("our market update" → find Market Reports post → quote stats → link inline). Cures the failure mode where Ally claimed she couldn't access team URLs and fabricated stats instead.

### Gemini research (3-mode toggle)

- **Auto** (default): server runs a keyword intent detector on the latest user message (direct intent like "research X", freshness markers like "current/this month/2026/today's", market-stat vocab, market-report references); only fires Gemini when matched. Zero Gemini cost on tone-tweak / structural-edit turns.
- **Always**: Gemini every turn (force-on via the `+` menu toggle).
- **Never**: skip grounding entirely.

Each research call uses **Gemini 2.5 Flash with googleSearch grounding**. Returns synthesized 200-400 word summary + numbered sources. Server injects the brief + sources into the Claude system prompt; Claude cites `[n]` inline and emits a `<h3>Sources</h3><ol>` at the end of the post. Cost recorded as `stage=blog_research, provider=gemini, model=gemini-2.5-flash`.

`<ally_suggest_research>true</ally_suggest_research>` is Ally's hint when auto-mode skipped but she'd have benefited; UI renders a "Search the web & retry" pill that toggles research + resends in one click.

### Source allowlist (no competitor realtors)

`lib/blog-engine/source-allowlist.ts` exports `isAllowedSource(url)` and `SOURCE_RULE_TEXT`:

- **Allowed**: Realtor.com / Zillow / Redfin / Trulia / Homes.com / Movoto / Homefinder, Reuters / AP / Bloomberg / WSJ / NYT / CNBC / MarketWatch, local news (WINK / NBC-2 / Fox 4 / yoursun.com / Tampa Bay Times / Miami Herald), industry data (NAR / Florida Realtors / Stellar MLS / Freddie Mac / Fannie Mae / Inman / HousingWire), any `.gov` or `.edu`, and the team's own posts.
- **Blocked**: Century21 / RE-MAX / KW / Coldwell Banker / Compass / eXp / Sotheby's / Douglas Elliman / Berkshire Hathaway, any URL matching `/agent[s]?/` / `/our-team/` / `/meet-(the-)?team/` on non-portal domains, heuristic catches for domains containing `realty/realtor/realestate/homes/team/group/partners/properties/brokerage`.

Defense-in-depth: `SOURCE_RULE_TEXT` is appended to both Ally's `BASE_SYSTEM_PROMPT` and Gemini-research's `SYSTEM` instruction, AND the Gemini result's `sources[]` is filtered through `isAllowedSource()` before reaching Ally or the UI.

### Persistent memory (`ally_memories` table)

Migration 057 added `ally_memories` (site-scoped, soft-delete, max 100/site, dedup on identical content). User says "remember X" → Ally emits `<ally_remember>X</ally_remember>` → server stores it. All subsequent chats inject active memories as `ALLY'S NOTES` at the top of the system prompt. New `GET /api/blog/ai/memories` + `DELETE /api/blog/ai/memories?id=` endpoints. UI: Brain icon + badge in the floating chat header opens a Popover listing memories with per-item trash-to-forget. Toast confirms each new memory.

### Files / fields / state visibility

- **File uploads** on both chat surfaces (`AllyFloatingChat` + `BlogPostChatCompose`): PDF / image / CSV / .txt, max 5 × 3 MB, one-shot per turn (consumed on send), sent as Anthropic content blocks on the most recent user turn.
- **Templates**: + menu has a Template picker; selected template's body_html is injected as a `<template>` structural block in the system prompt.
- **Internal linking** to past team posts is enforced via system-prompt rule + topical scoring.
- **Visible changes**: `<changes_summary>` bullet list rendered in the proposal card + a "See the diff" button that opens a side-by-side modal (Current/Proposed iframes + inline title diff + Apply-from-dialog).
- **Skeleton + shimmer** while Ally works: `AllySkeleton` (empty preview, first turn) + `AllyShimmerOverlay` (regenerating, has prior draft).

### Other dashboard improvements

- **Soft-delete with checkboxes** (`DeletePostDialog`): "Remove from dashboard" + "Remove from Sierra (public site)" toggles. Sierra-side runs a new `unpublish` blog_jobs kind via Browserbase that opens `/blog-manager.aspx`, locates the row by `external_post_id`, auto-accepts the JS confirm, verifies the row is gone.
- **On-hold state**: `POST /api/blog/posts/[id]/hold {hold:boolean}` toggles between `live` and `on_hold`. Dashboard-only — never touches Sierra. Pause/Resume buttons + status pill + filter.
- **Routing fix**: `vercel.json` got 7 new rewrites for `/api/blog/posts/[id]/*` paths (`/publish`, `/reject`, `/edit-on-sierra`, `/hold`) + `images/[id]` + `templates/[id]`. Without these, every dynamic blog API path 404'd.
- **List page unstick**: missing FK `blog_posts.image_id → blog_images.id` (migration 056) was causing PostgREST 400 on the embed query → react-query retries → "Loading…" forever. Fix applied to prod via MCP.
- **TinyMCE editor** (replaces Tiptap): loaded GPL from jsDelivr (no API key, no domain registration). Matches Sierra's TinyMCE 8 renderer so the editor view IS the preview. Bundle ~400 KB smaller.
- **Big preview** with Open-in-new-tab + Source/Code view toggle. 2fr/3fr split (preview-dominant, Claude.ai artifact ratio).
- **Composer**: `AutoGrowTextarea` grows to a pixel cap then scrolls inside. Killed Chrome's focus rectangle via `.ally-composer-input` class with `!important` rules + `-webkit-appearance: none`.

### Migrations applied this session

- **052** (`blog_templates_defaults`) — was committed to the repo months ago but had never been applied to prod Supabase; surfaced as 500 on the first template save. Applied via MCP.
- **056** (`blog_posts_image_id_fk`) — added the missing FK that was hanging the dashboard list.
- **057** (`ally_memories`) — persistent memory table.

### Key files

- `api/blog/ai/chat.ts` — the heart of Ally. ~600 lines covering schema, intent detection, research, memory, archive injection, cost tracking.
- `lib/blog-engine/gemini-research.ts` — Gemini 2.5 Flash googleSearch wrapper + source filter.
- `lib/blog-engine/ally-memory.ts` — list/add/deactivate helpers + system-prompt block builder.
- `lib/blog-engine/source-allowlist.ts` — `isAllowedSource(url)` + `SOURCE_RULE_TEXT`.
- `lib/blog-engine/publishers/sierra/unpublish.ts` — Browserbase Sierra delete.
- `src/pages/dashboard/BlogPostChatCompose.tsx` — full-page chat-compose for new posts.
- `src/pages/dashboard/BlogAllyHistory.tsx` — conversation history viewer.
- `src/components/blog/AllyFloatingChat.tsx` — Improve-with-Ally widget.
- `src/components/blog/AIChatModal.tsx` — legacy modal kept for compatibility.
- `src/components/blog/ally-status.tsx` — `AllyThinking`, `AllyPulse`, `AllySkeleton`, `AllyShimmerOverlay`, `AutoGrowTextarea`, `useAllyStatus`.
- `src/components/blog/ally-storage.ts` — per-post chat localStorage persistence (used by floating chat + history page).
- `src/components/blog/ally-starters.ts` — daily-rotating starter chips pool.

### Open follow-ups (not addressed this session)

- Streaming responses (currently buffered — the phase-rotation status is a UX patch, not real streaming).
- Per-author voice profiles (Ally could learn each agent's voice from their past posts; currently treats all team posts as one voice).
- Auto-listing-to-post pipeline (MLS → new draft) — pitched but not built.
- Multi-channel snippets (IG/FB/LinkedIn captions + email paragraph per post) — pitched but not built.
- ESLint `import/extensions: ['error', 'always', { ts: 'never' }]` to catch the Vercel .js-extension gotcha in CI.
- Expired `ANTHROPIC_API_KEY` in GitHub Actions secrets — claude-review workflow still failing on PRs.

### PR list (this session, in order)

#39 + #43 (publish unbreak — earlier session) → #46 (directory imports) → #50 (list FK unstick) → #51 (Sierra route fix + dialog) → #52 (rename modal) → #53 (error state) → #54 (preview popout + research toggle) → #55 (TinyMCE) → #56 (hero + + menu) → #57 (chat-as-page) → #58 (post_body tag fix) → #59 (instant placeholder + Ally rename) → #60 (Gemini research) → #61 (floating chat + research suggest) → #62 (composer growth + contrast + skeleton) → #63 (auto-research) → #64/#65 (focus outline) → #66 (visible changes) → #67 (queue) → #68 (phase status + uploads + persistence) → #69 (archive + history + daily starters) → #70 (source allowlist + memory).

---

**2026-05-14 evening (PR #51): Smoke test surfaced four follow-on gaps; all fixed.**

1. **DELETE returned 404** — and so did every other `/api/blog/posts/[id]/...` path. `vercel.json` defines explicit `routes` (not filesystem-based dynamic resolution); all other dynamic API paths in this repo had explicit rewrites, but the blog ones did not. Added 7 new rewrites for `posts/[id]`, `posts/[id]/{publish,reject,edit-on-sierra,hold}`, `images/[id]`, `templates/[id]`. This was the root cause of "Delete failed: 404" and probably affected other blog detail flows nobody had exercised since the engine shipped.

2. **`window.confirm` replaced with a real dialog.** New `src/components/blog/DeletePostDialog.tsx` — two checkboxes ("Remove from this dashboard" + "Remove from Sierra (public site)") plus Cancel / Confirm. The Sierra checkbox is disabled when the post has no `external_post_id`. The list trash icon and the detail-page Delete button both open it.

3. **Sierra-side delete is real (was always TODO).** New `blog_jobs.kind = 'unpublish'`. `lib/blog-engine/publishers/sierra/unpublish.ts` opens `/blog-manager.aspx`, locates the row by `external_post_id` (title fallback), auto-accepts the JS `confirm()` Sierra fires, waits for the table to re-render, verifies the row is gone. New handler in `lib/blog-engine/jobs/handlers/unpublish.ts`. Recorded as `blog_publish_browser` cost stage with `metadata.action = "unpublish"` (10¢ Browserbase). The Delete API checks `body.fromSierra` and enqueues this job before the soft-delete. **Selectors are best-guess** (`a:has-text("Delete")` + `a[onclick*="confirm"]` + a couple of `[alt*="delete"]` variants); first real run will tell us if they need tuning — if so update `unpublish.ts`'s selector list, never inline.

4. **New `on_hold` state.** Dashboard-only — does NOT touch Sierra. New `POST /api/blog/posts/[id]/hold { hold: boolean }`. Detail page has Pause/Resume button visible in `edit-live` (Put on hold) and a new `on-hold` mode (Resume back to Live). Banner reads "On hold — hidden from the 'Live' filter. Sierra-side copy is untouched." New "On hold" filter pill in the list + slate pill color. No DB migration needed — `blog_posts.state` is `text` with no CHECK constraint.

**Files touched (PR #51 only):**
- `vercel.json` — 7 new route rewrites
- `lib/blog-engine/types.ts` — added `on_hold` state, `unpublish` job kind
- `lib/blog-engine/publishers/types.ts` — `Publisher.unpublish()` + `UnpublishResult`
- `lib/blog-engine/publishers/sierra/{index.ts, unpublish.ts}` — sierra implementation
- `lib/blog-engine/jobs/handlers/{index.ts, unpublish.ts}` — handler + registration
- `api/blog/posts/[id].ts` — DELETE accepts `{ fromDashboard, fromSierra }`
- `api/blog/posts/[id]/hold.ts` — new endpoint
- `src/lib/blog/api-client.ts` — `deletePost(id, { fromDashboard, fromSierra })` + `setHold(id, hold)`
- `src/components/blog/DeletePostDialog.tsx` — new
- `src/pages/dashboard/BlogPostsList.tsx` + `BlogPostDetail.tsx` — dialog hookup + on-hold button + on-hold filter/banner

**Verification:**
- `vite build` green.
- My touched files clean under `tsc`; the pre-existing TS warnings in `publish.ts`/`taxonomy.ts`/PromptLab/scene-ordering tests still present (unchanged).
- Route fix is verifiable from outside auth (the path stops 404'ing, starts 401'ing).

**Open follow-ups:**
- First real Sierra unpublish will tell us if the row-Delete selectors are right. If not, update `lib/blog-engine/publishers/sierra/unpublish.ts` selectors and add a `probe-sierra-delete.ts` similar to the publish probe.
- Still pending from earlier: ESLint `import/extensions` rule + expired GitHub Actions ANTHROPIC_API_KEY.

---

**2026-05-14 PM: Blog dashboard list was stuck on "Loading…" + no Delete button + Publish click looked silent.** Three fixes:

1. **Blog posts list page hung at "Loading…".** `app/blog/posts` list (and the detail GET) embed `image:image_id (id, blob_url, vision_caption)` via PostgREST. `blog_posts.image_id` had **no foreign-key constraint** to `blog_images(id)` — only `site_id` was an FK — so PostgREST returned `400 Could not find a relationship`. React Query retried, then sat in a fetching state and the user-facing fallback only checks `isLoading`/`posts.length`, so the "Loading…" stayed up. Fixed by migration `056_blog_posts_image_id_fk.sql`: `alter table blog_posts add constraint blog_posts_image_id_fkey foreign key (image_id) references blog_images(id) on delete set null;` + `NOTIFY pgrst, 'reload schema'`. Confirmed 0 orphans before applying. Already applied to shared prod Supabase via MCP — refresh the page and the list loads.

2. **No way to delete a post from the dashboard.** Added `DELETE /api/blog/posts/[id]` (soft-delete via `active=false`; the existing list query already filters on `active=true` so hidden rows disappear cleanly). UI: trash icon at the right of every list row, and a `Delete` button in the post detail action bar. Both confirm-prompt before firing. Sierra-side post is **not** touched — that's a separate manual step if you want to take it offline on Sierra too.

3. **"Publish now" looked like it did nothing.** Backend was fine — post 60418 "Test Smoke" went live the same minute the click fired (job `0df7853d`, `attempts=1`, `last_error=null`). The UX failure was no in-flight indicator: toast.success flashes once, page navigates to detail, post is in `publish_due` which renders as the readonly branch (no buttons, no status banner) for the ~60s it takes the cron to flip it to `live`. Added a primary-color "Publishing to Sierra — usually live within 60s · this page refreshes automatically" banner whenever `post.state ∈ {publish_due, publishing, editing}`, and a green "✓ Live on Sierra — View on Sierra ↗" banner once `state==='live'`. Also added spinner + "Publishing…" / "Saving…" / "Deleting…" labels on the buttons themselves while their mutations are pending so the click registers visually.

**Files touched:** `supabase/migrations/056_blog_posts_image_id_fk.sql` (new), `api/blog/posts/[id].ts` (DELETE handler), `src/lib/blog/api-client.ts` (`deletePost(id)`), `src/pages/dashboard/BlogPostsList.tsx` (trash icon + confirm + mutation), `src/pages/dashboard/BlogPostDetail.tsx` (status banners + button spinners + Delete button).

**Verification:** DB FK present in `information_schema.table_constraints`; 0 orphaned `image_id`s before applying; Supabase API logs show no `400` on `blog_posts` after the migration; `vite build` green (3214 modules); my files type-check clean (pre-existing TS warnings in `publish.ts`/`taxonomy.ts`/PromptLab tests untouched — already in deployed main); Sierra-side: post 60418 "Test Smoke" confirmed publicly live on thehelgemoteam.com/blog.

**PR #50** on `worktree-blog-post-fix-2`. DB fix is already serving prod since Supabase is shared; the Delete buttons + banners need the SPA deploy.

---

**2026-05-14 (earlier): Creatomate Just Listed #01 rev-2 — 15s template wired end-to-end through the pipeline.** Oliver redesigned the Just Listed template (canvas → 1920×1080, 30fps; added Audio-Music slot; renamed all text placeholders to `*-Intro` / `*-Mid` / `*-Final` convention; designed for 15s only — 30s + 60s templates pending). Code-side rewrite to match: new mapper keys, duration-suffixed env vars, vertical-aware resolver. PR #46 (`feat/creatomate-template-rev2`) cascaded `dev → staging → main`.

**Diagnosis (the actual user-facing problem before the fix):** every Creatomate template render was coming out 1280×720 at 24fps with no text overlays. Three root causes, all empirically verified with three live `/v2/renders` API calls:

1. **`width`/`height` in the request body are silently ignored for template renders.** Output dimensions come from the template canvas; `render_scale` is the only knob. Provider's `assembleFromTemplate` was passing `width: 1920, height: 1080` thinking it would force HD — Creatomate just used the template's 1280×720 canvas. Same root cause produced wrong-aspect "vertical" renders (the 9:16 path swapped `width: 1080, height: 1920` → got 16:9 anyway).
2. **All template placeholder names had been renamed in the editor.** Old mapper wrote `St#/StName.text`, `Vid-Category/Title.text`, etc.; rev-2 template's elements are `St#/StName-Intro`, `Vid-Category-Intro`, `Listing-Agent-Mid` + `-Final`, `Listing-Brokerage-Mid` + `-Final`, `Full-Address-Final`, `Audio-Music`. Creatomate silently drops modification keys for placeholders it doesn't have, so every text field rendered as the template's default ("123 Waymay Dr", "Brian Helgemo", etc.). Discovered via `GET /v1/templates/:id` inspection.
3. **Template was designed for one duration (15s) but the resolver had no concept of duration.** A 30s or 60s order would have rendered against the 15s template anyway — wrong-length video.

**Fix shipped (7 files, +364/-156 across `lib/assembly/` + `lib/providers/creatomate.ts` + `lib/pipeline.ts` + `.env.example`):**

- `lib/assembly/template-modifications.ts` — rewritten for rev-2 slot names. Writes `St#/StName-Intro.text`, `City/State-Intro.text`, `Vid-Category-Intro.text`, `Listing-Agent-Mid.text` + `-Final.text`, `Listing-Brokerage-Mid.text` + `-Final.text`, `Full-Address-Final.text`, `Audio-Music.source`, optional `Agent-Headshot-Final.source` (skipped until `user_profiles.headshot_url` exists), `Clip-1.source` … `Clip-8.source`. 14 vitest cases.
- `lib/assembly/template-resolver.ts` — adds `selectedDuration` + `aspectRatio` to context. Resolution priority: per-order `template_id` override → `CREATOMATE_TEMPLATE_ID_<PKG>_<DURATION>[_VERTICAL]` → legacy `CREATOMATE_TEMPLATE_ID_<PKG>` (only when duration is null AND aspect is 16:9) → `CREATOMATE_TEMPLATE_ID_DEFAULT` (same caveat) → null. **Safety rule:** when `selectedDuration` is set but no matching `_<DURATION>` template exists, returns null — pipeline falls back to code-gen instead of shipping a wrong-length template render. **Vertical safety:** 9:16 never falls back to legacy un-suffixed vars; without a `_VERTICAL` template, the pipeline skips the 9:16 render entirely (half the Creatomate credits per order until vertical templates exist). 14 vitest cases.
- `lib/pipeline.ts:1090-1110` — resolves horizontal + vertical template IDs separately. Caps `clipInputs.slice(0, 8)` before building modifications (defense-in-depth; duration-fit usually keeps us at ≤8 anyway). Wraps vertical render in `if (!skipVertical)` guard — `vertical_video_url` stays null when no vertical template, UI's existing `&&` handles it.
- `lib/providers/creatomate.ts` — dropped the dead `width`/`height` fields on `TemplateRenderOptions`. `renderScale` is the only knob now; doc comment explains why.
- `.env.example` — documents `_15`/`_30`/`_60` suffix scheme + `_VERTICAL` suffix + the "no vertical fallback" rule.

**Vercel env changes:** added `CREATOMATE_TEMPLATE_ID_JUST_LISTED_15=2f634180-1e85-4f11-b500-2bb57b277581` to prod/preview/dev. Removed legacy `CREATOMATE_TEMPLATE_ID_JUST_LISTED` after main deploy landed. `_JUST_LISTED_30` + `_JUST_LISTED_60` slots created (empty) — fill when those templates exist.

**Verification:**
- 119/119 vitest, `tsc --noEmit` clean.
- Three live `/v2/renders` smokes against the template through three iterations: first run came back 1280×720 / 24fps with no overlays (broken state); second after Oliver's template edits came back 1920×1080 / 24fps; third after fps fix + code rewrite came back **1920×1080 / 15s / 30fps with all overlays present**: <https://f002.backblazeb2.com/file/creatomate-c8xg3hsxdu/b068ba28-a82f-4c30-a2eb-289391d711f7.mp4>
- End-to-end TS smoke `scripts/smoke-rev2-template.ts` exercises resolver → mapper → provider with the rev-2 env scheme; vertical correctly returns null + is skipped.

**Open follow-ups:**
- Build `CREATOMATE_TEMPLATE_ID_JUST_LISTED_30` + `_60` templates (Creatomate editor) and fill the corresponding Vercel env vars. Until then, 30s/60s orders fall through to the code-gen path.
- Vertical (9:16) templates remain unbuilt. Per Oliver: not offering vertical yet. When that changes, design a 1080×1920 sister template and set `CREATOMATE_TEMPLATE_ID_JUST_LISTED_15_VERTICAL`.
- `Agent-Headshot-Final.source` is wired in the mapper but never sent because `user_profiles` has no `headshot_url` column. Template's default headshot plays. Add the column + UI when ready.
- `just_pended` / `just_closed` / `life_cycle` templates: none configured; those orders fall back to code-gen.

---

**2026-05-13 PM: Blog "Publish now" path unbroken end-to-end — PR #39 + follow-up landed, prod env vars set, deploy promoted.** The button has been silently failing since the blog engine shipped (Phase 1, 2026-05-07). User clicks → API enqueues a `blog_jobs` row → per-minute cron `/api/cron/poll-blog-jobs` returns `500 FUNCTION_INVOCATION_FAILED` → job sits `queued` forever. One real example was stuck 22h: post `0f68207f-…` "Charlotte County Housing Market Update – May 2026 B", job `8f6500b9-…`.

Four stacked failures, each a separate fix:

1. **Cron crashed on cold-start with `ERR_MODULE_NOT_FOUND` — the actual immediate cause.** `lib/blog-engine/jobs/handlers/index.ts` and 11 peers imported with bare specifiers (`from "./fetch-taxonomy"`). The rest of the repo uses explicit `.js` suffixes because Vercel's `@vercel/node` ESM bundler preserves the literal import path and Node ESM resolver in `/var/task` requires the extension. The bundled cron exited status 1 on every invocation; the HTTP response gave no detail — only `vercel logs <prod-url>` exposed it. Fixed across 12 files (50 import sites) under `lib/blog-engine/jobs/handlers/` + `lib/blog-engine/publishers/sierra/`. Local vitest + tsx passed because both resolve extensionless TS imports — only Vercel's runtime is strict. PR #43 ships this. PR #39 (lazy Browserbase + cron auth + TinyMCE 8) merged earlier today but did not on its own flip the endpoint to 200 because this resolver crash fires first.

2. **Browserbase SDK was instantiated at module load** (PR #39). `lib/blog-engine/browserbase.ts` had `const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! })` at module top with `BROWSERBASE_API_KEY` absent in prod — a latent bomb that would have surfaced next once the `.js`-extension fix unblocked the import. Wrapped in a lazy getter. **Anti-pattern lesson:** any new module that does `const x = new SomeSdk({ apiKey: process.env.FOO! })` at module top-level is a cold-start crash waiting to happen on Vercel.

3. **Cron auth used a never-set secret** (PR #39). `BLOG_CRON_SECRET` was required for every cron call but never set anywhere. Vercel cron auto-sends `Authorization: Bearer <CRON_SECRET>` (the standard `CRON_SECRET` env). Switched the gate to an optional `CRON_SECRET` check — enforce when set, allow when not — matching the other crons in this repo which have no auth gate.

4. **TinyMCE 8 ready-check was wrong** (PR #39). Once the cron actually ran the job, the Sierra publisher timed out on `page.waitForFunction(() => ... tinymce.editors?.length > 0)`. Probe (`scripts/blog/probe-sierra-editor.ts`) confirmed Sierra now ships TinyMCE 8 (`res/tinymce8/tinymce.min.js`), which dropped the `tinymce.editors` array in favor of `tinymce.activeEditor` / `tinymce.get(0)`. Updated `publish.ts` + `edit.ts` to poll the new accessors with the `initialized` flag.

Plus two follow-on niceties: after Sierra's success indicator, bounce to the blog manager and look up the post by title to capture a real `external_post_url` (with `?id=`) + numeric `external_post_id` — Sierra keeps the form-with-filters URL on the publish page itself; and the job runner now clears `last_error` on retry-success so a `state=done` row doesn't carry its prior failure annotation.

**Verification (in this session):**
- Drained the 22h-stuck job locally with the fix applied. Post 60391 is **live on Sierra**, confirmed via `scripts/blog/verify-post-live.ts` against `client2.sierrainteractivedev.com/blog-manager.aspx`.
- Patched the DB row's `external_post_url` + `external_post_id` to point at the real edit page (Sierra id 60391) so the dashboard "View on Sierra" link works.
- tsc clean. vitest blog-engine suite 21/21.
- 5 missing prod env vars (`BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `SIERRA_HELGEMO_USERNAME`, `SIERRA_HELGEMO_PASSWORD`, `SIERRA_HELGEMO_SITE_NAME`) set via Vercel REST API `POST /v10/projects/{id}/env?upsert=true`.
- PR #39 + PR #43 merged into main; Vercel production deploy promoted (post-PR-#43 build pending at time of writing).

**Branch + PR summary:**
- 3 commits across two branches/PRs:
  - PR #39 (`worktree-blog-post-fix`): `e70ec1d` (lazy Browserbase + cron auth), `fb92d14` (TinyMCE 8 + post-id capture + last_error clear + 2 smoke probes). Merged via PR #39 → main.
  - PR #43 (`worktree-blog-post-fix-2`): the `.js`-extension fix on top of the latest main. Cherry-pick of `e8bc576`.

**Open follow-ups:**
- **Watch a real click on listingelevate.com once PR #43 deploy is Ready.** Compose a post, click "Publish now"; within 60s the cron should pick it up and post.state should flip `publish_due → publishing → live`. If you see `live` + an `external_post_url` containing `?id=`, the round-trip works.
- **GitHub Action `claude-review` is misconfigured.** Workflow failed on PR #39 + #43 with `Invalid API key · Fix external API key` — the `ANTHROPIC_API_KEY` in the repo's GitHub Actions secrets is expired/wrong. PRs merged anyway because `main` has no branch protection, but worth fixing so future PRs get real review. Not blocking.
- **Probes in `scripts/blog/`** — `probe-sierra-editor.ts`, `verify-post-live.ts` are smoke utilities, harmless to keep. Use them next time Sierra changes their admin form.
- **Lesson worth codifying in CI:** add an ESLint rule (`import/extensions: ['error', 'always', { ts: 'never' }]` or similar) that flags relative TS imports missing `.js` — Vercel runtime is the only place that catches this and it's too late.

---

**2026-05-13 (LIVE on listingelevate.com): launch-prep cascade complete.** Order → assembled MP4 pipeline is functional in production. Five PRs merged today (#37, #38, #40, #41, #42). Full session report at [`sessions/2026-05-13-launch-prep-creatomate-shotstack.md`](./sessions/2026-05-13-launch-prep-creatomate-shotstack.md).

**What shipped (one paragraph each):**

- **Order-form persistence** (PR #37). Migration 054 + 5 plumbing touchpoints. Upload form's 9 order-specific fields (`selectedPackage`, `selectedDuration`, `selectedOrientation`, `addVoiceover`, `addVoiceClone`, `addCustomRequest`, `customRequestText`, `daysOnMarket`, `soldPrice`) now persist to `properties`. Pipeline already reads `selected_duration`; 15s/30s tiers were silently rendering at 60s — fixed.

- **Cron-assembly wire** (PR #38). `runAssembly` had been dead code (sat after an early `return;` in `runPipeline`); cron `poll-scenes.ts` marked properties `complete` without ever calling it. Now exported + invoked from the cron's finalize block. `'assembling'` added to terminal-status skip list. `try/catch` flips to `failed` on throw rather than getting stuck.

- **Phase 2–6 assembly modules** (PR #38, all under `lib/assembly/`).
  - `scene-ordering.ts` (11 tests) — deterministic walkthrough order (aerial → exterior_front → foyer → living → dining → kitchen → master_bed → bedroom → bathroom → … → exterior_back).
  - `duration-fit.ts` (10 tests) — reads `properties.selected_duration` (15/30/60). Allocates `target/N` per clip floored at 2.5s. Drops scenes by highlight tier when over budget; walkthrough order preserved within survivors.
  - `branding.ts` — pulls `user_profiles.brokerage / logo_url / colors` via `properties.submitted_by`. Falls back to `properties.brokerage` + emerald defaults.
  - `music.ts` (6 tests) — operator-pinned wins, else auto-pick by package mood. Library: migration 055 + 5 seed rows (SoundHelix placeholders, **replace before launch**).

- **Creatomate template-mode** (PR #38). `CreatomateProvider.assembleFromTemplate(templateId, { modifications, width, height, renderScale })` + `getTemplate(id)` for introspection. Endpoint `/v2/renders`. `template-modifications.ts` (13 tests) maps `AssembleVideoParams + branding + package` → modification dict (`St#/StName.text`, `Vid-Category/Title.text`, `Clip-1.source`…`Clip-N.source`). `template-resolver.ts` (8 tests) resolves `properties.template_id` > `CREATOMATE_TEMPLATE_ID_<PKG>` env > `_DEFAULT` > null. Template `2f634180-…` (Just Listed #01) wired for `just_listed` package.

- **Shotstack parallel port** (PR #38). Same Just Listed layout rebuilt in code via `buildShotstackJustListedTimeline` using Shotstack HTML clips for full Inter+CSS styling. No Shotstack Studio template required. `ASSEMBLY_PROVIDER` env var (`creatomate` | `shotstack`) overrides the router's default Creatomate-first priority. A/B testable in parallel without code changes.

- **Migrations applied to prod Supabase via MCP:** 053 (`assembly_timeline` jsonb + `video_revisions` table + `cost_events.provider` widened to include `creatomate`), 054 (9 order-form columns + CHECK constraints), 055 (`music_tracks` + `properties.music_track_id` FK), 056 (`properties.template_id` text).

- **Vercel env vars set across production / preview / development:** `CREATOMATE_API_KEY`, `CREATOMATE_TEMPLATE_ID_JUST_LISTED=2f634180-…`, `SHOTSTACK_API_KEY`, `SHOTSTACK_ENV=production`.

**Mid-session bugs found + fixed:**
- `processing_time_ms` int4 overflow on weeks-old properties (`pipeline.ts`) — now reads `pipeline_started_at`, clamps to `2^31-1`.
- `assembly-router.ts` `require()` imports broke ESM/tsx runtime — converted to static imports.
- Creatomate `/v2/renders` source-mode returned JPG thumbnails — root cause was the `source:` wrapper (v1 convention); spreading the RenderScript at top level + explicit `render_scale: 1` + `duration: totalDuration` fixed it.
- Creatomate v2 source-mode silently truncating to 5s — same fix (spreading at top level).
- Template clip slot naming mismatch — Just Listed #01 uses `Clip-1`…`Clip-8` (hyphenated); mapper was writing `Clip1`…`ClipN`. Fixed.

**Test count:** 48 vitest cases across `lib/assembly/*.test.ts`. tsc + eslint clean.

**Post-launch action items (your side, none blocking functionality):**
1. **Bump Just Listed #01 template canvas to 1920×1080** in the Creatomate editor. Currently 1280×720 → output is 720p not full HD.
2. **Add `Clip-9`…`Clip-12` slots** to the template. Pipeline targets 12 scenes; template has 8 — extra clips drop silently.
3. **Build template variants for the other packages** (Just Pended, Just Closed, Life Cycle). Then add their IDs as Vercel env vars (`CREATOMATE_TEMPLATE_ID_JUST_PENDED`, etc.). Without these, non-`just_listed` orders fall back to the code-generated `buildCreatomateTimeline` layout.
4. **Replace `music_tracks` seed rows** (SoundHelix placeholders) with real royalty-free MP3s in Supabase Storage.
5. **Rotate the Shotstack API key** — was visible in chat history this session.

**Remaining pre-launch blockers from Oliver's 2026-05-13 brainstorm:**
- ✅ #2 Creatomate / template-driven assembly — shipped
- ⏳ #1 post-gen QC AI — unblocked (we have `assembly_timeline` JSON to reason over)
- ⏳ #3 Eleven Labs voiceover
- ⏳ #4 Music library (placeholders in place; real tracks TBD)
- ⏳ #5 Owner dashboard

**Migration drift (still standing):** repo migrations 050–052 (blog phase 5 + templates + AI) remain unapplied to prod. Remote has `portal_deliverables`/`portal_orders_checkout_session`/`050_portal_pay_on_approval`/`portal_orders_order_number_v2` with no migration files in the repo. Worth a dedicated audit before the next big push.

---

**2026-05-13: Prompt-collapse fix LIVE on main — full cascade dev → staging → main + DIRECTOR_SYSTEM patch promoted + mining re-run.** listingelevate.com running per-photo retrieval + DA.3 prompt rewrite + top-K recipe rendering as of `326991e`. Investigation: prod was producing the same motion ("low angle glide") in 4-6 of 12 scenes per listing. Multi-factor root cause; 8 commits landed three orthogonal fixes:

1. **DA.3 prompt-rewrite guard** — `lib/prompts/rewrite-on-motion-override.ts`. When the validator overrides `camera_movement`, it now also rewrites `scene.prompt` text via deterministic template-fill so the SKU and prompt agree. Applied at both DA.3 sites (`lib/pipeline.ts` prod + `lib/prompt-lab-listings.ts` listings-lab). 9 vitest cases.

2. **`renderRecipeBlock` top-K bug** — was rendering only `recipes[0]`, silently discarding matches 2 and 3. Now renders top-3 (configurable via `opts.maxK`) with explicit similarity scores (`1 - distance`). 6 vitest cases. `lib/prompt-lab.ts`.

3. **Per-photo retrieval into prod** — `lib/prompts/per-photo-retrieval.ts`. `runScripting` now fetches recipes + exemplars + losers PER PHOTO (scoped to room_type + image_embedding), with recipes compatibility-filtered against `motion_headroom`. Replaces the previous global top-5 PAST GENERATIONS block in `lib/pipeline.ts`. 8 vitest cases for the filter.

**Verification:** tsc clean, vitest 254/255 (1 fail = pre-existing `MarketComparison.test.tsx` flake), doctor clean for this branch.

**Bundled hygiene:** forward-port of `757823a` (vitest pin to ^3) — dev branch had vitest ^4.1.4 which breaks under vite 5 with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Without this, the test suite couldn't run.

**Branch summary:**
- Spec: [`specs/2026-05-13-prompt-collapse-fix-design.md`](./specs/2026-05-13-prompt-collapse-fix-design.md)
- Plan: [`plans/2026-05-13-prompt-collapse-fix.md`](./plans/2026-05-13-prompt-collapse-fix.md)
- Session: [`sessions/2026-05-13-prompt-collapse-fix.md`](./sessions/2026-05-13-prompt-collapse-fix.md)
- 8 commits on `feat/prompt-collapse-fix`: `97e2dcb`, `5dc4771`, `ccc2dbb`, `f7e41a0`, `72ccf81`, `10014b2`, `c0509ee`, `faae93c`. Merged via PR #30 → dev, PR #31 → staging, PR #32 → main.

**Operational follow-ups COMPLETED in same session (2026-05-13 ~02:00 UTC):**
- **DIRECTOR_SYSTEM patch `c0708a98` promoted to prod.** Lab-applied since 2026-04-30; verified compile-time `lib/prompts/director.ts` had no edits since 2026-04-28 mining run, so no regression from base-version mismatch. Inserted into `prompt_revisions` as version 4 with `source='lab_promotion'`, `source_override_id=87064053-…`, `body_hash=ac365465`. `resolveProductionPrompt` picks it up on next render. Six evidence-grounded changes: Atlas pool rise ban + curve-direction note + dolly phrasing + banned phrases ("subtle drift") + drone roofline rule + drone pull-back anchor rule. Lab override audit row updated (`promoted_to_prod_at` + `promoted_prompt_revision_id`).
- **Mining re-run.** 245 rated iterations over last 60 days → 26 qualifying buckets → new proposal `9a0990f0-cb6e-44dd-991c-0c5cf5cf53c2` stored with `status='pending'`, 5 evidence-grounded changes: (1) Atlas push_in requires lateral curve modifier (4 iter evidence), (2) Kling kitchen dolly_left_to_right reliability warning + push_in fallback (5 iter), (3) ban Atlas pool parallax → push_in (1 iter, zero winners in bucket), (4) ban "very subtle" modifier (1 iter, parallel to "subtle drift" ban), (5) ban compound "tilt up then fly forward" drone constructions (1 iter). Cost: $0.33 (48,960 tokens). Awaiting Oliver review at `/dashboard/development/proposals` before applying.

**Still pending (gated on smoke):**
- **`USE_THOMPSON_ROUTER=true`** — explicitly gated on Oliver eyeballing prod render with the new retrieval. Adds exploration so the system doesn't lock onto recipe monoculture. Vercel env flag flip; instant rollback.

**Manual smoke when convenient:** trigger one render on listingelevate.com (any property), then look at the scene table: ≥5 different `camera_movement` values across 10-12 scenes, no single motion repeated >3 times. Vercel function logs should show "Per-photo retrieval: N/12 photos got retrieval blocks (R recipes, E exemplars, L losers)" — confirms the new code path fired. If a DA.3 override fires (warn log "DA.3 override: scene N picked X but ..."), the scene's prompt text should contain the replacement motion verb.

---

**2026-05-11: Blog editor fix + templates + AI generation on `feat/blog-templates-ai`.** Spec at [`specs/2026-05-11-blog-templates-ai-design.md`](./specs/2026-05-11-blog-templates-ai-design.md), plan at [`plans/2026-05-11-blog-templates-ai-plan.md`](./plans/2026-05-11-blog-templates-ai-plan.md).

Three pieces shipped together:

1. **PostEditor — Source-mode toggle.** New `{ }` button on the toolbar flips between Tiptap WYSIWYG and a raw HTML textarea over the same `body_html` state. Round-trippable. Also added Tiptap underline + text-align + table extensions (with toolbar buttons including a 3×3 table insert) and bumped the editor min-height to 500px. Posts created from a template or from AI default to Source mode so you see exactly the HTML that landed.

2. **Templates.** New `/dashboard/blog/templates` page lists named HTML templates with sandboxed-iframe previews. "+ New template" form supports paste HTML or **Upload .html file** (≤1MB). On the compose page, a `Start from template…` dropdown appears at the top — picking one pre-fills the body and flips to Source mode. Migration 051 adds the `blog_templates` table (`id, site_id, name, description, body_html, active, metadata`) + a partial index on `(site_id, active=true)`.

3. **AI generation (Claude Sonnet 4.6).** "**✨ Generate with AI**" button next to the template picker. Modal asks for an optional template + prompt + length (short/standard/long) + tone (professional/casual/data-driven) → calls `POST /api/blog/ai/draft` → Anthropic SDK with a brand-voice system prompt (Helgemo Team / Punta Gorda / soft CTA at end) → returns clean HTML with `<script>`/`<iframe>`/`<style>`/event-handlers stripped server-side. Side-by-side preview before Accept. Cost ~$0.015–0.025 per draft, written to `cost_events` (stage `blog_ai_draft`, provider `anthropic`).

**TopNav "Blog" dropdown** now has 3 items: Posts · Image library · **Templates**.

**Required env:** `ANTHROPIC_API_KEY` must be set in Vercel (all 3 tiers) — confirmed live by Oliver before this push.

**Open follow-up before merging to main:** apply migration 051 via Supabase MCP or dashboard SQL editor. Non-breaking (additive only); UI without it shows an empty templates list and the AI flow still works since templates are optional.

**Phase recap to date:** Phase 1 (Sierra publish), Phase 2 (image library + auto-match), Phase 5 (portal UI), Phase 5b (editor + templates + AI). Phase 3 (daily auto-research) and Phase 4 (cron-driven Claude drafting) deferred — the manual "Generate with AI" button covers ~80% of Phase 4's user value already.

---

**2026-05-10: Blog Engine Phase 5 portal UI shipped on `feat/blog-phase-5`.** Spec at [`specs/2026-05-10-blog-engine-phase-5-design.md`](./specs/2026-05-10-blog-engine-phase-5-design.md), plan at [`plans/2026-05-10-blog-engine-phase-5-plan.md`](./plans/2026-05-10-blog-engine-phase-5-plan.md).

- **Three new dashboard pages live under `/dashboard/blog/*`:** Posts list (filter by state + search + paginated table), Post Detail (compose / edit-manual / review-auto / edit-live modes — buttons swap based on state and `metadata.authored`), Image Library (grid + tag chip filter + caption search + drag-drop upload with inline Gemini vision tagging + retag dialog + soft-delete).
- **Manual authoring is first-class.** Posts list has a "+ New Post" button → compose form → choose "Save as Draft" (state=awaiting_approval) or "Publish Now" (state=publish_due, enqueues publish job immediately). Goes to Sierra via the same Phase 1 publisher with the picked image attached.
- **Auto-pipeline review path is ready for Phase 3+4.** Drafts that land in `awaiting_approval` with `metadata.authored='auto'` show Approve & Publish / Reject buttons in the Post Detail page.
- **Edit-live round-trip:** changing a live post and clicking "Save & Update Sierra" diffs against `post.*`, enqueues an edit job with `fields_changed`, Phase 1's edit publisher round-trips to Sierra.
- **APIs:** `GET/POST /api/blog/posts`, `GET/PATCH /api/blog/posts/[id]`, `POST .../publish | .../reject | .../edit-on-sierra`, `GET/POST /api/blog/images` (multipart upload via `busboy`, inline vision tag with Gemini 2.5 Flash so users see tags immediately), `PATCH/DELETE /api/blog/images/[id]`. All gated via `requireAdmin` from `lib/auth.ts`.
- **Stack additions:** Tiptap (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-image`) for the rich text editor; `busboy` for multipart parsing. Storage: Supabase Storage `blog-images` bucket (already from Phase 2).
- **Migration 050** adds `blog_posts.metadata jsonb` + `blog_posts.active boolean` columns + a partial index on `active=true`. Required for the list page filter and the manual/auto `authored` flag.

**Open follow-ups before promoting `feat/blog-phase-5 → main`:**
1. Apply migration 050 (via Supabase MCP or dashboard SQL editor).
2. Local smoke: `npm run dev`, sign in, walk through Compose → Publish Now and Image Library upload.
3. PR feat/blog-phase-5 → dev → staging → main.

**Next phase candidates** (pick after Phase 5 ships): Phase 3 (daily Gemini research → 3 topic suggestions), Phase 4 (Claude drafts with style-rule injection), Phase 6 (corrections + learning loop).

---

**2026-05-07: Blog Engine Phase 1 + Phase 2 shipped + verified end-to-end.** Full design at [`specs/2026-05-06-blog-engine-design.md`](./specs/2026-05-06-blog-engine-design.md) (master) and [`specs/2026-05-07-blog-engine-phase-2-design.md`](./specs/2026-05-07-blog-engine-phase-2-design.md) (Phase 2). Plans at [`plans/2026-05-06-blog-engine-phase-1-plan.md`](./plans/2026-05-06-blog-engine-phase-1-plan.md) and [`plans/2026-05-07-blog-engine-phase-2-plan.md`](./plans/2026-05-07-blog-engine-phase-2-plan.md).

- **Phase 1 — Sierra publish pipeline LIVE.** `lib/blog-engine/` module + Browserbase persistent context per site + label-based DOM helpers + TinyMCE setContent + 3-field Sierra login (site name + username + password). Migrations 048 + 048a applied. Smoke verified: hand-written posts publish to `client2.sierrainteractivedev.com/blog-manager.aspx` (`post_state=live`, `external_post_url` captured) and round-trip edits land in place. Cost tracking via existing `cost_events` (`blog_publish_browser` stage, provider `browserbase`).
- **Phase 2 — Image library + auto-match LIVE.** Migrations 049 + 049a + 049b + 049c applied. Supabase Storage `blog-images` bucket. `image-tagging.ts` (Gemini 2.5 Flash vision + 768-dim `gemini-embedding-2`) + `image_tag` and `image_match` job handlers + DB trigger that auto-enqueues `image_match` when a post enters `draft_ready`. Smoke verified: 71 images ingested from Helgemo Drive folder via gdown, all 71 vision-tagged + embedded + cost-tracked (zero failures), draft post auto-matched to a relevant interior shot via cosine + 14-day soft-block, then published to Sierra with the matched image attached.
- **Storage decision:** chose Supabase Storage over Vercel Blob (master spec §3.1 override). Reuses existing client + cheaper per GB. Documented in Phase 2 spec §1.
- **Tag distribution across the 71 ingested images:** exterior 37, lifestyle 35, area 34, interior 24, seasonal_summer 20, team 19, aerial 6.
- **Both phases delivered via the standard subagent flow:** brainstorm → write-plan → TDD → smoke iteration. Phase 1 had 18 tasks + 3 smoke-fix commits; Phase 2 had 11 tasks + smoke-fix migration 049c (image_tag enum value).

**Next session — pick one:**
- Phase 3: daily Gemini research → 3 topic suggestions per day (master spec §7).
- Phase 4: Claude Sonnet draft generation with style-rules injection (master spec §6).
- Phase 5: `/dashboard/blog` portal UI for review + image-library management.
- Or pivot back to product-gap path B (order-form persistence, voiceover/music wiring) per the prior 2026-05-06 PM handoff.

---

**2026-05-06 PM: judge calibration program PAUSED after 3 failed lever attempts. Cost-fix + harness improvements promoted; product focus shifts.** Full session notes: [`sessions/2026-05-06-judge-calibration-v1.4-pro.md`](./sessions/2026-05-06-judge-calibration-v1.4-pro.md) (AM) and [`sessions/2026-05-06-pm-judge-calibration-v1.5-fewshot.md`](./sessions/2026-05-06-pm-judge-calibration-v1.5-fewshot.md) (PM).

**Lever scoreboard (best Pearson achieved: +0.048; threshold to ship: +0.30):**

| Variant | n | Pearson | Verdict |
|---|---:|---:|---|
| v1.1 baseline (Flash, zero-shot) | 150 | −0.103 | constant-output ~4.21 |
| v1.3-anchored (Flash, prompt-tuning) | 189 | −0.150 | regression |
| v1.4-pro (Pro, model swap) | 31 | +0.048 | direction flip; trivial |
| v1.5-fewshot down-only (Flash, 38 ex) | 25 | −0.066 | unlocked 1-2★ but global down-shift |
| v1.5-fewshot-balanced (38 down + 18 up) | 24 | −0.452 | regression — up-corrections noisy |
| v1.6-minaxes-fewshot (TS aggregation) | 25 | −0.271 | per-axis output also miscalibrated |

**Four failed lever attempts. Same constant-output disease persists across prompt × model × few-shot × TS-aggregation variants.** Path A (minimal-judge with TS aggregation) tested 2026-05-06 PM and confirmed the per-axis output is also miscalibrated — judge gave human=5★ clips motion ratings of 2 routinely. **Calibration program is closed.** Re-opening would require path C (different evaluator architecture: fine-tune, Sonnet vision, or multi-stage flag-only classifier).

- **Standing cost-tracking bug FIXED + 249 missed rows backfilled** (AM session). `recordCostEvent.propertyId` now accepts null; three Lab callsites updated. Live in prod.
- **Durable harness improvements** (AM + PM): `judgeVersionFor(model)`, `geminiCostCents(model)`, harness auto-loads `loadCalibrationFewShot` per call (mirrors prod cron), `--no-fewshot` + `--tag <s>` CLI flags for separable A/B buckets. Useful regardless of which calibration approach we eventually pick up.
- **Judge stays paused** — `JUDGE_ENABLED=false` + `system_flags.judge_cron_paused=true`.
- **Calibration data in prod** (judge paused so no behavior change): 38 down-correction + 18 up-correction rows in `judge_calibration_examples`. The 18 up-corrections are noisy (some rows are accurate judge calls on clips Oliver rated leniently for non-motion reasons) — do not rely on them without manual review.
- **SDK telemetry caveat:** `@google/genai` reports `promptTokenCount=0` for video inputs, so per-row `cost_cents` hits 1¢ Math.ceil floor. Real spend is higher; reconcile against Google Cloud invoice.

**Next session — pivot to product gaps (path B).** Path A tested + failed. Per the documented gaps in memory:
- Voiceover + voice clone — charged but no code paths
- Brokerage logo + brand colors — captured in `user_profiles`, never rendered
- Music — not captured on form, not in pipeline (videos would be silent)
- Duration enforcement — 15/30/60s priced but director plans ~12 scenes regardless
- Order-form persistence — `selected_package`, `selected_duration`, `selected_orientation`, `days_on_market`, `sold_price`, `add_voiceover`, `add_voice_clone`, `add_custom_request`, `custom_request_text` captured in React state but never persisted to DB

Pick highest-ROI gap (probably order-form persistence — unblocks downstream data) and start there. Path C (different evaluator architecture) deferred indefinitely.

---

**2026-05-05: Consolidation overhaul shipped — repo renamed, 3-tier deploy live, governance system installed.**

Phase summary (full spec at [`specs/2026-05-05-listing-elevate-consolidation-design.md`](./specs/2026-05-05-listing-elevate-consolidation-design.md)):

- **Repo renamed:** `theolivercollins/reelready` → `theolivercollins/listing-elevate`. Local: `~/real-estate-pipeline` → `~/listing-elevate`. Vercel project was already `listingelevate`. GitHub keeps the redirect from old URL.
- **3-tier deployment live:** `dev` and `staging` long-lived branches off `main`. URLs: `listingelevate-git-{dev,staging}-recasi.vercel.app`. Promotion path: `feat/* → dev → staging → main`, every step via PR + `git merge --no-ff`. Crons fire on production only.
- **Cost decision:** skipped a separate staging Supabase ($120/yr saved). All 3 envs share prod Supabase. App-layer isolation via `VERCEL_ENV === 'production'` checks at every destructive write path — convention to enforce in code reviews going forward.
- **Cleanup:** branches 24→3 local, 14→3 remote. Worktrees 16→1. Sister folders (`real-estate-pipeline-{ui,finances}`) gone (they were git worktrees, not separate repos). 14 stale doc files archived under `docs/archive/superseded-docs/`. 10 `archive/*` tags created as a lossless safety net before any branch deletion.
- **Governance installed:** `CLAUDE.md` at root (auto-loaded each session). `.claude/settings.json` hooks: SessionStart (orientation), PreToolUse on `git push` (blocks main pushes that didn't update HANDOFF.md), Stop (turn-end uncommitted-work warning). `pnpm run doctor` (`scripts/doctor.ts`) surfaces stale worktrees, merged-but-undeleted branches, doc rot, inactive feature branches. `/le-status` slash command bundles doctor + git status + commit log + lineage in one shot.
- **File-revert ghost (2026-04-13 incident):** confirmed gone. Phase 0 canary held; full folder rename completed without incident.
- **Open follow-ups:** First trip through promotion path = THIS work going `chore/consolidation-2026-05-05 → dev → staging → main`. Phase 6 (delete unreferenced `lib/providers/{higgsfield,runway,luma}.ts` after grep audit) deferred — pick up next session.

---

**2026-04-28: Ledger-driven system update + lab cost-tracking bug fix shipped to main (commit `cd242fc`).** Triggered after Oliver flagged "prompts aren't improving from my ratings". Investigation (full trail in [`sessions/2026-04-28-lab-cost-tracking-fix.md`](./sessions/2026-04-28-lab-cost-tracking-fix.md)) confirmed the rating loop *is* working post-fix `140c8f4`, but the latent ledger had never been crystallized into hard rules and a bigger bug was masking all lab cost telemetry.

- **Pending proposal `c0708a98-…`** — mined 196 rated iterations across 23 buckets into 6 concrete `DIRECTOR_SYSTEM` patches. Review at `/dashboard/development/proposals` and promote what looks right; promoted patches mutate the production director on the next render via `resolveProductionPrompt`.
- **Recipe pool 84 → 115** — backfilled 27 winners (4★+) that pre-dated the auto-promote logic. Pure DB op via `scripts/oneoff/backfill-recipes.ts`.
- **Thompson router 0 → 41 arms** — `router_bucket_stats` was empty, so SKU choice was always falling through to default. `npx tsx scripts/refresh-router-bucket-stats.ts --write` populated α/β posteriors from the rated ledger; router now starts steering SKU choice toward proven cells.
- **Cost-tracking bug fixed** (migration 045 + commit `cd242fc`). `cost_events.property_id` was `NOT NULL` with FK to `properties.id`, but every Lab cost-event insert (mine, embedding, recipe promote, listing director, listing chat, lab generation) sent `property_id: null` inside a `try/catch`. Two-layer mask: Supabase JS returns `{error}` rather than throwing (catch never fired) + the unused `console.error` had no audience. Audit before fix: 378 lab iterations created in 30d, only 17 lab-stage `cost_events` rows. Dropped the NOT NULL constraint + replaced every try/catch with explicit `{error: costErr}` checks at 10 insert sites. Today's $0.31 rule-mining cost backfilled. Going forward, every lab API call writes a cost row.
- **P2 Gemini auto-judge** is fully wired on main and dormant by design. Two-gate kill-switch: `JUDGE_ENABLED !== "true"` env var (poll-judge.ts:23) + `system_flags.judge_cron_paused = true` (DB row, paused 2026-04-24 by operator). Stays off until Oliver finishes manual rating runway.
- **One-off scripts** (kept under `scripts/oneoff/`): `run-mine-now.ts` (replicates `mine.ts` handler with service-role + streaming + 32k max_tokens — 8k cap truncated the response on 196 ratings × 23 buckets) and `backfill-recipes.ts` (reusable for future winner backfills).

---

**2026-04-24 (later): Iteration order-id system shipped (migration 041).** Every Lab iteration — past and future — now has a human-readable order number of the form `V{n}-{seq:05}`.

- **Scheme (durable convention):** V1 = `prompt_lab_iterations` (268 rows backfilled V1-00001..V1-00268), V2 = `prompt_lab_listing_scene_iterations` (98 rows backfilled V2-00001..V2-00098). V3+ reserved for future lab surfaces; add a new sequence + trigger when a new table is introduced.
- **Enforcement:** `order_id text NOT NULL UNIQUE` on each table; `BEFORE INSERT` trigger pulls the next value from `v{n}_iteration_seq` so application code cannot forget. Insert test confirmed: omitting `order_id` from an insert auto-assigns `V1-00269`.
- **Surfaced in UI:** Rating Ledger card shows the order_id under the SKU chip; PromptLab iteration card shows it next to "Iteration N". Ledger API adds `order_id` field to `LedgerRow` (null on prod surface — prod scene_ratings do not use the scheme).

**2026-04-24: Rating Ledger "atlas" SKU-leak fix merged to main (commit `4d868bd`).** `fetchLegacyLab` in `api/admin/rating-ledger.ts` was surfacing the Atlas provider name in the SKU slot whenever model_used was populated — the SELECT never pulled the column. Fix: new shared `lib/ledger/formatSku.ts` formatter (single source of truth for how ledger rows derive SKU), routed through every surface; local `providerToSku` deleted. Migration 040 applied to prod adds `CHECK (clip_url IS NULL OR model_used IS NOT NULL OR sku_source = 'unknown')` on `prompt_lab_iterations` — any future write path that marks a render complete without a SKU is rejected with `check_violation` at the DB layer. 146 pre-P1 rows grandfathered via `sku_source='unknown'`. Verified with synthetic negative-test insert + legacy-row UPDATE + full test suite (141 + 8 new = 149 green).

**2026-04-23 session shipped P2 Session 2 + P3 Session 1 retrieval-fusion completion.** Judge chip + Override panel live in IterationCard. Rating Ledger now shows human vs judge side-by-side with agreement color coding. Retrieval RPCs fuse text + image embeddings at 0.4/0.6 default weights. Audit on 5 queries showed **48% top-5 exemplar turnover** and rating-average improvements on 2/5 queries — the fusion is doing real work. Provider dropdown UX simplified (Advanced ▸ collapse).

**Cumulative across 2026-04-22 + 2026-04-23:** P1 Foundation, P2 S1+S2 (judge wired + UI + calibration loop), P3 S1 full (embeddings backfilled + retrieval fused), P5 dry-run wired. Live at www.listingelevate.com.

**What's live:**
- **V1 Prompt Lab** is the daily-driver iteration surface. Atlas routing, `kling-v2-6-pro` default, per-iteration SKU selector + corrected cost chip (~$0.36–$1.11/clip) + "Try another SKU" shortcut. TopNav renamed; Listings Lab hidden from nav but direct URLs preserved.
- **Gemini auto-judge is LIVE (`JUDGE_ENABLED=true` on Vercel prod).** Every new Lab render that finalizes triggers a fire-and-forget `judgeLabIteration` call (gemini-2.5-flash, ~21s latency, ~2¢/clip) that watches the clip + source photo and writes a structured 5-axis rubric (motion_faithfulness, geometry_coherence, room_consistency, hallucination_flags, confidence + overall) to `prompt_lab_iterations.judge_rating_json`. Verified end-to-end 2026-04-22 on iteration `1aecff42` — judge correctly caught "too slow push-in, missed curve left" as a motion defect (overall 4, motion_faithfulness 2, flags: `too_slow` + `other_motion_defect`).
- **Thompson router is ARMED BUT OFF (`USE_THOMPSON_ROUTER` unset).** Math kernel + migration 038 + `resolveDecisionAsync` + `router_shadow_log` inserts on every render all live. With the flag off, every render silently logs `{ sku, reason: "flag_off" }` alongside `{ static_sku }` — dry-run data accumulating for the P5 Session 2 (2026-04-30) A/B audit. Flipping `USE_THOMPSON_ROUTER=true` activates auto-routing (but there's <3 trials per bucket today, so it'd fall back to static for all buckets anyway).
- **Image embeddings backfilled + fused into retrieval.** 95 images (42 photos + 53 sessions) have `gemini-embedding-2` 768-dim vectors. Migration 035 updated `match_rated_examples` / `match_loser_examples` / `match_lab_recipes` to accept optional `query_image_embedding` + `text_weight`/`image_weight` (0.4/0.6 defaults, env-overridable via `IMAGE_EMBEDDING_TEXT_WEIGHT`/`IMAGE_EMBEDDING_IMAGE_WEIGHT`). Callers in `lib/prompt-lab.ts` + `lib/judge/neighbors.ts` now load the query session's image embedding and pass it. Listing branch stays text-only (no photo_id linkage on listing_scenes — P3 S2 task). Audit `docs/audits/retrieval-fusion-2026-04-23.md` verdict: "Image fusion IS surfacing different exemplars."
- **Judge chip + Override panel in IterationCard.** Every iteration with `judge_rating_overall` populated shows "🔍 Judge 4/5 · Motion 2 · Geom 5 · Room 5 · ⚠ flags · conf 5 [Override]" as a muted row. Override opens inline panel (sliders + flag checkboxes + reasoning/correction textareas, pre-filled from current judge output) that writes a `judge_calibration_examples` row. Next judge call in that same (room × movement) bucket loads up to 10 recent overrides as few-shot context — closes the calibration loop.
- **Rating Ledger side-by-side.** `/dashboard/rating-ledger` has a new Judge column with delta-based color coding (grey ≤1, amber 2, red ≥3) + "Show only disagreements" filter. Useful for spotting where the judge needs calibration.
- **Provider dropdown simplified.** Daily Lab view now shows SKU + cost only; Kling-native / Runway escape hatches hidden behind an "Advanced ▸" toggle.

**Migrations applied via Supabase MCP (all in prod):** 031 (SKU capture), 032 (cost_events provider widen), 033 (judge columns + calibration_examples table), 034 (image_embedding + HNSW), 035 (retrieval RPCs with image-fusion), 038 (router_bucket_stats + router_shadow_log), 040 (SKU-required-at-finalize CHECK), 041 (iteration order_id + per-version sequences + trigger).

**Pre-cooked design branches (FINAL, integrated into shipped code today; branches preserved for reference):**
- `session/p2-rubric-design` — judge rubric (7 Qs resolved)
- `session/p3-embedding-preflight` — embedding provider decision (5 Qs resolved)
- `session/p5-thompson-design` — Thompson design (6 Qs resolved)

**What's NOT done yet (scheduled):**
- P3 Session 2 (2026-04-26): hybrid retrieval (dense + BM25 sparse + image, 3-way fused) + RetrievalPanel UI with match-percentage
- P3 Session 3 (2026-04-27): cross-encoder reranker pass on top of hybrid
- P4 (2026-04-28 → 29): scale hardening (per-photo Gemini enrichment on legacy, MMR diversity, hallucination-risk propagation)
- P5 Session 2 (2026-04-30 → 05-01): flip `USE_THOMPSON_ROUTER=true`, A/B audit, prod rollout decision
- P6 (2026-05-02): active learning + pairwise UX
- P7 (ongoing ~2026-05-05): promote-to-prod runbook

**Known carry-overs:**
- Pre-existing `/api/cron/poll-listing-iterations` error firing every minute for 48h+ (unrelated to any 2026-04-22 work; standing bug worth investigating).
- JUDGE_MODEL env can override `gemini-2.5-flash` back to `gemini-3-flash-preview` if that tier opens up.
- Full V1 smoke render (P1 Task 12) not explicitly run — judge verification on iteration 1aecff42 exercised the full pipeline path downstream of clip delivery, which is equivalent.

## Plan state

Phases of the back-on-track plan (full spec at [`specs/2026-04-20-back-on-track-design.md`](./specs/2026-04-20-back-on-track-design.md)):

| Phase | Status | What |
|---|---|---|
| A — Lab UX spine | shipped | `NextActionBanner`, priority chips, optimistic updates |
| M.1 — Director-prompt trace audit | shipped | Learning loop verified working-with-gaps; full audit at [`audits/ML-AUDIT-2026-04-20.md`](./audits/ML-AUDIT-2026-04-20.md) |
| DQ — Director concise prompts | shipped | `DIRECTOR_SYSTEM` enforces ≤120/≤250 char prompts, stability prefix `kling-v3-*`-only, paired auto-route to `kling-v2-1-pair`, default model flipped to `kling-v2-6-pro` |
| DM — Dev/Legacy merge | shipped | One unified Lab UI, native Kling provider added (Oliver's pre-paid credits), Compare demoted, legacy Lab routes retired |
| CI — Cost integrity | shipped (CI.1–CI.5) | Model-aware Claude pricing, OpenAI embedding tracking, Shotstack per-minute, failed-render policy, dashboard drill-down |
| C — Production end-to-end | shipped | Router `ProviderDecision`, base64 → URL, duration-aware director, lazy failover Kling → Atlas |
| M.2 — ML consolidation | ✅ shipped | SKU capture, dead code removal, prod embedding backfill |
| B — Model head-to-head | superseded by 2026-04-22 V1 program | Phase B static-router approach replaced by P5 Thompson sampling (docs/specs/p5-thompson-router-design.md). Existing Window D Round 1/2 work parked on `session/router-2026-04-21`; v3-strip intent migrated into `V1_ATLAS_SKUS` allow-list. No fresh manual rating grid required — P5 bootstraps from organic V1 ratings |
| **P1 — V1 Foundation** | ✅ shipped (2026-04-22) | V1 Lab becomes daily driver: Atlas routing (kling-v2-6-pro default), SKU capture (migration 031), cost_events widened (migration 032), SKU selector + cost chip + try-another-SKU UI, TopNav rename, V1 trace mode, deferred UX plan |
| **P2 — Gemini auto-judge (S1)** | ✅ shipped (2026-04-22) | Migration 033 applied; gemini-judge.ts binding live on gemini-2.5-flash; finalize-with-judge endpoint + fire-and-forget hook in finalizeLabRender; JUDGE_ENABLED=true in Vercel prod. Live test on iter 1aecff42 returned overall=4 with correct too_slow flag. S2 (UI chip + Override button) scheduled 2026-04-23 |
| **P3 — Retrieval upgrade (S1)** | ✅ shipped (2026-04-22) | Migration 034 applied; embeddings-image.ts binding live; 95 images backfilled (42 photos + 53 sessions, 100% coverage, $0.01). S2 hybrid retrieval + reranker + RetrievalPanel UI scheduled 2026-04-26–27 |
| P4 — Scale hardening | per spec | Scheduled 2026-04-28–29 (2 sessions) |
| **P5 — Thompson router (S1 dry-run)** | ✅ shipped (2026-04-22, flag off) | Migration 038 applied; resolveDecisionAsync + pickArm wired behind USE_THOMPSON_ROUTER env flag (default off); router_shadow_log writes on every render capturing Thompson-vs-static decisions. S2 A/B audit + flag-flip scheduled 2026-04-30–05-01 |
| P6 — Active learning + pairwise | per spec | Scheduled 2026-05-02 |
| P7 — Promote-to-prod flywheel | per spec | Ongoing runbook; activates ~2026-05-05 |

## Recent shipping log

(Newest on top. Append one line per push to `main`.)

- 2026-05-21 — `<SHA-TBD>` — `fix(studio/preview)` after yesterday's routing fix unblocked the studio dynamic-API rewrites, prod logs surfaced two follow-on import bugs that were 500ing for every studio preview-link generate + every public preview-token page load. (1) `api/admin/studio/properties/[id]/scenes/[idx]/swap-clip.ts` is at filesystem depth 7 but its imports used 6 dotdots — Vercel ESM resolver landed at `/var/task/api/lib/auth.js` (`ERR_MODULE_NOT_FOUND`) instead of repo-root `/var/task/lib/auth.js`. Bumped to 7 dotdots on both `auth.js` and `operator-studio/clip-swap.js` imports. (2) `lib/operator-studio/preview.ts` line 2 and `api/preview/[token].ts` lines 2-3 imported `./preview-tokens` and `./preview` without the `.js` extension — Node 24 ESM in the Vercel function runtime requires explicit extensions on relative specifiers, so both modules threw `ERR_MODULE_NOT_FOUND` at first request. Added `.js` to all three import specifiers. No other relative-import-without-.js found in `api/` or `lib/operator-studio/`. Diagnosed via `vercel logs --since 25h -q "4ac9717e" --expand` against the live deployment — both errors visible on 16:26:53 and 16:27:47 calls. 3 files, 5 lines changed.
- 2026-05-20 — `<SHA-TBD>` — `fix(vercel/routes)` Generate-preview-link on Studio Property Command Center was 404ing — same root cause as the 2026-05-14 blog 404s. `vercel.json` uses explicit `routes` (not filesystem-based dynamic resolution), so every dynamic API path needs an explicit rewrite. The operator-studio + bulk-actions PRs shipped 7 new dynamic paths without updating `vercel.json`: `/api/properties/[id]/{archive,resume-checkout}`, `/api/admin/studio/clients/[id]`, `/api/admin/studio/properties/[id]`, `/api/admin/studio/properties/[id]/{notes,preview-link}`, `/api/admin/studio/properties/[id]/scenes/[idx]/swap-clip`. All were returning `NOT_FOUND` from the Vercel edge. Added the 7 missing rewrites in correct most-specific-first order (so `…/preview-link` matches before the bare `…/properties/[id]`).
- 2026-05-20 — `<SHA-TBD>` — `feat(studio)` reaches parity with the customer Upload flow. **Root cause of "[object Object]" on Send to pipeline:** `manualIngest` was throwing the bare `PostgrestError` object from a failed `properties` insert; that object is NOT a JS Error instance, so the endpoint's `err instanceof Error ? err.message : String(err)` fell to `String(err)` → literal `"[object Object]"`. Underlying insert failure was that `properties.listing_agent` is NOT NULL in prod and `manualIngest` never set it — customer-flow `api/properties` always passes `listing_agent` and validates `if (!listing_agent) return 400`. **Fix in `lib/operator-studio/ingest.ts`:** new `stringifyDbError(err)` helper extracts `.message + .details + .hint + .code` from PostgrestError-shaped objects; all throws now wrap with `new Error(\`stage failed: ${stringifyDbError(err)}\`)`. Also pulls `agent_name` + `name` from the client record when one is picked (fallback chain: explicit form → `client.agent_name` → `'Operator'`), sets `brokerage` from `client.name`, requires `submitted_by` (now passed from `requireAdmin`'s `auth.user.id` in the endpoint), and defaults `selected_package='just_listed'`, `selected_duration=30`, `selected_orientation='horizontal'` so the pipeline picks a real Creatomate template. **Studio form (`src/pages/dashboard/studio/StudioNew.tsx`):** wired the existing `<AddressAutocomplete>` (Google Places, US, lazy-loads SDK) over the address input + adds a "Lookup MLS" button next to it that calls the same `lookupMls()` Apify/Redfin chain the customer Upload uses (auto-fills beds/baths/sqft/price). Price + square-footage inputs converted from `type="number"` to comma-formatted (`type="text" inputMode="numeric"`, raw-digits state + `formatNumber()` display) — same pattern now applied to the customer Upload's List price / Sold price / Square feet inputs and the order-summary "{sqft} sqft" line. **New shared formatter:** `src/lib/format.ts` exports `formatNumber`, `formatUsd`, `formatCents`, `digitsOnly`, `formatNumericInput`. Finances "units used / units bought" displays converted from `.toFixed(0)` to `Math.round(n).toLocaleString()`. Upload's order-summary `${totalPrice}` now uses `.toLocaleString()`. **Tests:** `lib/operator-studio/__tests__/ingest.test.ts` adds 3 new cases (PostgrestError stringification, listing_agent fallback to "Operator", submitted_by passthrough); full operator-studio suite 42/42 green.
- 2026-05-20 PM — `<SHA-TBD>` — `fix(prompt-lab)` merged the IterationCard's two textareas into one Feedback box. Background: the V1 Prompt Lab card had a "Notes (optional)" textarea (→ `prompt_lab_iterations.user_comment` via Save rating) and a separate "What should change?" textarea (→ `refinement_instruction` via Refine → new iteration). Operators were typing rationale into the wrong box — DB audit of today's V1-00455..00461 showed V1-00458 with `user_comment=NULL` but `refinement_instruction="its kinda shaky"` (the rationale landed under refinement, not the rating ledger). Recipe promotion was unaffected because `autoPromoteIfWinning` only checks `rating >= 4`. **Fix in `src/pages/dashboard/PromptLab.tsx:2134` (state) + 2635–2680 (UI):** dropped the `chat` state, single `comment` state now drives both flows. UI shows ONE "Feedback (optional)" textarea with two buttons: **Save** (writes `user_comment`, no new iteration) and **Save and refine** (writes `user_comment` AND fires `/api/admin/prompt-lab/refine` with the same text as `chat_instruction` → creates a refined iteration). Server endpoints unchanged — both already accept `comment` and the refine endpoint already persists it via `user_comment` on the source row. tsc + vite build clean.
- 2026-05-20 — `<SHA-TBD>` — `feat(studio)` reaches parity with the customer Upload flow.
- 2026-05-20 — `<SHA-TBD>` — `feat(studio/new)` client is now optional on the Operator Studio new-listing form. `ClientPicker` flipped to `includeNone={true}`, `isValid` and step indicator no longer gate on `clientId`, "Client required" branch removed from the validation hint, helper copy added ("Leave blank for personal / no-client renders. Brand-kit injection is skipped when there's no client."). Backend was already null-safe — `client_id` column is nullable with `ON DELETE SET NULL`, brand-kit injection in `lib/pipeline.ts` guards on `properties.client_id`. Single file changed (`src/pages/dashboard/studio/StudioNew.tsx`, +12/-11). tsc + vite build clean. Earlier in the same session, a stale `feat/operator-studio` branch was investigated and discarded — virtually every feature on it (Maps autocomplete, MLS lookup via RentCast, voiceover toggles) had already shipped to main in different form (Apify/Redfin MLS chain, ElevenLabs voiceover pipeline, `feat(order-form)` Maps autocomplete on the customer Upload page).
- 2026-05-18 — `<SHA-TBD>` — `fix(pipeline)` rerun idempotency + Lab-parity routing + Luma removal. Root cause of the 13fe5a96 rerun looking duplicated/lower-quality: `/api/pipeline/[propertyId]` had no idempotency guard, so a duplicate Re-run POST (browser retry / double-click / second tab) launched two parallel `runPipeline()` invocations. Evidence in DB: 8 scenes inserted (scene_numbers 1,1,2,2,3,3,4,4 with different prompts in each pair), pipeline_logs show every stage doubled, 16 provider submissions for 4 logical scenes, storage uploads racing on `scene_<n>_v1.mp4`. **Fix**: new `lib/pipeline-claim.ts` exports `tryClaimPipelineRun(supabase, propertyId)` which atomically transitions `status='queued'|'failed'|'needs_review' → 'analyzing'` (and stamps `pipeline_started_at`) in a single `UPDATE … WHERE id=? AND status IN (...)`; `runPipeline()` calls it at entry and bails on a non-match — second concurrent caller logs "Pipeline already in flight" and returns. **Lab-parity routing**: `lib/providers/router.ts` `resolveMovementDecision` now picks Atlas `kling-v2-6-pro` (= `V1_DEFAULT_SKU`) for ALL movements including drone, with Runway-for-drone / native-Kling-for-interior as failover only — closes the quality gap between Prompt Lab iterations and customer renders. **Luma permanently removed**: deleted `lib/providers/luma.ts`, scrubbed `"luma"` from `VideoProvider` enum in `lib/types.ts` + the `cost_events` provider TS union in `lib/db.ts` + frontend `src/lib/types.ts` (3 spots) + `lib/ledger/formatSku.ts` mapping + the corresponding test + dashboard provider lists in Finances/Overview/Settings/sample-data + STACK.md (LUMA_API_KEY env entry deleted). Tests: 27 new tests in `lib/providers/router.test.ts` (Lab parity + paired-scene preservation) and `lib/pipeline-claim.test.ts` (CAS semantics). Gemini 2.5 Pro consulted on 3 candidate solutions; Oliver overrode the Luma-for-drone suggestion mid-implementation — kling-v2-6-pro everywhere, no Luma anywhere.
- 2026-05-17 — `<SHA-TBD>` — `fix(studio/clients)` migration `066_clients_relax_sierra_notnull.sql` follow-up to 065. Studio "Create client" was 500ing with `null value in column "sierra_public_base_url" of relation "clients" violates not-null constraint`. The Sierra-era NOT NULLs (sierra_public_base_url, sierra_region_id, sierra_admin_url, sierra_admin_username, sierra_admin_password_encrypted, agent_name, agent_phone, agent_email, created_by) are unused by any code path (grep returns zero readers; planned Sierra onboarding UI was never built). Migration drops NOT NULL on those 9 cols; one existing row untouched. Smoke test (INSERT name+brand_primary_hex+monthly_rate_cents only, wrapped in ROLLBACK) now succeeds. Gemini 2.5 Pro consulted again on 3 options (relax NOT NULL / sentinel values / `is_studio_client` discriminator); picked A.
- 2026-05-17 — `<SHA-TBD>` — `fix(studio/clients)` migration `065_clients_studio_columns.sql` resolves Studio dashboard 500 (`column clients_1.brand_primary_hex does not exist`). Root cause: migration 062 `CREATE TABLE IF NOT EXISTS clients` was a no-op because prod already had a Sierra-integration `clients` table; operator-studio columns never landed. Fix is purely additive — ADD COLUMN IF NOT EXISTS for `brand_primary_hex`, `brand_secondary_hex`, `brand_logo_url`, `monthly_rate_cents`, `agent_headshot_url`, `voice_id`, `contact_email`, `phone`, `notes`, `archived_at`; backfilled `brand_primary_hex` ← `brand_color_primary` and `agent_headshot_url` ← `agent_photo_url` for the 1 existing Sierra row (Helgemo Team). Applied to prod Supabase via Management API; verified PostgREST embed `client:client_id(id,name,brand_primary_hex)` now returns 200. Gemini 2.5 Pro consulted on 3 options (additive ALTER / code-side adaptation / separate `studio_clients` table) and recommended A.
- 2026-05-15 — `<SHA-TBD>` — dashboard polish sweep #2, 5 parallel subagents:
  - `feat(blog)` BlogPostChatCompose + BlogPostDetail + AllyFloatingChat ported to v3 tokens. All 17 Ally functions verified preserved (chat envelope, status indicator, queued messages, persistent memory, source allowlist, Gemini research toggle, suggest-research pill, template picker, file uploads, visible-changes diff, skeleton/shimmer, localStorage persistence, daily starter chips, sidebar form, publish/save header, soft-delete dialog, hold/resume).
  - `feat(dashboard/finances)` Log Purchase reskin (Provider → Amount → Type → Date → Note order, 17-provider list) + NEW recurring **subscriptions** feature. New `subscriptions` table (provider, amount_cents, monthly|yearly, next_charge_at, status), `GET/POST/PATCH/DELETE /api/admin/subscriptions`, cron stub at `/api/cron/post-subscription-charges` (NOT wired to vercel.json), Subscriptions section on Finances with Add/Edit/Pause/Cancel + "Estimated monthly recurring" KPI. **Migration `064_subscriptions.sql` is in the repo but not yet applied to prod Supabase — apply before clicking Add subscription.**
  - `fix(dashboard/account/profile)` removed `maxWidth: 720` cap so Profile spans full container like Settings/Overview. All 7 functions preserved.
  - `feat(dashboard/studio)` 5 pages polished — StudioHome KPIs reworked ("Active orders / Awaiting review / Delivered / Total in queue"), Clients gets live search + avatar bubbles + click-anywhere row nav, ClientEdit has section numbering + dedup'd save buttons, PropertyCommandCenter has distinct per-section eyebrows + breadcrumb, StudioNew has a 3-step progress indicator that auto-advances on field completion.
  - `feat(dashboard/properties)` bulk actions — checkbox column + select-all + sticky pill bar at bottom-center with Re-run / Mark delivered / Archive. Confirmation modal for 2+ items, optimistic UI with rollback on error. New `POST /api/properties/[id]/archive` (soft, status='archived', no cascade). `PATCH /api/properties/[id]/status` extended to accept `delivered`/`archived`.
- 2026-05-15 — `<SHA-TBD>` — dashboard polish sweep, 5 parallel subagents:
  - `fix(dashboard/pipeline)` dropped fake-scene synthesis that caused 404 on Skip for `San Massimo` (was using property UUID as scene id)
  - `fix(api/studio)` added `.js` extensions to all bare lib imports across 9 Operator Studio API files — `/clients/queue` + every other studio endpoint was 500ing on ERR_MODULE_NOT_FOUND
  - `feat(blog)` image picker rebuilt: single unified grid (no tabs), upload tile inline, current selection ring + checkmark, eager-loaded thumbnails with Supabase 240px transforms + skeleton pulse, debounced search + tag-pill filter, click-to-select auto-closes
  - `feat(dashboard/finances)` restored every old-dashboard widget the rebuild had dropped: Revenue/Spend/Net/Cost-per-video KPIs, 30d cashflow chart, token balance by provider, all three entry forms (token purchase / expense / revenue) and ledger tables. Old expense form was silently failing to a non-existent endpoint — now writes to `expenses` via `lib/finances.ts`.
  - `perf(dashboard/promptlab)` `loading="lazy"` on session-card images + `preload="none"` on iteration videos + `useMemo` on batch sort. First-paint network 80 → ~5 requests
  - `feat(dashboard)` invite-user now actually works: `POST /api/admin/invites` calls `supabase.auth.admin.inviteUserByEmail`, both "Invite user" buttons on `/dashboard/users` open a modal, optimistic insert with status="invited". Settings page un-centered (removed `maxWidth:780, margin:0 auto`).
- 2026-05-15 — `<SHA-TBD>` — PR #73 worktree-dashboard-soft-pastel-reskin → main: full dashboard rebuild lands. Soft-pastel × Apple-clean v3 visual system ported to every dashboard page (Overview, Pipeline, Properties, PropertyDetail, Logs, Finances, Settings, Development, PromptLab*, PromptProposals, RatingLedger, KnowledgeMap*, Learning, LabListings, SystemStatus). Shared primitives: DashboardCard, Button, StatusPill, ChipTabs, EmptyState, KpiCard. **Structural**: `/account` moved into the dashboard shell (now `/dashboard/account/{profile,billing,listings}` with backwards-compat redirects); password update on Profile; admin-branched Profile (Security & sessions card replaces Brokerage for admins); Operator Studio merged in as "Video studio" under Ops; sidebar reorg (Studio = Overview/Pipeline/Listings/Users, Ops = Video studio/Blog creator/Finances/Logs/System status/Lab/Settings); sidebar 3-dots opens real menu; Lab sub-nav sticky at top:76px; System Status got Health/Models tabs; Models latency page added. **Data**: Overview leaderboard filters out test uploads (≥2 completed + ≥2 alphanumeric chars), Finances MTD math corrected (calendar-month prefix instead of `slice(-14)`), Avg/video renders "—" when zero. Migrations 062_operator_studio + 063_operator_studio_scenes_followup (renumbered from 056/057 to avoid clash with main's `056_blog_posts_image_id_fk` + `057_ally_memories`) — DDLs already applied to prod Supabase under earlier timestamps. 26-file merge conflict against Ally blog branch resolved: kept main's BlogPostDetail/BlogPostsList (preserves Ally floating chat + persistent memory + source allowlist), hand-merged lib/types.ts/TopNav.tsx/api.ts to union both sides.
- 2026-05-15 — `<SHA-TBD>` — PR #72 feat/voiceover-pipeline → main: customer-facing order flow finally end-to-end. `/upload` rewritten to the glass design (Apple-clean × Noteflow-soft, light theme, white cards on warm gray, sticky right-rail order summary). MLS-by-address auto-fill via `tri_angle/redfin-detail` Apify actor (price/beds/baths/sqft/agent/description from a typed address). 4-voice ElevenLabs voiceover panel (Mark / Jack / Amanda / Jessica) with Compass scrape → Claude script → TTS, voice-swap without full regen. Stripe Checkout bundling voice-clone setup fee (lifted from `feat/elevenlabs-voiceover` via diff, not merge). Bug fixes: `submitted_by` threaded through `POST /api/properties`, Brokerage step-2 field, `splitAddress` `lastIndexOf→indexOf`, Vertical "coming soon" gate. Spacing fix: suppressed duplicate `<TopNav>` on `/upload` (it was stacking under page's `<SiteNav>`), tightened paddingTop. Address field switched off shadcn `<Input>` (hard-coded `rounded-none`) to plain `<input className="g-input">`. **Migrations 060 + 061 pending — apply via Supabase MCP before voiceover endpoints are used in prod.**
- 2026-05-17 — `<SHA-TBD>` — `fix(dashboard/property)` restored missing `triggerPipeline` helper in `src/lib/api.ts` — Re-run button on `/dashboard/properties/[id]` was throwing `triggerPipeline is not defined` in the browser. Helper had been removed during the Stripe Checkout merge (`f1b7d0e`) but `rerunProperty` was the last caller and was missed. The rerun reset endpoint deliberately doesn't launch the pipeline itself, so the client still has to POST `/api/pipeline/[id]` after `/api/properties/[id]/rerun` returns.
- 2026-05-17 — `<SHA-TBD>` — PR worktree-owner-payment-bypass → main: owner-bypass for Stripe payment during testing. New `lib/billing/owner-bypass.ts` + `isOwnerBypassEligible({email, role})` — admin role AND email in `LE_OWNER_BYPASS_EMAILS` (comma-separated env). `api/properties/index.ts` short-circuits before `createCheckoutSession`, mirrors the `checkout.session.completed` webhook (status=queued, payment_status=paid, amount_cents=0, voice-clone comp, `runPipeline` fired inline). Response carries `bypassed:true`; `src/lib/api.ts` + `src/pages/Upload.tsx` skip Stripe and route straight to `/upload/success`. Bypassed orders identifiable in SQL via `stripe_session_id IS NULL AND stripe_payment_status='paid'`. 9 new unit tests. **Inert until env var set on prod.**
- 2026-05-14 — `6ec3fbb` — PR worktree-kill-jetbrains-mono → main: killed JetBrains Mono UI font site-wide (Oliver hates it). `--le-font-mono` aliased to Inter sans stack with lockdown comment, `.le-eyebrow`/`.le-mono`/`.le-badge`/`.le-img-placeholder` switched to `--le-font-sans`, Tailwind `fontFamily.mono` retargeted to Inter, JetBrains+Mono dropped from `index.html` + `v2.css` Google Fonts URLs. 47 files, +163/-159. CLAUDE.md ship-gate rule #6 added so future sessions can't reintroduce it.
- 2026-05-14 — `<SHA-TBD>` — PR #46 staging → main: Creatomate Just Listed #01 rev-2 template wired end-to-end — new mapper slot names (`*-Intro` / `*-Mid` / `*-Final`), duration-suffixed env vars (`CREATOMATE_TEMPLATE_ID_<PKG>_<DURATION>[_VERTICAL]`), vertical-aware resolver that skips 9:16 when no vertical template exists. Live smoke produced 1920×1080 / 15s / 30fps with all overlays. Vercel envs: added `CREATOMATE_TEMPLATE_ID_JUST_LISTED_15`, removed legacy `CREATOMATE_TEMPLATE_ID_JUST_LISTED`. 119/119 tests + `tsc` clean.
- 2026-05-13 — `4328d1c` — PR #41 staging → main: order-form persistence (migration 054) + Creatomate buildout (Phase 2-6 + template-mode + cron-assembly wire + migrations 053/055/056) + Shotstack code-defined Just Listed port + ASSEMBLY_PROVIDER override env var. Orders now produce real assembled MP4s end-to-end on listingelevate.com.
- 2026-05-13 — `cd1f25c` — PR #40 dev → staging: same bundle, staging gate
- 2026-05-13 — `a2fcaf3` — PR #38 feat/creatomate-buildout → dev: Phase 2-6 modules (scene-ordering, duration-fit, branding, music) + template-mode (template-modifications, template-resolver, getTemplate, assembleFromTemplate on /v2/renders) + Shotstack Just Listed port (buildShotstackJustListedTimeline, HTML overlays) + ASSEMBLY_PROVIDER router override. 48 vitest cases.
- 2026-05-13 — `cada6c2` — PR #37 feat/order-form-persistence → dev: migration 054 + 5 plumbing touchpoints. Upload form's 9 order-specific fields now persist to properties.
- 2026-05-13 — `326991e` — PR #32 staging → main: prompt-collapse fix + blog trunk to listingelevate.com (per-photo retrieval, DA.3 prompt rewrite, top-K recipe rendering)
- 2026-05-13 — `6eae2ef` — PR #31 dev → staging: prompt-collapse fix + blog trunk
- 2026-05-13 — `1154cb1` — PR #30 feat/prompt-collapse-fix → dev: 8 commits landing the prompt-collapse fix (root-cause spec at `docs/specs/2026-05-13-prompt-collapse-fix-design.md`)
- 2026-05-13 — db — `prompt_revisions` v4 inserted with `source='lab_promotion'` — promotes proposal c0708a98 (Lab-active since 2026-04-30) to prod; `resolveProductionPrompt('director')` now returns the patched body (36,927 chars, hash ac365465)
- 2026-05-13 — db — `lab_prompt_proposals` row `9a0990f0` created (status=pending, 5 evidence-grounded changes; awaiting review at /dashboard/development/proposals)
- 2026-05-06 — `0fd591b` — judge calibration program CLOSED after 4 failed lever attempts (v1.6 minaxes also failed); next session pivots to product gaps
- 2026-05-06 — `6c711e0` — v1.5-fewshot harness auto-loads few-shot + populate scripts
- 2026-05-06 — `7955cda` — v1.4-pro calibration harness + standing cost_events FK fix + 249-row cost backfill
- 2026-04-22 — `ad63c6a` — migration 032: widen cost_events.provider CHECK for atlas/google/higgsfield (unblocks P1 cost-event emission)
- 2026-04-22 — `55491f0` — spec: V1 Prompt Lab UX plan (deferred, synthesized from Task 14 audit)
- 2026-04-22 — `3e9bf1d` — audit: kling v2-master vs v2-6-pro verdict — Validate-day-1
- 2026-04-22 — `15f0ec3` — audit: V1 Prompt Lab UX friction points (6 quick + 5 medium wins)
- 2026-04-22 — `3a56001` — ui(nav) + docs: rename "Prompt Lab (legacy)" → "Prompt Lab"; add MODEL-VERSIONS.md
- 2026-04-22 — `286b697` — feat(p1): V1 backend SKU threading + cost_events (submitLabRender sku param, AtlasProvider ctor arg, render/rerender endpoints, finalizeLabRender cost_events) — 80/80 tests
- 2026-04-22 — `8fcaaf9` — router: relocate V1 SKU constants to atlas.ts (co-located with ATLAS_MODELS)
- 2026-04-22 — `01d907f` — router(v1): SKU-aware resolveDecision + V1_DEFAULT_SKU = kling-v2-6-pro (+ 6 vitest tests)
- 2026-04-22 — `f3682e7` — migration(031): capture SKU + provenance on prompt_lab_iterations
- 2026-04-22 — `4a7f203` — docs(plan): V1 primary tool + ML roadmap spec (P1–P7 program) + P1 implementation plan + 2026-04-22 Window A coordinator handoff
- 2026-04-22 — `9322e55` — docs(sessions): park notes for ledger + router branches (v3-strip disposition noted; intent migrated into V1_ATLAS_SKUS)
- 2026-04-22 — `504e4ce` — docs(closeout): Window B session notes + render log from 2026-04-21
- 2026-04-21 — `d8ee57e` — Round 2 regression-diff HANDOFF/PROJECT-STATE/memory updates (Window B Round 2, 3/3)
- 2026-04-21 — `e023ff9` — DA.1 regression-diff verdict doc — NECESSARY BUT NOT SUFFICIENT pending Oliver rating (Window B Round 2, 2/3)
- 2026-04-21 — `bfc7eed` — Round 2 regression-diff render harness (Window B Round 2, 1/3)
- 2026-04-21 — `1653606` — Window C Rating Ledger UI: `/dashboard/rating-ledger` + `/api/admin/rating-ledger` (unified legacy Lab + Listings Lab + prod scene_ratings, with retrieval-status chip)
- 2026-04-21 — `6c7cc6d` — DA.1 smoke tests + cost-reconcile note + STACK update (Window B, 5/5)
- 2026-04-21 — `47010d4` — DA.1 Gemini-first prod + Lab analysis + DA.3 motion_headroom validator (Window B, 4/5)
- 2026-04-21 — `921c3dd` — DA.2 director motion_headroom hard bans + camera-state block (Window B, 3/5)
- 2026-04-21 — `ae25541` — DA.1 Gemini 3 Flash analyzer with motion_headroom + @google/genai dep (Window B, 2/5)
- 2026-04-21 — `9fae141` — DA.1 migration 030 photos.analysis_json + analysis_provider (Window B, 1/5)
- 2026-04-21 — Window D Round 1: router-table audit — existing signal insufficient for SKU routing (32 buckets, 0 winners, 32% SKU-granular); draft file empty, not wired; coverage report at `docs/audits/router-coverage-2026-04-21.md`
- 2026-04-21 — `5b07ce3` — M.2 backfill script widened to all unembedded scenes (17/24 embedded)
- 2026-04-21 — `f1bf53a` — M.2b removed dead match_lab_iterations RPC + prompt-qa dead code
- 2026-04-21 — `1938317` — M.2d exemplar/recipe/loser blocks now surface model_used SKU to director
- 2026-04-21 — `90a00cb` — M.2d SKU capture in recipes + retrieval (migration 028 applied)
- 2026-04-21 — `7a7dc6e` — DM.6 legacy Lab UI routes recommit (missed in d9e6f1f)
- 2026-04-21 — `dc27158` — docs consolidation; new canonical `docs/` structure; archive folder; session hygiene written into [`README.md`](./README.md)
- 2026-04-20 — `9283260` — Phase C production end-to-end (router swap, base64 → URL, duration-aware director)
- 2026-04-20 — `0b020f3` — CI.5 cost dashboard drill-down
- 2026-04-20 — `82fec7c` — docs update (PROJECT-STATE / TODO / STACK)
- 2026-04-20 — `3c392cf` — CI.3 + CI.4 Shotstack per-minute + failed-render cost tracking
- 2026-04-20 — `2079822` — CI.2 OpenAI embedding cost tracking
- 2026-04-20 — `464f25d` — CI.1 model-aware Claude pricing
- 2026-04-20 — `8a06b66` — DM.3 + DM.4 native Kling routing with Atlas failover
- 2026-04-20 — `d9e6f1f` — DM.6 retire legacy Prompt Lab UI routes
- 2026-04-20 — `1e8893f` — DQ.2/3/5 stability-prefix gating, paired auto-route, notes rewrite
- 2026-04-20 — `734afa9` — DQ.1 director concise-prompt rewrite
- 2026-04-20 — `6fceb2c` — DQ.4 default new listings to `kling-v2-6-pro`
- 2026-04-20 — `124adfc` — Atlas cost tracking fix (per-SKU × duration)
- 2026-04-20 — `41e4290` + `6b5da62` — Phase M.1 audit verdict recorded
- 2026-04-20 — `858577c` / `d6c57a0` / `9995657` / `7818cfd` — Phase A (Lab UX spine)

## Known gotchas

- **File-revert mystery in this repo** — during one session in 2026-04-13, file edits got silently reverted by an unknown process. Dormant since but watch for it. Commit often; keep a memory backup of in-flight work.
- **Production `properties.selected_duration` column does not exist yet.** Phase C pipeline reads optimistically with `maybeSingle()` and logs a warn + defaults to 60s until the order-form persistence work lands.
- **Atlas pricing** for `v2.6-pro` was initially miscalibrated at 2× under. Now `$0.60/clip` confirmed. Other SKUs may still need invoice verification — see [`specs/2026-04-20-back-on-track-design.md`](./specs/2026-04-20-back-on-track-design.md) Phase CI notes.
- **Kling v3 shake issue** on single-image shots. Stability prefix (`CAMERA_STABILITY_PREFIX`) is applied only for `kling-v3-*` models after DQ; Atlas negative prompt is always applied.
- **Lab → prod promotion has never been used** — 0 overrides ever promoted per Phase M.1 audit. Signal is there but no one is turning recipes into active router directives. M.2 and B close this.
- **Prod scene embeddings** — all 24/24 scenes embedded after M.2 backfill (2026-04-21). Backfill script widened to all prod scenes (not just rated ones).

## Oliver's standing preferences

- Plain language, bottom-line, no jargon.
- **No git push / no Vercel deploy without explicit in-turn permission for destructive operations.** Blanket "direct-to-main" granted for routine current work — still ask on anything destructive (force push, rebase pushed history, column drops, file deletion outside the `archive/` pattern).
- Higher models (Opus) for design/audit tasks; Sonnet for implementation; Haiku only for trivial mechanical work.
- Cost tracking is first-class — every API call logs a `cost_event`, even $0 ones. Don't ship with null/0 cost fields on finalized renders.
- Efficient execution. Minimal questions. Pick the best path and proceed.

## Cross-repo state

Three working copies exist on disk, all pointing at the same GitHub repo (`theolivercollins/reelready`) on different branches:

| Path | Branch | Status |
|---|---|---|
| `/Users/oliverhelgemo/real-estate-pipeline` | `main` | **active** — all work lands here |
| `/Users/oliverhelgemo/real-estate-pipeline-finances` | `finances-tab` | stale side-branch clone — do NOT push. Latest commit `66135be` (finances-tab work, mid-April). Useful only as reference. |
| `/Users/oliverhelgemo/real-estate-pipeline-ui` | `ui-redesign` | stale side-branch clone — do NOT push. Latest commit `e54b2f2`. Older than main. |

Snapshots of the stale forks' `docs/` live under [`archive/forks/`](./archive/forks/) for historical record.

## Next session checklist

When you pick this up:
1. Read [`README.md`](./README.md) → this file → [`state/PROJECT-STATE.md`](./state/PROJECT-STATE.md) → [`plans/back-on-track-plan.md`](./plans/back-on-track-plan.md).
2. Confirm with Oliver whether Phase M.2 is re-dispatched or skipped before starting implementation.
3. Any push to `main` → append a line to "Recent shipping log" above AND update "Right now" if the next action changed.
4. Use the `superpowers` plugin for planning + execution. Don't freelance.
