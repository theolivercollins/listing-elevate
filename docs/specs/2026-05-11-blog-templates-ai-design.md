# Blog Engine — Editor fix + Templates + AI Generation — Design Spec

**Date:** 2026-05-11
**Author:** Oliver + Claude (brainstorm)
**Status:** Approved, ready for implementation plan
**Builds on:** Phase 1+2+5 — all live on main as of 2026-05-10.

---

## 1. Goal

Three improvements to the Phase 5 portal, shippable as one feature branch:

1. **Editor fix** — Tiptap currently renders as a textarea-feeling field; pasted HTML gets normalized through the schema, and there's no source-mode toggle. Real estate market-update posts need table support + HTML pasting + WYSIWYG preview.
2. **Templates** — let the user save named HTML templates (e.g. "Market Update", "Listing Highlight"), reuse them on new posts, upload from .html files, and edit/delete them.
3. **AI generation** — Claude Sonnet 4.6 generates blog HTML from a prompt + optional template, returns clean HTML for the editor.

These ship together because templates feed AI generation, and the editor fix is needed to make either useful.

---

## 2. Scope

**In:**
- Tiptap upgrades + a `{ }` Source toggle button
- New table `blog_templates` (migration 051)
- New page `/dashboard/blog/templates` (list + create + edit + delete + upload .html)
- "Start from template" picker on compose flow
- "Generate with AI" button + modal on compose flow
- New API endpoints: `api/blog/templates/*` (CRUD) + `api/blog/ai/draft.ts`
- Anthropic Sonnet 4.6 wiring with `cost_events` tracking
- Brand voice prompt baked into the AI route (one-line system prompt with The Helgemo Team / Punta Gorda context)
- Topic dropdown nav addition (Posts / Image library / **Templates**)

**Out (deferred):**
- Daily auto-research (Phase 3)
- Cron-triggered auto-drafting (Phase 4) — manual AI is enough to unblock authoring
- Style-rules learning loop (Phase 6)
- Template variables / merge fields ($listing_address, etc.) — v2 feature
- Multi-language output
- Per-user templates (single-user / single-site only for v1)

---

## 3. Editor fix details

### 3.1 New Tiptap extensions

Add to `PostEditor.tsx`:
- `@tiptap/extension-underline` — already useful for emphasis
- `@tiptap/extension-text-align` — market-update tables look right-aligned
- `@tiptap/extension-table`, `@tiptap/extension-table-row`, `@tiptap/extension-table-cell`, `@tiptap/extension-table-header` — required for any data-driven post
- Use Tiptap's `defaultMarks` config to allow more HTML through the schema (configure `StarterKit.code.HTMLAttributes`, etc.)

### 3.2 Source-mode toggle

A `{ }` button on the toolbar flips between two views over the same `body_html`:

| Mode | Renders | When |
|---|---|---|
| **Rich (WYSIWYG)** | Tiptap | Default for new manual posts |
| **Source (HTML)** | `<textarea>` with monospace, syntax-tint via Tailwind | Default when post was created from a template or AI |

Round-trip rules:
- Rich → Source: take `editor.getHTML()` straight into the textarea.
- Source → Rich: take the textarea value, run through `editor.commands.setContent(html, false, { preserveWhitespace: 'full' })`. Whitespace + most HTML preserved; anything not in the Tiptap schema gets stripped (acceptable trade-off, and a warning toast appears if content changed).

### 3.3 UX polish

- Bump editor min-height from `min-h-[300px]` to `min-h-[500px]` in compose mode
- Apply `prose prose-sm max-w-none` to the rendered content area so WYSIWYG looks like a rendered post
- Add a small "Source mode" banner above the textarea reminding the user that `<script>` and inline JS are stripped

---

## 4. Templates

### 4.1 Schema (migration 051)

```sql
create table blog_templates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references blog_sites(id),                -- nullable = global / shared
  name text not null,
  description text,
  body_html text not null default '',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index blog_templates_site_active_idx on blog_templates(site_id, active) where active = true;
```

No starter rows in v1 — user creates their own. (We could seed a "Market Update" template later as a one-off SQL.)

### 4.2 Page `/dashboard/blog/templates`

**Header:** "Templates" + "+ New Template" button (top-right).

**List view:** card grid (2-col on tablet, 3-col on desktop). Each card:
- Template name + description
- Mini live preview (HTML rendered in a sandboxed iframe at ~200×150)
- Hover overlay: **Edit**, **Use in new post**, **Soft-delete**

