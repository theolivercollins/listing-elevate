# 2026-05-15 — Operator Studio Phase 1 + Glass design system

Branch: `feat/operator-studio` (off `dev`). Worktree: `.claude/worktrees/operator-studio`. Vercel preview: `https://listingelevate-git-feat-operator-studio-recasi.vercel.app/dashboard/studio`. ~29 commits. Not merged anywhere yet.

## What Oliver asked for

> "Clients will want me to make videos for their listings. They're not going to use the new order or new video feature — I'll do them myself using AI inside my platform and bill them like a monthly invoice. I need a way to really streamline that process within my platform so I can do it myself."

Translation: an internal "Operator Studio" surface — same pipeline, but ergonomics for me-as-producer rather than self-serve buyer. Then mid-session: "implement the Glass design file too, make it match." Then: "push to a preview link."

## How the session unfolded

1. **Brainstorm + cross-check.** Mapped the existing surfaces (Properties admin, Lab Listings, pipeline, cost_events, user_profiles brand fields), generated 10 ideas, asked Gemini 2.5 Pro for an independent 10, synthesized.
2. **Spec + plan.** Wrote `docs/specs/2026-05-15-operator-studio-design.md` (v1: defer brand-kit + preview-link + clip-swap to P2/P3). Wrote `docs/plans/2026-05-15-operator-studio-plan.md`.
3. **Gemini adversarial review (round 1).** Verdict: "Do not ship as-is." Key flaw: v1's Phase 1 produced unbranded videos with no in-tool delivery loop and no efficient revision path — a technical exercise, not a usable internal tool. Plus: playbooks fully built in P1 but never consumed until P2 (pure overhead). Plus: missing `property_previews.token` index, no integration test for invoice math, no explicit `crypto.randomBytes` token utility task.
4. **Spec v2.** Pulled brand-kit / preview-link / clip-swap into Phase 1. Pushed full playbooks (table + CRUD + UI + pipeline application) to Phase 2 (column-only stub kept in P1 schema). Added explicit token utility task. Added dedicated invoice-data integration test.
5. **Gemini adversarial review (round 2).** Verdict: "ship it." No new critical issues; recordPreviewView race correctly mitigated by Postgres function for atomic increment.
6. **Subagent-driven execution.** 20-task Phase 1 plan; one Sonnet implementer per task, two-stage review (spec compliance then code quality) on the heaviest commits, single-pass implement-only on the more mechanical ones to fit the session budget. 27 commits including the spec/plan, the migrations, all backend modules, all admin endpoints, full UI for all four Studio pages + the public preview viewer, the pipeline awareness pass, and the closing HANDOFF/PROJECT-STATE update.
7. **Migration application.** Oliver approved both 056 + 057 — applied via Supabase MCP. Schema is live in the shared prod Supabase.
8. **First push → Vercel build failed.** PostCSS rejected `flex-none;` as a bare property inside `studio-design.css:589`. The implementer left a Tailwind utility where a CSS shorthand belonged. Local `tsc --noEmit` didn't catch it because tsc doesn't run PostCSS. Fixed in `a22c2d4` (`flex: none;`).
9. **Design pass.** Fetched the Claude Design bundle (`https://api.anthropic.com/v1/design/h/4EmNfqjV3ckVTff1D-F0lg`) — gzipped React/JSX prototype + STYLE-GUIDE.md. Read the style guide top to bottom, dispatched one Sonnet implementer to re-skin all 8 Studio surfaces against the spec. Scoped tokens under `.studio-scope` (so the rest of the app is untouched).

## What's on the branch

### Migrations (both applied to Supabase)

- **`056_operator_studio.sql`** — `clients`, `property_previews`, `property_revision_notes` tables; `properties.order_mode` text default 'customer', `properties.client_id` uuid FK, `properties.ingest_source`, `properties.ingest_source_url`; partial index `idx_properties_order_mode_client` on operator-mode rows only; RLS enabled with no policies (service-role only); `increment_preview_view(p_token text)` Postgres function for atomic counter increment.
- **`057_operator_studio_scenes_followup.sql`** — `scenes.replaced_at` timestamptz; `scenes.room_type` text backfilled from `photos.room_type` via `scenes.photo_id`; `prompt_lab_listing_scene_iterations.room_type` text backfilled from parent scene row. Adds denormed `room_type` so `swapClip()` doesn't need a JOIN at the hot path.

### Backend modules (`lib/operator-studio/`)

