# Blog Engine — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/specs/2026-05-06-blog-engine-design.md`](../specs/2026-05-06-blog-engine-design.md)

**Goal:** Prove the riskiest piece of the blog engine end-to-end — a hand-written post row in Supabase publishes to the live Helgemo Sierra blog via Browserbase, and a follow-up edit round-trips back. No AI yet.

**Architecture:** New `lib/blog-engine/` module inside Listing Elevate. Supabase tables prefixed `blog_*` (migration 048). Browserbase persistent context per site, driven by Playwright. Job queue is a `blog_jobs` table polled by a Vercel Cron entry, mirroring LE's existing `api/cron/poll-*` pattern. Cost tracking uses LE's existing `cost_events` table with new `stage` values.

**Tech Stack:** TypeScript, Supabase Postgres, `@browserbasehq/sdk` + `playwright-core`, Vercel serverless + Cron, Vitest.

**Phase 1 explicitly excludes:** AI (Gemini, Claude), image library, vision tagging, topic research, drafts, portal UI, style rules, AgentFire. Those are subsequent phase plans.

**Out at end of Phase 1:** A CLI script can insert a hand-written post row, enqueue a publish job, and within ~60s see it live on the Sierra site. A second script can update the post body and trigger an edit job that updates the live post.

---

## File structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/048_blog_engine.sql` | All `blog_*` tables + indexes + trigger to maintain `blog_posts.cost_usd_cents` |
| `lib/blog-engine/types.ts` | Shared TS types (BlogPost, BlogSite, BlogJob, etc.) |
| `lib/blog-engine/cost.ts` | `recordBlogCost()` — wrapper around `cost_events` insert with the explicit `{error: costErr}` pattern |
| `lib/blog-engine/browserbase.ts` | Browserbase client wrapper: `getOrCreatePersistentContext(siteId)`, `runInSession(siteId, fn)` |
| `lib/blog-engine/publishers/types.ts` | `Publisher` interface + DTOs |
| `lib/blog-engine/publishers/sierra/selectors.ts` | All Sierra DOM selectors centralized |
| `lib/blog-engine/publishers/sierra/auth.ts` | Sign-in flow against Sierra login page |
| `lib/blog-engine/publishers/sierra/taxonomy.ts` | `fetchTaxonomy()` — scrape Author + Category dropdowns |
| `lib/blog-engine/publishers/sierra/publish.ts` | `publish(post)` click path |
| `lib/blog-engine/publishers/sierra/edit.ts` | `edit(post)` click path |
| `lib/blog-engine/publishers/sierra/index.ts` | Exports a `Publisher` impl combining the above |
| `lib/blog-engine/jobs/runner.ts` | Generic job dispatcher (claim, run, finalize) |
| `lib/blog-engine/jobs/handlers/fetch-taxonomy.ts` | One handler |
| `lib/blog-engine/jobs/handlers/publish.ts` | One handler |
| `lib/blog-engine/jobs/handlers/edit.ts` | One handler |
| `lib/blog-engine/jobs/handlers/index.ts` | Handler registry |
| `api/cron/poll-blog-jobs.ts` | Vercel Cron entry — calls `runner.tick()` |
| `api/blog/jobs/enqueue.ts` | POST endpoint to enqueue a job (admin-only) |
| `scripts/blog/seed-helgemo-site.ts` | One-off: insert the Helgemo Sierra `blog_sites` row |
| `scripts/blog/manual-publish.ts` | One-off: insert a hand-written post + enqueue publish |
| `scripts/blog/manual-edit.ts` | One-off: update an existing post + enqueue edit |
| `lib/blog-engine/cost.test.ts` | Vitest |
| `lib/blog-engine/jobs/runner.test.ts` | Vitest |
| `lib/blog-engine/publishers/sierra/selectors.test.ts` | Vitest (snapshot of selector constants) |

Each file has one responsibility. Browser-driving code is split per click path so any future Sierra UI change touches one file. Selectors are a single module so a UI break is a one-line fix.

---

## Pre-flight assumptions to validate before Task 1

These are the open questions in spec §13 that must be resolved before this plan executes. If any answer differs from the assumption below, adjust the affected task in place.

1. **Sierra image upload:** standard `<input type="file">`. (If JS-driven uploader, `publish.ts` step 4 needs revision.)
2. **Sierra "View Post" admin URL:** captured the first time `publish` succeeds — not assumed up front.
3. **Bot creds storage:** Vercel env vars `SIERRA_HELGEMO_USERNAME` and `SIERRA_HELGEMO_PASSWORD`. (Spec mentions Supabase Vault as a later upgrade; not Phase 1.)
4. **Browserbase package:** `@browserbasehq/sdk` (v2). Playwright via `playwright-core`.

---

## Environment prerequisites

Add to Vercel env (all 3 tiers, but cron only fires on prod per LE convention):

- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID`
- `SIERRA_HELGEMO_USERNAME`
- `SIERRA_HELGEMO_PASSWORD`
- `SIERRA_HELGEMO_BASE_URL` = `https://client2.sierrainteractivedev.com`
- `BLOG_CRON_SECRET` (matches existing pattern; reused by `poll-blog-jobs.ts`)

Locally: same vars in `credentials.env` (LE uses this file).

---

## Task 1: Migration 048 — `blog_*` schema