**Compose / edit form:**
- Name input (required)
- Description input (optional, helps the user remember when to use it)
- Body — same editor component as posts (`PostEditor` with source toggle); defaults to **Source mode** since templates are typically pasted HTML
- "**Upload .html file**" button → file picker → reads text → fills the source field
- Save / Cancel

### 4.3 Compose-flow wiring

`/dashboard/blog/posts/new` gains a top-of-page row:

```
[ Start from template ▾ ] [ ✨ Generate with AI ]    title input below
```

Clicking the template dropdown shows your templates (or "No templates yet — create one"). Selecting one populates `form.body_html` and flips the editor to Source mode (so you see what landed).

### 4.4 API

```
GET    /api/blog/templates                  → { templates: [...] }
POST   /api/blog/templates                  → { id }     body: {name, description?, body_html}
GET    /api/blog/templates/[id]             → { template }
PATCH  /api/blog/templates/[id]             → { ok }     body: {name?, description?, body_html?}
DELETE /api/blog/templates/[id]             → { ok }     soft (active=false)
```

All gated via `requireAdmin`.

---

## 5. AI generation

### 5.1 UX

On the compose page, "**✨ Generate with AI**" button next to "Start from template".

Clicking opens a Dialog modal:

```
Generate post with AI
─────────────────────────────────────────────────────────────────
Template (optional)   [ — None — ▾ ]
                      Provides structural HTML the AI fills in.

What should this post be about? *
┌────────────────────────────────────────────────────────────────┐
│ e.g. "Punta Gorda May 2026 market update — median price up,    │
│ inventory tightening, mortgage rates at 6.5%."                 │
│                                                                │
└────────────────────────────────────────────────────────────────┘

Knobs (optional)
  Target length     ◯ Short (~300w)  ● Standard (~600w)  ◯ Long (~1000w)
  Tone              ● Professional   ◯ Casual            ◯ Data-driven

                                          [ Cancel ]  [ Generate ]
```

On Generate, the modal switches to a "Generating…" state (~5–15s), then shows a side-by-side preview:

```
Original                                Generated
────────────────────                    ────────────────────
(current editor content                 (proposed HTML rendered)
or empty)

Cost: $0.08 · Model: claude-sonnet-4-6 · 547 input + 894 output tokens

[ Regenerate ]                                [ Discard ]  [ Use this ]
```

**Use this** populates `form.body_html` + flips editor to Source mode. **Regenerate** re-calls the API with the same input. **Discard** closes.

### 5.2 Backend `POST /api/blog/ai/draft`

```
Body: {
  prompt: string;             // required
  template_id?: string;       // optional
  length: 'short' | 'standard' | 'long';
  tone: 'professional' | 'casual' | 'data_driven';
  site_id?: string;           // defaults to Helgemo Sierra
}

→ 200
{
  html: string;
  cost_cents: number;
  model: 'claude-sonnet-4-6';
  usage: { input_tokens, output_tokens };
}
```

Implementation:
1. `requireAdmin` auth gate
2. Load template HTML if `template_id` provided
3. Build the Claude messages:
   - System: brand-voice prompt (see 5.3)
   - User: structured prompt — template (if any) + user request + knobs