| File | Purpose | Tests |
|---|---|---|
| `clients.ts` | CRUD wrapper (list with archive filter, get, create, update, archive) | 7 |
| `ingest.ts` | `manualIngest()` — creates property row tagged `order_mode='operator'`, links photos, optional director-notes seed. Does NOT trigger pipeline (client-side responsibility). | 6 |
| `invoice.ts` | Pure `formatInvoiceSummary()` paste-ready text formatter | 3 |
| `invoice-data.ts` | `buildInvoice()` joins clients + properties + cost_events filtered to operator-mode + date window. Integration-tested when `LE_RUN_INTEGRATION=true`. | 2 (skipped by default) |
| `brand-kit.ts` | `brandKitFromClient()` extracts, `mergeBrandVars()` merges `Brand.*` keys into Creatomate modifications. Pure. | 4 |
| `clip-swap.ts` | `swapClip(propertyId, sceneIdx, iterationId)` validates room_type match, copies clip_url + sets `scenes.replaced_at`, calls `rerunAssembly`. | 5 |
| `preview.ts` | `createPreviewLink`, `fetchByToken`, `recordPreviewView`, `insertClientNote` | 12 |
| `preview-tokens.ts` | `crypto.randomBytes(24).toString('base64url').slice(0,32)` + regex validator | 3 |

### Pipeline changes (`lib/pipeline.ts`)

- **Brand-kit injection at assembly** (`lines 1144-1182`): when `properties.client_id` is set, fetch the client and `mergeBrandVars()` the `Brand.*` keys into the Creatomate modifications payload. Customer-flow path (`client_id` null) is byte-identical to before. Once Creatomate template placeholders exist for those keys, operator-flow renders carry the client's logo, primary/secondary hex, agent name, headshot, and brokerage.
- **`rerunAssembly(propertyId)` export**: the assembly stage of `runPipeline` was extracted into an internal `runAssemblyStep()` so both `runPipeline` and `rerunAssembly` call it. `rerunAssembly` guards against running mid-pipeline (rejects `status` in `queued|analyzing|scripting|generating|qc`) and against assembling-with-zero-scenes. Cost events take a `reason` parameter — manual reruns from clip-swap emit `cost_events.metadata.reason='manual_rerun'`.
- **`order_mode` + `client_id` propagated through log context** so operator-mode work is distinguishable in production logs without a behavior fork in the main pipeline.

### Admin endpoints (all behind `requireAdmin()`)

| Path | Methods | Notes |
|---|---|---|
| `/api/admin/studio/clients` | GET, POST | `?include_archived=true` available on GET |
| `/api/admin/studio/clients/[id]` | GET, PATCH, DELETE | DELETE soft-archives via `archived_at` |
| `/api/admin/studio/ingest` | POST | Returns `{ property_id }`. Pipeline trigger is client-side. |
| `/api/admin/studio/invoice-summary` | POST | Returns `{ text, data: InvoiceSummary }` |
| `/api/admin/studio/queue` | GET | Operator-mode properties bucketed inbox / rendering / needs_review / delivered |
| `/api/admin/studio/iterations` | GET | `?room_type=` returns up to 50 latest `prompt_lab_listing_scene_iterations`. Studio-local wrapper. |
| `/api/admin/studio/properties/[id]` | GET | Bundle: property + scenes + revision_notes + previews + per-provider cost rollup |
| `/api/admin/studio/properties/[id]/notes` | POST | Append operator-source revision note |
| `/api/admin/studio/properties/[id]/preview-link` | POST | Issue signed preview token |
| `/api/admin/studio/properties/[id]/scenes/[idx]/swap-clip` | POST | Copies a Lab iteration's clip + triggers `rerunAssembly` |

### Public endpoint

- `/api/preview/[token]` — GET returns `{ address, video_url, brand }`; POST inserts a `property_revision_notes` row with `source='client_preview'`. Token validated regex-first before any DB hit so malformed URLs never hit Postgres. View counter incremented via the `increment_preview_view` Postgres RPC (atomic).

### Frontend

- `src/styles/studio-design.css` — all `--le-*` design tokens + utility classes scoped under `.studio-scope` so the rest of the app's tokens never see them. Pattern: every Studio page renders inside `<StudioShell>` which wraps content in `<div className="studio-scope">` plus fixed-position background + grain layers.
- `src/components/studio/StudioShell.tsx`, `StudioNav.tsx`, `ClientPicker.tsx`, `SceneStrip.tsx`, `IterateInLabModal.tsx`
- `src/pages/dashboard/studio/StudioHome.tsx` — Kanban with KPI strip
- `src/pages/dashboard/studio/Clients.tsx` + `ClientEdit.tsx`
- `src/pages/dashboard/studio/StudioNew.tsx` — manual ingest form
- `src/pages/dashboard/studio/PropertyCommandCenter.tsx` — final video, scene strip, director's notes, preview links, brand-kit summary with "incomplete kit" warning, cost panel, metadata
- `src/pages/preview/PreviewPage.tsx` — public viewer

