# Market Update Workflow — Design

**Date:** 2026-06-04
**Branch:** `feat/market-update-workflow`
**Goal:** Each month, Oliver uploads the Helgemo Team's market-update stat reports, and Listing Elevate produces the regional blog posts + Charlotte County email, math-validated, as drafts that flow through the existing HITL → Sierra-publish / Sendy-send rails.

## Problem

Today the team's monthly market update is a manual workflow: pull Stellar MLS reports per area, hand-transcribe the numbers into HTML blog/email templates, rewrite the FAQ, eyeball the math, then publish to the Helgemo Sierra site and blast via Sendy. This is slow and error-prone (the numbers are the whole point and a fat-fingered MoM% is embarrassing).

We already have, live on prod:
- Blog posts → HITL approval → publish to Sierra (Browserbase) — `api/blog/posts/*`, `lib/blog-engine/jobs`, `publishers/sierra/*`
- Emails → HITL approval → push to Sendy — `api/blog/emails/[id]/send.ts`
- `blog_templates` / `email_templates` tables + full CRUD UI (`/dashboard/studio/blog/templates`, `/email/templates`)
- PDF upload → Claude document blocks (`api/blog/ai/chat.ts`)
- First-class cost tracking (`lib/blog-engine/cost.ts`)

So the **only new surface** is the front of the pipeline: ingest the monthly PDFs → extract metrics → validate the math → fill the templates → AI-rewrite the FAQ → drop 4 drafts. Everything downstream (approve, publish, send) is reused unchanged.

## Decisions (locked with Oliver)

1. **Source = 3 separate per-region PDFs**, uploaded into LE each month: Charlotte County (full area), The Isles (the BSI+PGI Stellar report — already combined), Deep Creek.
2. **Source format = Stellar MLS stat-report PDF.** Note: some are **image-only PDFs with no text layer** (e.g. `cc mu feb 2026.pdf`), so extraction must use Claude's native document/vision blocks, not text scraping. This is exactly why the math-validation step is mandatory.
3. **Templates are managed inside LE** (reusing the existing template CRUD). They carry `{{TOKEN}}` placeholders from a fixed canonical vocabulary (below). We seed a working default blog + email MU template so the pipeline runs day one; Oliver edits/replaces them in-platform using the same tokens.
4. **Outputs reuse existing drafts** — 3 `blog_posts` + 1 `emails` row. No new review surface; approval/publish/send happen in the surfaces already in use.

## Approach: Hybrid (deterministic numbers, AI only for prose)

Maps 1:1 to the skill spec's three verbs — *replace placeholders* (deterministic), *AI-optimize the FAQ* (AI), *double-check the math* (deterministic validation).

```
per region PDF
  → extract  (Claude tool-use, schema-forced) → RegionMetrics JSON   [only AI step touching numbers]
  → validate (pure)        → MathIssue[]  (error | warning)
  → fill     (pure)        → HTML with every {{TOKEN}} replaced
  → faq      (Claude)      → FAQ block rewritten to match the new trends
  → strip-images (pure)    → (Isles + Deep Creek only) remove <img>/picture placeholders
  → draft    → blog_posts row (state=draft_ready); CC also → emails row (state=draft)
```

A run with any **error**-severity math issue is `needs_review` and creates **no drafts** until acknowledged. Warnings surface but don't block.

### Rejected alternatives
- **B — Ally generates filled HTML end-to-end:** less new code but non-deterministic numbers, weak math guarantees, untestable. Rejected.
- **C — fully deterministic, no AI:** brittle on image-only PDFs (no text to parse) and a canned-feeling FAQ. Rejected.

Hybrid isolates AI to two well-bounded jobs (read-numbers-into-schema; rewrite-FAQ-prose) and keeps every number on a deterministic validate-then-fill path.

## Canonical metric + token vocabulary

One `RegionMetrics` object per region. Every metric field carries `current`, `prev_month`, `prev_year`, `mom_pct`, `yoy_pct`, and (where the report gives one) `trend` (`appreciating|depreciating|neutral|upward|downward|rising|falling`).

**Metric keys** (13): `for_sale`, `sold`, `pended`, `avg_for_sale_price`, `avg_sold_price`, `median_sold_price`, `avg_ppsf`, `dom`, `sold_to_list` (ratio %), `moi_closed`, `moi_pended`, `absorption_closed`, `absorption_pended`.