4. Call `anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 4096, system, messages })`
5. Compute cost from usage tokens (Sonnet 4.6 pricing: $3/M input, $15/M output)
6. Insert `cost_events` row (`stage='blog_ai_draft'`, provider=`anthropic`, cost_cents, metadata={ prompt: prompt.slice(0,200), template_id, length, tone, model })
7. Return the parsed HTML (strip ```html fences if present)

### 5.3 Brand-voice system prompt

```
You write real-estate blog posts for The Helgemo Team in Punta Gorda, FL.

Output requirements:
- Return ONLY clean HTML, no markdown, no commentary, no <html>/<head>/<body> wrappers.
- Use these tags only: h2, h3, p, ul, ol, li, strong, em, a, blockquote,
  table, thead, tbody, tr, th, td, br.
- NEVER include <script>, <iframe>, <style>, inline event handlers, or javascript: URLs.
- No emojis unless asked.
- Use The Helgemo Team's voice: warm, knowledgeable, locally-grounded.
  Speak as "we" not "I". Mention Punta Gorda / Charlotte County by name when relevant.
- Always end with a soft CTA: invite the reader to reach out about a tour
  or market consult.

If a template is provided, treat it as the structural skeleton and fill it
in. Match its tone, headings, and section count unless the prompt explicitly
asks otherwise.
```

### 5.4 Provider allowlist update

`cost_events.provider_check` was expanded for Phase 1's `browserbase`, `apify`, `gemini`. `anthropic` is already in the allowlist (it was the first provider added). No constraint change needed.

`cost_events.stage` accepts any text; we just need to add `'blog_ai_draft'` to the `BlogCostStage` union in `lib/blog-engine/cost.ts`.

---

## 6. Files & structure

| Path | What |
|---|---|
| `supabase/migrations/051_blog_templates.sql` | new table + index |
| `lib/blog-engine/cost.ts` | extend `BlogCostStage` with `blog_ai_draft` |
| `lib/blog-engine/ai-draft.ts` | pure logic: build messages, parse response, compute cost; deps injected |
| `lib/blog-engine/ai-draft.test.ts` | unit tests with mocked Anthropic |
| `api/blog/templates/index.ts` | GET list + POST create |
| `api/blog/templates/[id].ts` | GET + PATCH + DELETE (soft) |
| `api/blog/ai/draft.ts` | POST → calls Anthropic, records cost, returns HTML |
| `src/lib/blog/api-client.ts` | extend with `listTemplates`, `createTemplate`, etc. + `generateDraft` |
| `src/lib/blog/types.ts` | `BlogTemplate` type |
| `src/components/blog/PostEditor.tsx` | source toggle + new extensions + prose styling |
| `src/components/blog/TemplatePickerInline.tsx` | inline dropdown for "Start from template" |
| `src/components/blog/AIDraftModal.tsx` | the modal flow |
| `src/components/blog/HtmlPreview.tsx` | sandboxed iframe preview (used in templates list + AI modal) |
| `src/pages/dashboard/BlogTemplates.tsx` | list page |
| `src/pages/dashboard/BlogTemplateDetail.tsx` | create/edit page |
| `src/pages/dashboard/BlogPostDetail.tsx` (modify) | wire template picker + AI button at top |
| `src/App.tsx` (modify) | add 3 routes |
| `src/components/TopNav.tsx` (modify) | add Templates link to Blog dropdown |

---

## 7. Failure modes

| Failure | Behavior |
|---|---|
| Anthropic API down / 5xx | Modal shows toast with error; **Regenerate** re-tries; user can dismiss. No partial cost recorded. |
| AI returns non-HTML | Strip ```html fences; if still malformed, surface raw text in preview with a "doesn't look like HTML" warning; user can still Use this. |
| AI returns `<script>` despite the system prompt | Backend strips `<script>` tags before returning. Logged as a security event in `cost_events.metadata`. |
| Template HTML deleted while a post references it | Templates aren't referenced from posts after the body is copied in. No FK relationship, no danger. |
| `.html` upload >1 MB | Reject in frontend with a toast — these should be small structural HTML, not full pages with embedded assets. |
| Round-tripping HTML through Rich mode strips content | Toast: "Some HTML was normalized. Switch back to Source to see the diff." Original textarea contents preserved in a local ref for undo. |

---

## 8. Cost expectations

- Sonnet 4.6 input: $3 / M tokens. Average prompt ~1000 tokens with template = $0.003.
- Sonnet 4.6 output: $15 / M tokens. Standard post ~800–1200 tokens output = $0.012–0.018.
- Average AI draft: **$0.015–0.025 each.**
- One regen costs the same again. With a 3-regen soft cap (already in place from spec §3.2), worst-case per post = $0.10.

For comparison, a single Browserbase publish session is $0.10. AI drafting is cheap.

---

## 9. Definition of Done

1. ✅ Migration 051 applied (blog_templates + index)
2. ✅ Editor: Source-mode toggle works; round-trip Rich ↔ Source preserves content (tested manually with pasted Sierra-style HTML)
3. ✅ Tiptap supports underline + text-align + tables
4. ✅ `/dashboard/blog/templates` lists templates, "+ New" form saves + edits + soft-deletes
5. ✅ Upload .html file populates the source field
6. ✅ "Start from template" picker on compose pre-fills the body and switches to Source mode
7. ✅ "Generate with AI" modal: prompt + optional template + knobs → Claude returns HTML → preview → Use this populates editor
8. ✅ AI draft cost row written to `cost_events`
9. ✅ `<script>` tags stripped from AI output server-side
10. ✅ tsc clean; vitest green (12 existing + ai-draft unit tests)
11. ✅ HANDOFF.md updated; PRs through dev → staging → main