**Files:**
- Create: `supabase/migrations/048_blog_engine.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 048_blog_engine.sql
-- Phase 1 schema for the blog engine. Multi-site from day 1, Sierra adapter only.

create type blog_post_state as enum (
  'research_due','topics_proposed','topic_picked',
  'draft_due','draft_ready','awaiting_approval',
  'publish_due','publishing','live',
  'edit_pending','editing','quarantined'
);

create type blog_job_kind as enum (
  'research','distill_topics','draft','image_match',
  'publish','edit','fetch_taxonomy','distill_correction'
);

create type blog_job_state as enum ('queued','running','done','failed');

create type blog_correction_status as enum ('proposed','accepted','discarded','edited');

create table blog_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  host_kind text not null check (host_kind in ('sierra','agent_fire')),
  base_url text not null,
  bot_credentials_ref text,                 -- env var name or vault key
  default_author_id text,
  default_category_id text,
  taxonomy_cache jsonb not null default '{}'::jsonb,
  browserbase_context_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table blog_posts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references blog_sites(id),
  state blog_post_state not null default 'draft_ready',
  topic_suggestion_id uuid,                 -- fk added in later phase
  title text not null,
  slug text,
  body_html text not null,
  meta_title text,
  meta_description text,
  meta_tags text[] not null default '{}',
  image_id uuid,                            -- fk added in later phase
  author_label text,
  category_label text,
  external_post_url text,
  external_post_id text,
  publish_at timestamptz,                   -- null = immediate on approval
  regen_count int not null default 0,
  cost_usd_cents int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index blog_posts_site_state_idx on blog_posts(site_id, state);

create table blog_jobs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references blog_posts(id),
  site_id uuid not null references blog_sites(id),
  kind blog_job_kind not null,
  state blog_job_state not null default 'queued',
  attempts int not null default 0,
  last_error text,
  browserbase_session_id text,
  replay_url text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index blog_jobs_due_idx on blog_jobs(state, scheduled_at) where state = 'queued';
create index blog_jobs_site_kind_idx on blog_jobs(site_id, kind, state);

-- Maintain blog_posts.cost_usd_cents from cost_events.
-- cost_events already exists; we add a trigger that watches for inserts whose
-- payload references a blog post.
create or replace function blog_cost_events_after_insert()
returns trigger language plpgsql as $$
begin
  if new.post_id is not null and exists (select 1 from blog_posts p where p.id = new.post_id) then
    update blog_posts
       set cost_usd_cents = cost_usd_cents + coalesce(new.cost_usd_cents, 0),
           updated_at = now()
     where id = new.post_id;
  end if;
  return new;
end;
$$;

-- cost_events does not currently have a post_id column; spec calls for adding it
-- ONLY for blog use. Add as nullable so existing inserts are unaffected.
alter table cost_events add column if not exists post_id uuid;

create trigger blog_cost_events_after_insert_trg
after insert on cost_events
for each row execute function blog_cost_events_after_insert();

-- Tables for later phases — declared now so the schema is multi-phase coherent.
-- Code that touches these is in subsequent plans, not Phase 1.

create table blog_topic_suggestions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references blog_sites(id),
  batch_date date not null,
  rank smallint not null check (rank between 1 and 3),
  title text not null,
  angle text,
  sources jsonb not null default '{}'::jsonb,
  picked boolean not null default false,
  post_id uuid references blog_posts(id),
  created_at timestamptz not null default now(),
  unique (site_id, batch_date, rank)
);

create table blog_research_runs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references blog_sites(id),
  run_date date not null,
  sources_used text[] not null default '{}',
  raw_findings jsonb not null default '{}'::jsonb,
  selected_topic_ids uuid[] not null default '{}',
  cost_usd_cents int not null default 0,
  created_at timestamptz not null default now()
);

create table blog_images (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references blog_sites(id),
  blob_url text not null,
  mime text,
  width int, height int,
  uploaded_by uuid,
  file_hash text unique,
  vision_tags text[] not null default '{}',
  vision_caption text,
  embedding vector(768),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table blog_image_usages (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references blog_posts(id),
  image_id uuid not null references blog_images(id),
  used_at timestamptz not null default now()
);

create table blog_corrections (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references blog_posts(id),
  site_id uuid not null references blog_sites(id),
  field text not null,
  before_text text,
  after_text text,
  diff_summary text,
  rule_extracted text,
  applies_to_site_only boolean not null default false,
  status blog_correction_status not null default 'proposed',
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table blog_style_rules (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references blog_sites(id),
  rule text not null,
  source_correction_id uuid references blog_corrections(id),
  weight smallint not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_applied_at timestamptz
);
```

- [ ] **Step 2: Apply migration via Supabase MCP (per LE convention; never raw psql to prod)**

Apply to dev first, then staging, then prod. After each:

Run: `npm run tsx scripts/doctor.ts`
Expected: no schema-drift warnings; no doctor errors.

- [ ] **Step 3: Verify schema**

Run via Supabase MCP `list_tables`:
Expected: `blog_sites`, `blog_posts`, `blog_jobs`, `blog_topic_suggestions`, `blog_research_runs`, `blog_images`, `blog_image_usages`, `blog_corrections`, `blog_style_rules` all present. `cost_events` has new `post_id` column.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/048_blog_engine.sql
git commit -m "feat(blog): migration 048 — blog engine schema"
```

---

## Task 2: Shared types

**Files:**
- Create: `lib/blog-engine/types.ts`

- [ ] **Step 1: Write the types**

```ts
// lib/blog-engine/types.ts

export type BlogPostState =
  | 'research_due' | 'topics_proposed' | 'topic_picked'
  | 'draft_due' | 'draft_ready' | 'awaiting_approval'
  | 'publish_due' | 'publishing' | 'live'
  | 'edit_pending' | 'editing' | 'quarantined';

export type BlogJobKind =
  | 'research' | 'distill_topics' | 'draft' | 'image_match'
  | 'publish' | 'edit' | 'fetch_taxonomy' | 'distill_correction';

export type BlogJobState = 'queued' | 'running' | 'done' | 'failed';

export interface BlogSite {
  id: string;
  name: string;
  host_kind: 'sierra' | 'agent_fire';
  base_url: string;
  bot_credentials_ref: string | null;
  default_author_id: string | null;
  default_category_id: string | null;
  taxonomy_cache: { authors?: TaxonomyOption[]; categories?: TaxonomyOption[] };
  browserbase_context_id: string | null;
  active: boolean;
  created_at: string;
}

export interface TaxonomyOption {
  id: string;       // option value attribute
  label: string;    // visible text
}

export interface BlogPost {
  id: string;
  site_id: string;
  state: BlogPostState;
  title: string;
  slug: string | null;
  body_html: string;
  meta_title: string | null;
  meta_description: string | null;
  meta_tags: string[];
  image_id: string | null;
  author_label: string | null;
  category_label: string | null;
  external_post_url: string | null;
  external_post_id: string | null;
  publish_at: string | null;
  regen_count: number;
  cost_usd_cents: number;
  created_at: string;
  updated_at: string;
}

export interface BlogJob {
  id: string;
  post_id: string | null;
  site_id: string;
  kind: BlogJobKind;
  state: BlogJobState;
  attempts: number;
  last_error: string | null;
  browserbase_session_id: string | null;
  replay_url: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/blog-engine/types.ts
git commit -m "feat(blog): shared types"
```

---

## Task 3: Cost helper

**Files:**
- Create: `lib/blog-engine/cost.ts`
- Create: `lib/blog-engine/cost.test.ts`

LE's existing `cost_events` insert pattern uses the post-2026-04-28 explicit `{error: costErr}` style. This wrapper enforces it for blog stages.

- [ ] **Step 1: Write the failing test**

```ts
// lib/blog-engine/cost.test.ts
import { describe, it, expect, vi } from 'vitest';
import { recordBlogCost } from './cost';

describe('recordBlogCost', () => {
  it('inserts a cost_events row with the right stage and post_id', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: () => ({ insert }) } as any;

    await recordBlogCost(supabase, {
      stage: 'blog_publish_browser',
      cost_usd_cents: 8,
      post_id: 'post-123',
      site_id: 'site-1',
      provider: 'browserbase',
      meta: { session_id: 'sess-abc' },
    });

    expect(insert).toHaveBeenCalledWith([{
      stage: 'blog_publish_browser',
      cost_usd_cents: 8,
      post_id: 'post-123',
      site_id: 'site-1',
      provider: 'browserbase',
      meta: { session_id: 'sess-abc' },
    }]);
  });