**Meta fields:** `region_name`, `report_month` (e.g. "March"), `report_year` (2026), `published_month`, `market_verdict` (`Seller's | Buyer's | Neutral`).

**Token grammar** — for each metric key `K` (uppercased): `{{K}}` (current), `{{K_MOM}}` (MoM %, signed, formatted e.g. `+22.2%`), `{{K_YOY}}`, `{{K_PREV_MONTH}}`, `{{K_PREV_YEAR}}`, `{{K_TREND}}`, `{{K_MOM_DIR}}` / `{{K_YOY_DIR}}` (`up|down|flat` — drives ↑/↓ + color in the template). Prices format as `$665,000`; ratios/absorption as `90%`; counts bare; DOM as `108`. Meta tokens: `{{REGION_NAME}}`, `{{REPORT_MONTH}}`, `{{REPORT_YEAR}}`, `{{MARKET_VERDICT}}`.

**FAQ block:** the template marks the FAQ region with `<!-- MU:FAQ_START --> … <!-- MU:FAQ_END -->`. `faq.ts` replaces the inner HTML. If the markers are absent, FAQ rewrite is skipped (non-fatal).

**Image placeholders:** any `<img …>` plus explicit `<!-- MU:IMAGE … -->` markers. `strip-images.ts` removes them for The Isles + Deep Creek only.

The template editor surfaces the full token list and flags any `{{…}}` not in the vocabulary, so the HTML and the parser can never silently diverge.

## Validation rules (deterministic, `validate.ts`)

- `mom_pct ≈ (current − prev_month)/prev_month × 100`, tolerance ±0.6 pp (absorbs source rounding). Mismatch → **error**.
- `yoy_pct ≈ (current − prev_year)/prev_year × 100`, same tolerance → **error**.
- `market_verdict` vs `moi_closed` thresholds (Seller <3, Neutral 3–6, Buyer >6) → **warning** (source sometimes labels on a different basis).
- `absorption_closed ≈ 100/moi_closed` inverse sanity → **warning**.
- Any token referenced by the chosen template that has no value in `RegionMetrics` → **error** (prevents a literal `{{SOLD_COUNT}}` shipping).
- Required meta fields present → **error** if missing.

`validate(metrics, templateHtml)` returns `MathIssue[]` with `{ severity, field, message, expected?, got? }`.

## Data model

Reuse `blog_templates`, `email_templates`, `blog_posts`, `emails` unchanged. MU templates are flagged via `metadata.kind = 'market_update'` and `metadata.mu_role = 'blog' | 'email'`.

**New migration `059_market_update.sql`:**

```sql
-- region config (seeded; extensible)
create table mu_regions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references blog_sites(id),
  slug text not null,                 -- 'charlotte_county' | 'the_isles' | 'deep_creek'
  display_name text not null,         -- 'Charlotte County'
  strip_images boolean not null default false,
  emits_email boolean not null default false,
  sort_order int not null default 0,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- one row per monthly run
create table market_update_runs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references blog_sites(id) on delete cascade,
  period_month int not null,          -- 1..12 (the DATA month, e.g. March)
  period_year int not null,
  status text not null default 'extracting'
    check (status in ('extracting','needs_review','ready','generated','failed')),
  blog_template_id uuid references blog_templates(id),
  email_template_id uuid references email_templates(id),
  region_results jsonb not null default '[]'::jsonb,  -- [{region_slug, metrics, issues, post_id?, email_id?}]
  created_post_ids uuid[] not null default '{}',
  created_email_ids uuid[] not null default '{}',
  cost_usd_cents int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index market_update_runs_site_idx on market_update_runs(site_id, period_year desc, period_month desc);
notify pgrst, 'reload schema';
```

The migration also **seeds** the 3 `mu_regions` rows and one default blog + email MU template (built from the structure of the prior `MarketSummary_Updated.html` output, using canonical tokens).

## Modules (`lib/blog-engine/market-update/`)