### Tests

104 Operator Studio tests passing (28 unit + 76 endpoint integration via mocked supabase). 2 invoice-data integration tests skipped by default; fire when `LE_RUN_INTEGRATION=true` and the migrations are applied (both are true now). Full repo suite green except pre-existing `MarketComparison.test.tsx` failure (unrelated to this branch — predates Operator Studio).

## Critical lessons (don't repeat)

1. **`tsc --noEmit` does not run PostCSS.** A CSS file with a stray Tailwind utility (`flex-none;` as a bare property) passes tsc but blows up Vite's production build with `[postcss] Unknown word flex-none`. **Pre-push check for any UI-heavy commit: run `node_modules/.bin/vite build` from the worktree.** Don't trust tsc alone.
2. **Tailwind utility class names are not valid CSS property values.** They only work as classNames in JSX or inside `@apply` blocks. Never write them as bare properties in raw CSS files.
3. **Scope new design tokens with a class selector, not `:root`.** Putting `--bg`/`--ink`/`--surface` on `:root` would have fought with the existing project's tokens elsewhere. `.studio-scope { --le-bg: ... }` is the clean pattern. All `--le-*` prefixed to avoid colliding with the pre-existing `--le-font-mono` (which is aliased to Inter per the project's "no JetBrains Mono" memory).
4. **Verify table/column names before generating code.** The original plan assumed a `property_photos` table with `storage_path` + `sequence` columns. Actual schema: `photos` table with `file_url` + `file_name` and no sequence column. The Task 7 implementer adapted on the fly; future implementers should always grep the migrations before writing CRUD code.
5. **Gemini adversarial reviews are worth their cost when the spec is large.** Round 1 caught the "Phase 1 produces unbranded undeliverable videos" mis-phasing — that was a one-day save. Frame the prompt explicitly adversarial: "Find the worst weaknesses. Polite agreement is worse than a wrong critique."
6. **The customer-flow path stays clean by gating on `client_id IS NOT NULL` or `order_mode='operator'`.** Never add unconditional operator-mode behavior to the main pipeline; always check the gate first. This keeps Phase 1 a pure-additive branch.
7. **Server-side pipeline triggers are not a thing in this codebase.** The customer flow triggers `/api/pipeline/:id` from the React page (`src/lib/api.ts:206`, fire-and-forget). Operator flow does the same. There is no server-side `triggerPipeline()` helper — don't invent one.

## Open gates before merging to dev

1. **Add `Brand.*` placeholders to Creatomate templates in the editor.** Code sends `Brand.logo`, `Brand.primary`, `Brand.secondary`, `Brand.agent_name`, `Brand.agent_headshot`, `Brand.brokerage`. Creatomate silently ignores unknown keys. **This is the only thing blocking visible brand-kit on rendered videos.** Document the final placeholder names back in PROJECT-STATE.md "Operator Studio" section after the edit.
2. Decide: add a `properties.square_footage` column or remove the input from `StudioNew.tsx`. The field is accepted by `manualIngest` and silently dropped.
3. Cleanup: import `ClientRow` from `lib/types/operator-studio.ts` in `src/components/studio/ClientPicker.tsx` instead of inlining the type definition.

## What Phase 2 + Phase 3 look like (not detailed yet)

- **P2:** Apify magic-link scraper (paste Zillow/Redfin/Sierra URL → ingest); full `playbooks` table + CRUD + UI + pipeline application; director's notes panel polish; Claude distill notes → scene actions.
- **P3:** Finances integration (per-client P&L card on `/dashboard/finances`); ElevenLabs voice clone wiring (`clients.voice_id` becomes the voiceover input when a playbook enables voiceover); multi-revision tracking + cap.

Both get detailed plans written before any execution dispatch.

## Files to read on cold entry (in order)

1. `docs/HANDOFF.md` "Right now" — current state.
2. `docs/state/PROJECT-STATE.md` "Operator Studio" section — surface inventory.
3. `docs/specs/2026-05-15-operator-studio-design.md` — design spec (v2).
4. `docs/plans/2026-05-15-operator-studio-plan.md` — implementation plan.
5. `listing-elevate-backend/project/glass/STYLE-GUIDE.md` — design system spec (read before touching any Studio CSS or page).
6. `lib/pipeline.ts` `runAssemblyStep` + brand-kit injection block — the two places customer-flow vs operator-flow diverges.
7. `lib/operator-studio/` — every module is < 100 lines and pure. Start with `brand-kit.ts` (helpers) and `clip-swap.ts` (the most surgical write path).