  it('throws when supabase reports an error (no silent failure)', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
    const supabase = { from: () => ({ insert }) } as any;

    await expect(
      recordBlogCost(supabase, {
        stage: 'blog_publish_browser',
        cost_usd_cents: 8,
        post_id: 'post-123',
        site_id: 'site-1',
        provider: 'browserbase',
      }),
    ).rejects.toThrow(/boom/);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm run vitest run lib/blog-engine/cost.test.ts`
Expected: FAIL — `cost.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
// lib/blog-engine/cost.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type BlogCostStage =
  | 'blog_research'
  | 'blog_topic_distill'
  | 'blog_draft'
  | 'blog_regen'
  | 'blog_rewrite'
  | 'blog_image_tag'
  | 'blog_correction_distill'
  | 'blog_publish_browser';

export interface BlogCostInput {
  stage: BlogCostStage;
  cost_usd_cents: number;
  post_id: string | null;
  site_id: string;
  provider: string;
  meta?: Record<string, unknown>;
}

export async function recordBlogCost(
  supabase: SupabaseClient,
  input: BlogCostInput,
): Promise<void> {
  const { error: costErr } = await supabase
    .from('cost_events')
    .insert([{
      stage: input.stage,
      cost_usd_cents: input.cost_usd_cents,
      post_id: input.post_id,
      site_id: input.site_id,
      provider: input.provider,
      meta: input.meta ?? {},
    }]);
  if (costErr) {
    throw new Error(`recordBlogCost failed: ${costErr.message}`);
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm run vitest run lib/blog-engine/cost.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/blog-engine/cost.ts lib/blog-engine/cost.test.ts
git commit -m "feat(blog): cost helper with explicit error propagation"
```

---

## Task 4: Browserbase wrapper

**Files:**
- Create: `lib/blog-engine/browserbase.ts`

Adds `@browserbasehq/sdk` and `playwright-core` if not present.

- [ ] **Step 1: Add dependencies**

Run:
```bash
npm install @browserbasehq/sdk playwright-core
```

- [ ] **Step 2: Implement the wrapper**

```ts
// lib/blog-engine/browserbase.ts
import Browserbase from '@browserbasehq/sdk';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });

export interface RunInSessionResult<T> {
  result: T;
  sessionId: string;
  replayUrl: string;
}

export interface SessionRunArgs {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  sessionId: string;
}

export async function getOrCreatePersistentContextId(
  existing: string | null,
): Promise<string> {
  if (existing) return existing;
  const ctx = await bb.contexts.create({ projectId: process.env.BROWSERBASE_PROJECT_ID! });
  return ctx.id;
}

export async function runInSession<T>(
  contextId: string,
  fn: (args: SessionRunArgs) => Promise<T>,
): Promise<RunInSessionResult<T>> {
  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserSettings: {
      context: { id: contextId, persist: true },
      viewport: { width: 1280, height: 800 },
    },
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  // Reuse the default context that comes with the session.
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const result = await fn({ browser, context, page, sessionId: session.id });
    return {
      result,
      sessionId: session.id,
      replayUrl: `https://browserbase.com/sessions/${session.id}`,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
```

- [ ] **Step 3: Verify TS compiles**

Run: `npm run tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/blog-engine/browserbase.ts package.json package-lock.json
git commit -m "feat(blog): browserbase wrapper for persistent-context runs"
```

---

## Task 5: Sierra selectors module

**Files:**
- Create: `lib/blog-engine/publishers/sierra/selectors.ts`
- Create: `lib/blog-engine/publishers/sierra/selectors.test.ts`

Centralizes every selector so a Sierra UI change is one file.

- [ ] **Step 1: Write the failing test (snapshot of constants)**

```ts
// lib/blog-engine/publishers/sierra/selectors.test.ts
import { describe, it, expect } from 'vitest';
import { SIERRA_SELECTORS, SIERRA_PATHS } from './selectors';

describe('Sierra selectors', () => {
  it('declares every selector the publish flow needs', () => {
    expect(Object.keys(SIERRA_SELECTORS).sort()).toEqual([
      'authorSelect',
      'bodyHtmlSourceToggle',
      'bodyHtmlTextarea',
      'categorySelect',
      'createPostButton',
      'editButton',
      'imageFileInput',
      'loginPasswordInput',
      'loginSubmitButton',
      'loginUsernameInput',
      'metaDescriptionInput',
      'metaTagsInput',
      'metaTitleInput',
      'publishButton',
      'publishSuccessIndicator',
      'titleInput',
      'updateButton',
    ].sort());
  });

  it('has the canonical Sierra paths', () => {
    expect(SIERRA_PATHS.blogManager).toBe('/blog-manager.aspx');
    expect(SIERRA_PATHS.login).toBe('/login.aspx');
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm run vitest run lib/blog-engine/publishers/sierra/selectors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/blog-engine/publishers/sierra/selectors.ts
//
// Selectors are best-guess starting points. The first publish run will reveal
// any that need tuning; update here, never inline in the click-path files.

export const SIERRA_PATHS = {
  blogManager: '/blog-manager.aspx',
  login: '/login.aspx',
} as const;

export const SIERRA_SELECTORS = {
  // Login
  loginUsernameInput: 'input[name="Username"], input[type="email"]',
  loginPasswordInput: 'input[name="Password"], input[type="password"]',
  loginSubmitButton: 'button[type="submit"], input[type="submit"]',

  // Blog manager
  createPostButton: 'a:has-text("Create Blog Post"), button:has-text("Create Blog Post")',
  editButton: 'a:has-text("Edit"):visible',

  // Post form
  titleInput: 'input[name*="Title"]:not([name*="Meta"])',
  imageFileInput: 'input[type="file"]',
  bodyHtmlSourceToggle: 'a:has-text("Source"), button:has-text("HTML")',
  bodyHtmlTextarea: 'textarea[name*="Body"], textarea.html-source',
  authorSelect: 'select[name*="Author"]',
  categorySelect: 'select[name*="Category"]',
  metaTitleInput: 'input[name*="MetaTitle"]',
  metaDescriptionInput: 'textarea[name*="MetaDescription"], input[name*="MetaDescription"]',
  metaTagsInput: 'input[name*="MetaTags"], input[name*="Keywords"]',

  // Submit
  publishButton: 'button:has-text("Publish"), input[value="Publish"]',
  updateButton: 'button:has-text("Update"), input[value="Update"]',
  publishSuccessIndicator: 'text=/successfully|saved|published/i',
} as const;

export type SierraSelectorKey = keyof typeof SIERRA_SELECTORS;
```

- [ ] **Step 4: Run, expect pass**

Run: `npm run vitest run lib/blog-engine/publishers/sierra/selectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/blog-engine/publishers/sierra/
git commit -m "feat(blog): Sierra selector + path constants"
```

---

## Task 6: Publisher interface

**Files:**
- Create: `lib/blog-engine/publishers/types.ts`

- [ ] **Step 1: Implement**

```ts
// lib/blog-engine/publishers/types.ts
import type { BlogPost, TaxonomyOption } from '../types';

export interface PublishResult {
  external_post_url: string;
  external_post_id: string | null;
}

export interface EditResult {
  external_post_url: string;
}

export interface TaxonomyResult {
  authors: TaxonomyOption[];
  categories: TaxonomyOption[];
}

export interface Publisher {
  publish(post: BlogPost, opts: PublisherOpts): Promise<PublishResult>;
  edit(post: BlogPost, opts: PublisherOpts): Promise<EditResult>;
  fetchTaxonomy(opts: PublisherOpts): Promise<TaxonomyResult>;
}

export interface PublisherOpts {
  baseUrl: string;
  username: string;
  password: string;
  contextId: string;
}
```

- [ ] **Step 2: Verify**

Run: `npm run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/blog-engine/publishers/types.ts
git commit -m "feat(blog): Publisher interface"
```

---

## Task 7: Sierra auth helper

**Files:**
- Create: `lib/blog-engine/publishers/sierra/auth.ts`

Pure helper invoked from inside `runInSession`. Idempotent — if already signed in, returns immediately.

- [ ] **Step 1: Implement**

```ts
// lib/blog-engine/publishers/sierra/auth.ts
import type { Page } from 'playwright-core';
import { SIERRA_PATHS, SIERRA_SELECTORS } from './selectors';

export async function ensureSignedIn(
  page: Page,
  baseUrl: string,
  username: string,
  password: string,
): Promise<void> {
  // If we're already on a page that has the blog manager link, we're in.
  // Otherwise, navigate to the blog manager and detect a redirect to login.
  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: 'domcontentloaded' });

  const onLogin = page.url().toLowerCase().includes('login');
  if (!onLogin) return;

  await page.fill(SIERRA_SELECTORS.loginUsernameInput, username);
  await page.fill(SIERRA_SELECTORS.loginPasswordInput, password);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click(SIERRA_SELECTORS.loginSubmitButton),
  ]);

  // After login, navigate again to confirm we land on blog manager.
  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: 'domcontentloaded' });
  if (page.url().toLowerCase().includes('login')) {
    throw new Error('Sierra login did not stick — credentials wrong or 2FA enabled?');
  }
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `npm run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/blog-engine/publishers/sierra/auth.ts
git commit -m "feat(blog): Sierra sign-in helper"
```

---

## Task 8: Sierra taxonomy fetch

**Files:**
- Create: `lib/blog-engine/publishers/sierra/taxonomy.ts`

- [ ] **Step 1: Implement**

```ts
// lib/blog-engine/publishers/sierra/taxonomy.ts
import type { Page } from 'playwright-core';
import type { TaxonomyOption } from '../../types';
import type { TaxonomyResult } from '../types';
import { SIERRA_PATHS, SIERRA_SELECTORS } from './selectors';
import { ensureSignedIn } from './auth';

export async function fetchTaxonomy(
  page: Page,
  baseUrl: string,
  username: string,
  password: string,
): Promise<TaxonomyResult> {
  await ensureSignedIn(page, baseUrl, username, password);

  // The Author/Category selects only render on the Create form, not the list.
  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: 'domcontentloaded' });
  await page.click(SIERRA_SELECTORS.createPostButton);
  await page.waitForSelector(SIERRA_SELECTORS.titleInput);

  const authors = await readSelectOptions(page, SIERRA_SELECTORS.authorSelect);
  const categories = await readSelectOptions(page, SIERRA_SELECTORS.categorySelect);

  return { authors, categories };
}

async function readSelectOptions(page: Page, selector: string): Promise<TaxonomyOption[]> {
  return page.$$eval(`${selector} option`, (opts) =>
    (opts as HTMLOptionElement[])
      .filter(o => o.value && o.value !== '0')
      .map(o => ({ id: o.value, label: o.textContent?.trim() ?? '' })),
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/blog-engine/publishers/sierra/taxonomy.ts
git commit -m "feat(blog): Sierra taxonomy scrape"
```

---

## Task 9: Sierra publish click path

**Files:**
- Create: `lib/blog-engine/publishers/sierra/publish.ts`

- [ ] **Step 1: Implement**

```ts
// lib/blog-engine/publishers/sierra/publish.ts
import type { Page } from 'playwright-core';
import type { BlogPost } from '../../types';
import type { PublishResult } from '../types';
import { SIERRA_PATHS, SIERRA_SELECTORS } from './selectors';
import { ensureSignedIn } from './auth';

export interface SierraPublishInput {
  baseUrl: string;
  username: string;
  password: string;
  post: BlogPost;
  imageBuffer: Buffer | null;
  imageFilename: string | null;
}

export async function sierraPublish(
  page: Page,
  input: SierraPublishInput,
): Promise<PublishResult> {
  const { baseUrl, username, password, post, imageBuffer, imageFilename } = input;
  await ensureSignedIn(page, baseUrl, username, password);
  await page.goto(`${baseUrl}${SIERRA_PATHS.blogManager}`, { waitUntil: 'domcontentloaded' });
  await page.click(SIERRA_SELECTORS.createPostButton);
  await page.waitForSelector(SIERRA_SELECTORS.titleInput);

  await page.fill(SIERRA_SELECTORS.titleInput, post.title);

  if (imageBuffer && imageFilename) {
    const fileInput = await page.$(SIERRA_SELECTORS.imageFileInput);
    if (!fileInput) throw new Error('Sierra image file input not found');
    await fileInput.setInputFiles({
      name: imageFilename,
      mimeType: 'image/jpeg',
      buffer: imageBuffer,
    });
  }

  // Switch the WYSIWYG into HTML/Source mode, then paste body_html.
  const sourceToggle = await page.$(SIERRA_SELECTORS.bodyHtmlSourceToggle);
  if (sourceToggle) await sourceToggle.click();
  await page.fill(SIERRA_SELECTORS.bodyHtmlTextarea, post.body_html);

  if (post.author_label) {
    await page.selectOption(SIERRA_SELECTORS.authorSelect, { label: post.author_label });
  }
  if (post.category_label) {
    await page.selectOption(SIERRA_SELECTORS.categorySelect, { label: post.category_label });
  }
  if (post.meta_title) await page.fill(SIERRA_SELECTORS.metaTitleInput, post.meta_title);
  if (post.meta_description)
    await page.fill(SIERRA_SELECTORS.metaDescriptionInput, post.meta_description);
  if (post.meta_tags?.length)
    await page.fill(SIERRA_SELECTORS.metaTagsInput, post.meta_tags.join(', '));

  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click(SIERRA_SELECTORS.publishButton),
  ]);

  await page.waitForSelector(SIERRA_SELECTORS.publishSuccessIndicator, { timeout: 30_000 });

  // After publish, Sierra typically redirects to the post's edit page or the
  // public URL. Capture whichever URL we end up on.
  const finalUrl = page.url();
  const idMatch = finalUrl.match(/[?&](?:id|postId)=(\d+)/i);

  return {
    external_post_url: finalUrl,
    external_post_id: idMatch?.[1] ?? null,
  };
}
```

- [ ] **Step 2: Verify**

Run: `npm run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/blog-engine/publishers/sierra/publish.ts
git commit -m "feat(blog): Sierra publish click path"
```

---

## Task 10: Sierra edit click path

**Files:**
- Create: `lib/blog-engine/publishers/sierra/edit.ts`

- [ ] **Step 1: Implement**

```ts
// lib/blog-engine/publishers/sierra/edit.ts
import type { Page } from 'playwright-core';
import type { BlogPost } from '../../types';
import type { EditResult } from '../types';
import { SIERRA_SELECTORS } from './selectors';
import { ensureSignedIn } from './auth';

export type EditableField =
  | 'title' | 'body_html'
  | 'meta_title' | 'meta_description' | 'meta_tags'
  | 'author' | 'category';

export interface SierraEditInput {
  baseUrl: string;        // used by ensureSignedIn for the login redirect probe
  username: string;
  password: string;
  post: BlogPost;
  fieldsChanged: Set<EditableField>;
}

export async function sierraEdit(
  page: Page,
  input: SierraEditInput,
): Promise<EditResult> {
  const { baseUrl, username, password, post, fieldsChanged } = input;
  if (!post.external_post_url) throw new Error('Edit requires post.external_post_url');

  await ensureSignedIn(page, baseUrl, username, password);
  await page.goto(post.external_post_url, { waitUntil: 'domcontentloaded' });

  // If we landed on a public view rather than the admin form, click Edit.
  const editButton = await page.$(SIERRA_SELECTORS.editButton);
  if (editButton) {
    await editButton.click();
    await page.waitForSelector(SIERRA_SELECTORS.titleInput);
  }

  if (fieldsChanged.has('title')) {
    await page.fill(SIERRA_SELECTORS.titleInput, post.title);
  }
  if (fieldsChanged.has('body_html')) {
    const sourceToggle = await page.$(SIERRA_SELECTORS.bodyHtmlSourceToggle);
    if (sourceToggle) await sourceToggle.click();
    await page.fill(SIERRA_SELECTORS.bodyHtmlTextarea, post.body_html);
  }
  if (fieldsChanged.has('meta_title') && post.meta_title != null) {
    await page.fill(SIERRA_SELECTORS.metaTitleInput, post.meta_title);
  }
  if (fieldsChanged.has('meta_description') && post.meta_description != null) {
    await page.fill(SIERRA_SELECTORS.metaDescriptionInput, post.meta_description);
  }
  if (fieldsChanged.has('meta_tags')) {
    await page.fill(SIERRA_SELECTORS.metaTagsInput, post.meta_tags.join(', '));
  }
  if (fieldsChanged.has('author') && post.author_label) {
    await page.selectOption(SIERRA_SELECTORS.authorSelect, { label: post.author_label });
  }
  if (fieldsChanged.has('category') && post.category_label) {
    await page.selectOption(SIERRA_SELECTORS.categorySelect, { label: post.category_label });
  }

  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click(SIERRA_SELECTORS.updateButton),
  ]);
  await page.waitForSelector(SIERRA_SELECTORS.publishSuccessIndicator, { timeout: 30_000 });

  return { external_post_url: page.url() };
}
```

- [ ] **Step 2: Verify**

Run: `npm run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/blog-engine/publishers/sierra/edit.ts
git commit -m "feat(blog): Sierra edit click path"
```

---

## Task 11: Sierra Publisher composition

**Files:**
- Create: `lib/blog-engine/publishers/sierra/index.ts`

- [ ] **Step 1: Implement**

```ts
// lib/blog-engine/publishers/sierra/index.ts
import type { Publisher, PublisherOpts, PublishResult, EditResult, TaxonomyResult } from '../types';
import type { BlogPost } from '../../types';
import { runInSession } from '../../browserbase';
import { fetchTaxonomy } from './taxonomy';
import { sierraPublish, type SierraPublishInput } from './publish';
import { sierraEdit, type SierraEditInput, type EditableField } from './edit';

export interface SierraPublisherDeps {
  loadImage: (post: BlogPost) => Promise<{ buffer: Buffer; filename: string } | null>;
  diffFields: (post: BlogPost) => Promise<Set<EditableField>>;
}

export function createSierraPublisher(deps: SierraPublisherDeps): Publisher & {
  lastSession?: { sessionId: string; replayUrl: string };
} {
  const publisher: any = {
    async publish(post: BlogPost, opts: PublisherOpts): Promise<PublishResult> {
      const image = await deps.loadImage(post);
      const input: Omit<SierraPublishInput, 'page'> = {
        baseUrl: opts.baseUrl,
        username: opts.username,
        password: opts.password,
        post,
        imageBuffer: image?.buffer ?? null,
        imageFilename: image?.filename ?? null,
      };
      const { result, sessionId, replayUrl } = await runInSession(opts.contextId, async ({ page }) =>
        sierraPublish(page, input),
      );
      publisher.lastSession = { sessionId, replayUrl };
      return result;
    },

    async edit(post: BlogPost, opts: PublisherOpts): Promise<EditResult> {
      const fieldsChanged = await deps.diffFields(post);
      const input: Omit<SierraEditInput, 'page'> = {
        baseUrl: opts.baseUrl,
        username: opts.username,
        password: opts.password,
        post,
        fieldsChanged,
      };
      const { result, sessionId, replayUrl } = await runInSession(opts.contextId, async ({ page }) =>
        sierraEdit(page, input),
      );
      publisher.lastSession = { sessionId, replayUrl };
      return result;
    },

    async fetchTaxonomy(opts: PublisherOpts): Promise<TaxonomyResult> {
      const { result, sessionId, replayUrl } = await runInSession(opts.contextId, async ({ page }) =>
        fetchTaxonomy(page, opts.baseUrl, opts.username, opts.password),
      );
      publisher.lastSession = { sessionId, replayUrl };
      return result;
    },
  };
  return publisher;
}
```

- [ ] **Step 2: Verify**

Run: `npm run tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/blog-engine/publishers/sierra/index.ts
git commit -m "feat(blog): Sierra publisher composition"
```

---

## Task 12: Generic job runner

**Files:**
- Create: `lib/blog-engine/jobs/runner.ts`
- Create: `lib/blog-engine/jobs/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/blog-engine/jobs/runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runOneJob, type JobHandler } from './runner';
import type { BlogJob } from '../types';

const makeJob = (overrides: Partial<BlogJob> = {}): BlogJob => ({
  id: 'job-1',
  post_id: null,
  site_id: 'site-1',
  kind: 'fetch_taxonomy',
  state: 'queued',
  attempts: 0,
  last_error: null,
  browserbase_session_id: null,
  replay_url: null,
  payload: {},
  result: null,
  scheduled_at: new Date().toISOString(),
  started_at: null,
  finished_at: null,
  created_at: new Date().toISOString(),
  ...overrides,
});

describe('runOneJob', () => {
  it('marks done on handler success', async () => {
    const job = makeJob();
    const update = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: () => ({ update: (v: any) => ({ eq: () => update(v) }) }) } as any;
    const handler: JobHandler = vi.fn().mockResolvedValue({ result: { ok: true } });

    await runOneJob(supabase, job, { fetch_taxonomy: handler });

    expect(handler).toHaveBeenCalledWith({ supabase, job });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'done',
      result: { ok: true },
    }));
  });

  it('records error and retries up to 3 times', async () => {
    const job = makeJob({ attempts: 2 });
    const update = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: () => ({ update: (v: any) => ({ eq: () => update(v) }) }) } as any;
    const handler: JobHandler = vi.fn().mockRejectedValue(new Error('boom'));

    await runOneJob(supabase, job, { fetch_taxonomy: handler });

    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'failed',                    // attempts now 3, exceeded
      last_error: 'boom',
    }));
  });

  it('keeps job queued for retry under attempt cap', async () => {
    const job = makeJob({ attempts: 0 });
    const update = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: () => ({ update: (v: any) => ({ eq: () => update(v) }) }) } as any;
    const handler: JobHandler = vi.fn().mockRejectedValue(new Error('boom'));

    await runOneJob(supabase, job, { fetch_taxonomy: handler });

    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'queued',
      attempts: 1,
      last_error: 'boom',
    }));
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npm run vitest run lib/blog-engine/jobs/runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/blog-engine/jobs/runner.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlogJob, BlogJobKind } from '../types';

export interface JobHandlerArgs {
  supabase: SupabaseClient;
  job: BlogJob;
}

export interface JobHandlerResult {
  result?: Record<string, unknown>;
  browserbase_session_id?: string;
  replay_url?: string;
}

export type JobHandler = (args: JobHandlerArgs) => Promise<JobHandlerResult>;

export type Handlers = Partial<Record<BlogJobKind, JobHandler>>;

const MAX_ATTEMPTS = 3;

export async function runOneJob(
  supabase: SupabaseClient,
  job: BlogJob,
  handlers: Handlers,
): Promise<void> {
  const handler = handlers[job.kind];
  if (!handler) {
    await updateJob(supabase, job.id, {
      state: 'failed',
      last_error: `no handler for kind ${job.kind}`,
      finished_at: new Date().toISOString(),
    });
    return;
  }

  await updateJob(supabase, job.id, {
    state: 'running',
    attempts: job.attempts + 1,
    started_at: new Date().toISOString(),
  });

  try {
    const out = await handler({ supabase, job });
    await updateJob(supabase, job.id, {
      state: 'done',
      result: out.result ?? null,
      browserbase_session_id: out.browserbase_session_id ?? null,
      replay_url: out.replay_url ?? null,
      finished_at: new Date().toISOString(),
    });
  } catch (e: any) {
    const newAttempts = job.attempts + 1;
    const exhausted = newAttempts >= MAX_ATTEMPTS;
    await updateJob(supabase, job.id, {
      state: exhausted ? 'failed' : 'queued',
      attempts: newAttempts,
      last_error: e?.message ?? String(e),
      finished_at: exhausted ? new Date().toISOString() : null,
      // requeue with a small backoff
      scheduled_at: exhausted
        ? new Date().toISOString()
        : new Date(Date.now() + 30_000 * newAttempts).toISOString(),
    });
  }
}

async function updateJob(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('blog_jobs').update(patch).eq('id', id);
  if (error) throw new Error(`updateJob(${id}) failed: ${error.message}`);
}

export async function tick(
  supabase: SupabaseClient,
  handlers: Handlers,
  limit = 5,
): Promise<{ processed: number }> {
  const { data, error } = await supabase
    .from('blog_jobs')
    .select('*')
    .eq('state', 'queued')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`tick: select failed: ${error.message}`);

  for (const j of (data ?? []) as BlogJob[]) {
    await runOneJob(supabase, j, handlers);
  }
  return { processed: data?.length ?? 0 };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm run vitest run lib/blog-engine/jobs/runner.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/blog-engine/jobs/
git commit -m "feat(blog): generic job runner with TDD"
```

---

## Task 13: Job handlers + registry

**Files:**
- Create: `lib/blog-engine/jobs/handlers/fetch-taxonomy.ts`
- Create: `lib/blog-engine/jobs/handlers/publish.ts`
- Create: `lib/blog-engine/jobs/handlers/edit.ts`
- Create: `lib/blog-engine/jobs/handlers/index.ts`

- [ ] **Step 1: Implement fetch-taxonomy handler**

```ts
// lib/blog-engine/jobs/handlers/fetch-taxonomy.ts
import type { JobHandler } from '../runner';
import { createSierraPublisher } from '../../publishers/sierra';
import { getOrCreatePersistentContextId } from '../../browserbase';
import { resolveSiteOpts } from './_site-opts';

export const fetchTaxonomyHandler: JobHandler = async ({ supabase, job }) => {
  const { site, opts } = await resolveSiteOpts(supabase, job.site_id);
  const contextId = await getOrCreatePersistentContextId(site.browserbase_context_id);
  if (contextId !== site.browserbase_context_id) {
    await supabase.from('blog_sites').update({ browserbase_context_id: contextId }).eq('id', site.id);
  }
  const publisher = createSierraPublisher({
    loadImage: async () => null,
    diffFields: async () => new Set(),
  });
  const taxonomy = await publisher.fetchTaxonomy({ ...opts, contextId });
  await supabase.from('blog_sites').update({ taxonomy_cache: taxonomy }).eq('id', site.id);
  const last = (publisher as any).lastSession ?? {};
  return {
    result: { authors: taxonomy.authors.length, categories: taxonomy.categories.length },
    browserbase_session_id: last.sessionId,
    replay_url: last.replayUrl,
  };
};
```

- [ ] **Step 2: Implement publish handler**

```ts
// lib/blog-engine/jobs/handlers/publish.ts
import type { JobHandler } from '../runner';
import { createSierraPublisher } from '../../publishers/sierra';
import { getOrCreatePersistentContextId } from '../../browserbase';
import { resolveSiteOpts } from './_site-opts';
import { recordBlogCost } from '../../cost';

export const publishHandler: JobHandler = async ({ supabase, job }) => {
  if (!job.post_id) throw new Error('publish job requires post_id');

  const { data: post, error: postErr } = await supabase
    .from('blog_posts').select('*').eq('id', job.post_id).single();
  if (postErr || !post) throw new Error(`publish: post ${job.post_id} not found`);

  const { site, opts } = await resolveSiteOpts(supabase, job.site_id);
  const contextId = await getOrCreatePersistentContextId(site.browserbase_context_id);
  if (contextId !== site.browserbase_context_id) {
    await supabase.from('blog_sites').update({ browserbase_context_id: contextId }).eq('id', site.id);
  }

  // Phase 1: no image library yet; loadImage always returns null.
  const publisher = createSierraPublisher({
    loadImage: async () => null,
    diffFields: async () => new Set(),
  });

  await supabase.from('blog_posts').update({ state: 'publishing' }).eq('id', post.id);

  const result = await publisher.publish(post, { ...opts, contextId });

  await supabase.from('blog_posts').update({
    state: 'live',
    external_post_url: result.external_post_url,
    external_post_id: result.external_post_id,
    updated_at: new Date().toISOString(),
  }).eq('id', post.id);

  await recordBlogCost(supabase, {
    stage: 'blog_publish_browser',
    cost_usd_cents: 10, // approximate; reconciled monthly
    post_id: post.id,
    site_id: site.id,
    provider: 'browserbase',
    meta: { session_id: (publisher as any).lastSession?.sessionId },
  });

  const last = (publisher as any).lastSession ?? {};
  return {
    result: { external_post_url: result.external_post_url },
    browserbase_session_id: last.sessionId,
    replay_url: last.replayUrl,
  };
};
```

- [ ] **Step 3: Implement edit handler**

```ts
// lib/blog-engine/jobs/handlers/edit.ts
import type { JobHandler } from '../runner';
import type { EditableField } from '../../publishers/sierra/edit';
import { createSierraPublisher } from '../../publishers/sierra';
import { getOrCreatePersistentContextId } from '../../browserbase';
import { resolveSiteOpts } from './_site-opts';
import { recordBlogCost } from '../../cost';

export const editHandler: JobHandler = async ({ supabase, job }) => {
  if (!job.post_id) throw new Error('edit job requires post_id');

  const fieldsChanged = new Set<EditableField>(
    ((job.payload?.fields_changed as string[]) ?? []) as EditableField[],
  );
  if (fieldsChanged.size === 0) {
    return { result: { skipped: 'no fields changed' } };
  }

  const { data: post, error: postErr } = await supabase
    .from('blog_posts').select('*').eq('id', job.post_id).single();
  if (postErr || !post) throw new Error(`edit: post ${job.post_id} not found`);

  const { site, opts } = await resolveSiteOpts(supabase, job.site_id);
  const contextId = await getOrCreatePersistentContextId(site.browserbase_context_id);

  const publisher = createSierraPublisher({
    loadImage: async () => null,
    diffFields: async () => fieldsChanged,
  });

  await supabase.from('blog_posts').update({ state: 'editing' }).eq('id', post.id);

  const result = await publisher.edit(post, { ...opts, contextId });

  await supabase.from('blog_posts').update({
    state: 'live',
    external_post_url: result.external_post_url,
    updated_at: new Date().toISOString(),
  }).eq('id', post.id);

  await recordBlogCost(supabase, {
    stage: 'blog_publish_browser',
    cost_usd_cents: 10,
    post_id: post.id,
    site_id: site.id,
    provider: 'browserbase',
    meta: { kind: 'edit', session_id: (publisher as any).lastSession?.sessionId },
  });

  const last = (publisher as any).lastSession ?? {};
  return { result, browserbase_session_id: last.sessionId, replay_url: last.replayUrl };
};
```

- [ ] **Step 4: Site-opts helper + handler registry**

```ts
// lib/blog-engine/jobs/handlers/_site-opts.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlogSite } from '../../types';
import type { PublisherOpts } from '../../publishers/types';

export async function resolveSiteOpts(
  supabase: SupabaseClient,
  siteId: string,
): Promise<{ site: BlogSite; opts: Omit<PublisherOpts, 'contextId'> }> {
  const { data, error } = await supabase.from('blog_sites').select('*').eq('id', siteId).single();
  if (error || !data) throw new Error(`site ${siteId} not found`);
  const site = data as BlogSite;
  if (site.host_kind !== 'sierra') throw new Error(`unsupported host ${site.host_kind}`);
  const username = process.env.SIERRA_HELGEMO_USERNAME;
  const password = process.env.SIERRA_HELGEMO_PASSWORD;
  if (!username || !password) throw new Error('Sierra creds env vars missing');
  return { site, opts: { baseUrl: site.base_url, username, password } };
}
```

```ts
// lib/blog-engine/jobs/handlers/index.ts
import type { Handlers } from '../runner';
import { fetchTaxonomyHandler } from './fetch-taxonomy';
import { publishHandler } from './publish';
import { editHandler } from './edit';

export const handlers: Handlers = {
  fetch_taxonomy: fetchTaxonomyHandler,
  publish: publishHandler,
  edit: editHandler,
};
```

- [ ] **Step 5: Verify**

Run: `npm run tsc --noEmit && npx vitest run lib/blog-engine`
Expected: tsc clean, all blog-engine tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/blog-engine/jobs/handlers/
git commit -m "feat(blog): job handlers (fetch_taxonomy, publish, edit)"
```

---

## Task 14: Cron poller endpoint

**Files:**
- Create: `api/cron/poll-blog-jobs.ts`

- [ ] **Step 1: Implement**

```ts
// api/cron/poll-blog-jobs.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { tick } from '../../lib/blog-engine/jobs/runner';
import { handlers } from '../../lib/blog-engine/jobs/handlers';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.BLOG_CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }
  if (process.env.VERCEL_ENV !== 'production') {
    return res.status(200).json({ ok: true, skipped: 'non-prod' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const out = await tick(supabase, handlers);
  return res.status(200).json({ ok: true, ...out });
}
```

- [ ] **Step 2: Wire the cron in `vercel.json`**

Add to `vercel.json` `crons`:

```json
{
  "path": "/api/cron/poll-blog-jobs",
  "schedule": "* * * * *"
}
```

- [ ] **Step 3: Verify**

Run: `npm run tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/cron/poll-blog-jobs.ts vercel.json
git commit -m "feat(blog): cron poller for blog_jobs"
```

---

## Task 15: Manual enqueue API

**Files:**
- Create: `api/blog/jobs/enqueue.ts`

Lets us trigger a job by hand without writing SQL.

- [ ] **Step 1: Implement**

```ts
// api/blog/jobs/enqueue.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers.authorization !== `Bearer ${process.env.BLOG_CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }
  const { kind, site_id, post_id, payload } = req.body ?? {};
  if (!kind || !site_id) return res.status(400).json({ ok: false, error: 'kind and site_id required' });

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data, error } = await supabase
    .from('blog_jobs')
    .insert([{ kind, site_id, post_id: post_id ?? null, payload: payload ?? {} }])
    .select('id')
    .single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, job_id: data!.id });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run tsc --noEmit`
Expected: no errors.

```bash
git add api/blog/jobs/enqueue.ts
git commit -m "feat(blog): manual enqueue endpoint"
```

---

## Task 16: Seed-site script

**Files:**
- Create: `scripts/blog/seed-helgemo-site.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/blog/seed-helgemo-site.ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: existing } = await supabase
    .from('blog_sites')
    .select('id')
    .eq('host_kind', 'sierra')
    .eq('name', 'Helgemo Team')
    .maybeSingle();
  if (existing) {
    console.log('already seeded', existing.id);
    return;
  }
  const { data, error } = await supabase
    .from('blog_sites')
    .insert([{
      name: 'Helgemo Team',
      host_kind: 'sierra',
      base_url: process.env.SIERRA_HELGEMO_BASE_URL!,
      bot_credentials_ref: 'env:SIERRA_HELGEMO_*',
      active: true,
    }])
    .select('id')
    .single();
  if (error) throw error;
  console.log('seeded', data!.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run on dev tier**

Run:
```bash
npx tsx scripts/blog/seed-helgemo-site.ts
```
Expected: prints `seeded <uuid>`.

- [ ] **Step 3: Commit**

```bash
git add scripts/blog/seed-helgemo-site.ts
git commit -m "chore(blog): seed Helgemo Sierra site row"
```

---

## Task 17: Manual publish/edit drivers

**Files:**
- Create: `scripts/blog/manual-publish.ts`
- Create: `scripts/blog/manual-edit.ts`

- [ ] **Step 1: manual-publish**

```ts
// scripts/blog/manual-publish.ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: site } = await supabase
    .from('blog_sites').select('id').eq('host_kind', 'sierra').single();
  if (!site) throw new Error('no Sierra site row — run seed first');

  const { data: post, error: pErr } = await supabase
    .from('blog_posts').insert([{
      site_id: site.id,
      state: 'awaiting_approval',
      title: 'Phase 1 smoke test — please ignore',
      body_html: '<p>This is a hand-written smoke test for the blog engine.</p>',
      meta_title: 'Phase 1 smoke test',
      meta_description: 'Hand-written smoke test for the blog engine.',
      meta_tags: ['smoke','test'],
      author_label: process.env.SIERRA_DEFAULT_AUTHOR ?? null,
      category_label: process.env.SIERRA_DEFAULT_CATEGORY ?? null,
    }]).select('id').single();
  if (pErr) throw pErr;

  const { data: job, error: jErr } = await supabase
    .from('blog_jobs').insert([{
      site_id: site.id,
      post_id: post!.id,
      kind: 'publish',
      payload: {},
    }]).select('id').single();
  if (jErr) throw jErr;
  console.log('post', post!.id, 'job', job!.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: manual-edit**

```ts
// scripts/blog/manual-edit.ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const POST_ID = process.argv[2];
if (!POST_ID) { console.error('usage: manual-edit <post_id>'); process.exit(2); }

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const newBody = `<p>Edited at ${new Date().toISOString()}</p>`;
  const { error: uErr } = await supabase
    .from('blog_posts').update({ body_html: newBody }).eq('id', POST_ID);
  if (uErr) throw uErr;

  const { data: post } = await supabase
    .from('blog_posts').select('site_id').eq('id', POST_ID).single();
  if (!post) throw new Error('post not found');

  const { data: job, error: jErr } = await supabase
    .from('blog_jobs').insert([{
      site_id: post.site_id,
      post_id: POST_ID,
      kind: 'edit',
      payload: { fields_changed: ['body_html'] },
    }]).select('id').single();
  if (jErr) throw jErr;
  console.log('edit job', job!.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Commit**

```bash
git add scripts/blog/
git commit -m "chore(blog): manual publish + edit driver scripts"
```

---

## Task 18: End-to-end smoke run (verification, not code)

This is the gate that proves Phase 1 works. **Do not skip.**

- [ ] **Step 1: Set env vars in Vercel dev tier**

`BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `SIERRA_HELGEMO_USERNAME`, `SIERRA_HELGEMO_PASSWORD`, `SIERRA_HELGEMO_BASE_URL`, `BLOG_CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Mirror to local `credentials.env`.

- [ ] **Step 2: Apply migration 048 to dev tier**

Via Supabase MCP. Verify the 9 new tables + the `cost_events.post_id` column.

- [ ] **Step 3: Seed the Helgemo site row**

Run: `npm run tsx scripts/blog/seed-helgemo-site.ts`
Expected: prints `seeded <uuid>`.

- [ ] **Step 4: Run a fetch_taxonomy job locally**

```bash
curl -X POST http://localhost:3000/api/blog/jobs/enqueue \
  -H "Authorization: Bearer $BLOG_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"kind":"fetch_taxonomy","site_id":"<uuid>"}'
```

Then drive the runner locally (`tick()` once) via a one-off node REPL or by hitting the cron endpoint with `VERCEL_ENV=production` set in the request env (override locally).

Expected: `blog_sites.taxonomy_cache` populated with author + category options. The Browserbase replay URL recorded on the job row.

If selectors miss, look at the replay video, fix `selectors.ts`, re-run. Iterate.

- [ ] **Step 5: Run manual-publish**

```bash
npx tsx scripts/blog/manual-publish.ts
```
Wait ≤90s. Expected: `blog_posts.state = 'live'`, `external_post_url` populated, the post visible on the live Sierra blog.

- [ ] **Step 6: Run manual-edit**

```bash
npx tsx scripts/blog/manual-edit.ts <post_id>
```
Wait ≤90s. Expected: `state` returns to `live`, the post body on Sierra reflects the new timestamp.

- [ ] **Step 7: Cost-event check**

Query `cost_events` filtered by `post_id`. Expected: 2 rows with `stage='blog_publish_browser'` (one publish, one edit) with non-null `cost_usd_cents`.

- [ ] **Step 8: Update HANDOFF.md**

Per LE governance: every push to main updates `docs/HANDOFF.md`. Add a Phase 1 entry — what shipped, what didn't, gotchas (selector tuning, 2FA notes, etc.).

```bash
git add docs/HANDOFF.md
git commit -m "docs(blog): Phase 1 handoff entry"
```

- [ ] **Step 9: Promote dev → staging → main**

Per the 3-tier path: PR `feat/blog-phase-1 → dev`, merge with `--no-ff`, then `dev → staging`, then `staging → main`. Crons fire on prod only.

---

## Phase 1 Definition of Done

1. ✅ Migration 048 applied across all 3 tiers
2. ✅ Helgemo Sierra `blog_sites` row exists with non-null `browserbase_context_id` and populated `taxonomy_cache`
3. ✅ A hand-written post publishes to the live Sierra site within ~60s of `manual-publish.ts`
4. ✅ A subsequent `manual-edit.ts` updates the same post in place
5. ✅ Both runs leave a Browserbase replay URL on the `blog_jobs` row
6. ✅ Both runs write at least one `cost_events` row each, denormalized into `blog_posts.cost_usd_cents`
7. ✅ Cron poller is firing on prod (visible in Vercel logs every minute, no-op when nothing queued)
8. ✅ `docs/HANDOFF.md` updated with Phase 1 entry; this plan file moved or marked complete in `docs/plans/`

When all 8 are checked, Phase 1 is done. The next plan (image library + vision tagging) can start.

---

## Subsequent phases (referenced for orientation, not scoped here)

- **Phase 2:** Image library + Gemini vision auto-tagging + image-match algorithm.
- **Phase 3:** Daily research run (Gemini) + 3-suggestions distill.
- **Phase 4:** Claude draft generation + style-rules injection.
- **Phase 5:** `/dashboard/blog` portal UI (Today, Pipeline, Posts, Post detail with Tiptap, Image library, Sites, Jobs, Cost).
- **Phase 6:** Corrections capture + rule distillation + Accept/Edit/Discard UI (the learning loop).
- **Phase 7:** AgentFire publisher adapter.

Each gets its own plan once the prior phase ships.