| Module | Purpose | Pure? | Tested |
|---|---|---|---|
| `types.ts` | `RegionMetrics`, `MetricStat`, `MathIssue`, token list | — | — |
| `extract.ts` | PDF (base64) → `RegionMetrics` via Anthropic tool-use (`input_schema`), model `claude-sonnet-4-6`; cost stage `blog_mu_extract` | no | mock SDK |
| `validate.ts` | `RegionMetrics` + templateHtml → `MathIssue[]` | **yes** | TDD |
| `format.ts` | metric → token string map (`$665,000`, `+22.2%`, dir flags) | **yes** | TDD |
| `fill.ts` | template + token map → filled HTML; reports unknown/unfilled tokens | **yes** | TDD |
| `faq.ts` | filled HTML + metrics → FAQ block rewritten (Claude); cost stage `blog_mu_faq` | no | mock SDK |
| `strip-images.ts` | filled HTML → image placeholders removed | **yes** | TDD |
| `run.ts` | orchestrate per region; create drafts; write `market_update_runs` | no | integration |

`extract` and `faq` go through the existing direct Anthropic SDK pattern (`api/blog/ai/chat.ts`) and `computeClaudeCost`. Relative imports use explicit `.js` (Vercel ESM rule).

## API

- `POST /api/blog/market-update/runs` — body `{ period_month, period_year, blog_template_id, email_template_id, regions: [{ slug, pdf_base64, filename }] }` (base64 PDFs, max 4 MB each, mirroring chat upload). Runs extract+validate for each region synchronously; persists a `market_update_runs` row; returns `{ run_id, status, region_results }`. If status is `ready`, the client may immediately call generate; if `needs_review`, returns issues without creating drafts.
- `POST /api/blog/market-update/runs/[id]/generate` — body `{ acknowledge_warnings?: boolean }`. Fills templates, rewrites FAQ, strips images, creates the 4 drafts, sets status `generated`, returns the created post/email ids. Refuses if any unresolved **error** issue remains.
- `GET /api/blog/market-update/runs/[id]` — fetch a run.
- `GET /api/blog/market-update/runs` — list runs for the site.

New `vercel.json` rewrites mirror the existing `/api/blog/.../([^/]+)/action` pattern (sub-routes before the bare `[id]`).

Cost: new stages `blog_mu_extract` (per PDF, provider `anthropic`) and `blog_mu_faq` (per region, provider `anthropic`) added to the `BlogCostStage` union; publish/send reuse existing stages on approval.

## UI

New page `/dashboard/studio/blog/market-update` (component `src/pages/dashboard/MarketUpdate.tsx`), registered in `App.tsx` and linked from the Blog area:

1. **Setup** — month + year pickers; blog-template + email-template selectors (default to the seeded MU templates); three labelled upload slots (Charlotte County / The Isles / Deep Creek).
2. **Run** — POST `/runs`; render a per-region card: extracted-metrics table + green/amber/red validation badges. Errors are blocking and explained inline.
3. **Generate** — enabled only when no error issues (or warnings acknowledged via checkbox). POST `/generate`; on success show the 4 created drafts as links into the existing blog/email detail pages, where Oliver approves → publish/send.

Each generated draft also exposes a **Download HTML** giving the spec's named files (`Charlotte_County_Market_Update_Blog.html`, `…_Email.html`, `The_Isles_…_Blog.html`, `Deep_Creek_…_Blog.html`) — but the draft row is the canonical object.

## Testing

- `validate.ts`, `format.ts`, `fill.ts`, `strip-images.ts` — Vitest unit tests (pure functions; the BSI+PGI Nov 2025 report numbers as a fixture for validate).
- `extract.ts`, `faq.ts` — tests with a mocked Anthropic SDK asserting the tool-use call shape + cost recording.
- `run.ts` — integration test with mocked extract/faq + a stub Supabase asserting draft creation and the needs_review gate.

## Out of scope (YAGNI)

- Auto-pull from Google Drive (chosen: manual upload).
- New approval/publish/send UI (reused).
- Regions beyond the seeded 3 (config-driven; add a row later).
- Scheduling/cron of the monthly run (manual kickoff; revisit if desired).

## Production safety

Build + verify on `feat/market-update-workflow` + a Supabase branch + Vercel preview only. Per Oliver's rules: no prod migration, no prod deploy, no push to main, and no real Sierra publish / real Sendy send without explicit per-change approval.
