# Admin Dashboard Redesign — Design Spec

**Date:** 2026-05-13
**Branch (target):** `feat/dashboard-redesign` off `dev`
**Authors:** Oliver + Claude (brainstorming session)
**Status:** Awaiting Oliver review → implementation plan

---

## 1. Goal

Renovate `/dashboard/*` with an elevated UI grounded in LE's existing brand (black / grey / white / dark blue / blue / beige), Inter + JetBrains Mono typography, and the LE spacing rhythm — applied to a vertical-sidebar layout pattern. Audit-first: cut dead pages, surface hidden tools, fix naming inconsistencies, then restyle.

**North star:** `/dashboard` becomes the single-pane admin "control room" with KPIs, a revenue/spend trend, cost-by-provider breakdown, and the recent-listings table. Sidebar IA is reduced from 8 top items + 2 dropdowns to 5 top items + 2 dropdowns.

## 2. Information Architecture (locked)

### Sidebar

```
Overview
Orders ▾
   Pipeline
   Orders                (stub — deferred build)
Users                    (new)
Listings                 (renamed from Properties)
Finances
Tools ▾
   Blog                  (hub page with 3 tabs)
Dev ▾
   Overview              (Development.tsx, restructured)
   Prompt Lab
   Recipes
   Knowledge Map
   System Status
```

### Detail pages (not in sidebar, reached from list/grid)

- `PropertyDetail` ← from Listings
- `KnowledgeMapCell` ← from Knowledge Map

### Archived (cut entirely, behind feature flag in Stage 5)

| Page | Reason |
|---|---|
| `Settings.tsx` | 5-week-old mock — every input is `defaultValue`, every Save is `toast.success`. Misleads users. Real settings live in Vercel env + `system_flags` + `prompt_revisions`. |
| `Learning.tsx` | Orphaned — never routed in `App.tsx`. Two dead `<Link>`s from `Development.tsx` render 404. Aggregated view replicated by Knowledge Map + Rating Ledger. |
| `Logs.tsx` | Cross-cutting telemetry. Folds into System Status as a "Pipeline logs" panel. |
| `PromptProposals.tsx` | Cut per Oliver's IA. Ledger-driven proposals still mineable via cron + SQL. |
| `RatingLedger.tsx` | Cut per Oliver's IA. Rating data still flows into `scene_ratings` and the ML loop; UI surface gone. |
| `LabListings.tsx` + `LabListingNew.tsx` + `LabListingDetail.tsx` | Multi-photo V2 lab. Hidden from nav since 2026-04-22; PromptLab.tsx covers daily-driver iteration. |

## 3. Visual System

### Tokens (reuse, do not invent)

- `--le-bg`, `--le-bg-elev`, `--le-bg-sunken`
- `--le-border`, `--le-border-strong`
- `--le-text`, `--le-text-muted`, `--le-text-faint`
- `--le-success`, `--le-warn`, `--le-danger`, `--le-info` (+ `-soft` variants)
- `--le-r-sm/md/lg/xl` for radii
- `--le-shadow-sm/md/lg`
- `--le-font-sans` (Inter), `--le-font-mono` (JetBrains Mono)

### New additions (additive only)

- **`--le-gradient-blue`**: `linear-gradient(135deg, oklch(0.62 0.13 240), oklch(0.48 0.16 245))` — primary KPI disc
- **`--le-gradient-navy`**: `linear-gradient(135deg, oklch(0.32 0.08 250), oklch(0.22 0.05 250))` — secondary KPI disc
- **`--le-gradient-beige`**: `linear-gradient(135deg, oklch(0.85 0.04 80), oklch(0.78 0.05 75))` — tertiary KPI disc
- **`--le-gradient-status-{healthy,degraded,critical}`** — System Health KPI disc, color follows status
- All gradients live in `src/v2/styles/tokens.css`. Used ONLY on KPI discs + chart area-fills. No background washes, no card gradients, no button gradients.

### Density + radii

- Cards: `--le-r-lg` (14px) corners, `--le-bg-elev` fill, `--le-border` hairline, `--le-shadow-md` on elevated surfaces only (KPI cards, chart panels).
- KPI disc: 44px square, `--le-r-md` (10px) corners, gradient fill, white icon at `strokeWidth=1.5`.

## 4. Shell

### `DashboardShell` component

New file: `src/v2/components/DashboardShell.tsx`. Replaces `TopNav` for routes matching `/dashboard/*`. `TopNav` continues to mount for `/`, `/upload`, public pages.

### Layout

- **Sidebar (left, fixed):** 240px expanded, collapsible to 64px icon rail via `cmd-\` or rail-edge click. State persists in `localStorage`.
- **Top bar (above content):** ~56px. Page title (left) · search field (center, optional, future) · theme toggle · notification bell (future) · avatar dropdown (right). Sticky.
- **Content area:** `max-width: 1440px`, horizontal padding 32-48px (token-driven), top padding 24px.

### Sidebar visual

- Logo mark top-left (LE wordmark when expanded, mark only when collapsed).
- Nav items: 12px icon + label, 36px tall. Active = filled pill with `--le-accent` background + `--le-accent-fg` text. Hover = `--le-bg-sunken` background.
- Dropdowns (`Orders`, `Tools`, `Dev`): chevron rotates on expand; sub-items inset 32px from the rail.
- Bottom anchor: theme toggle + avatar pill (avatar + email truncate + dropdown caret).

### Responsive

- ≥1024px: sidebar visible by default.
- 768-1024px: sidebar collapsed (rail).
- <768px: sidebar becomes off-canvas drawer triggered by hamburger in top bar.

## 5. Overview Page

### Structure

```
┌─────────────────────────────────────────────────────────────┐
│  Greeting (page title) + period selector (7d/30d/90d)        │
├─────────────────────────────────────────────────────────────┤
│  KPI │ KPI │ KPI │ KPI                                       │
│  Active│Videos│Margin│System                                  │
│  cust. │deliv.│  %   │health                                  │
├─────────────────────────────┬───────────────────────────────┤
│                             │                               │
│  Revenue + Spend (dual area)│  Cost mix by provider (donut) │
│  ~ 2/3 width                │  ~ 1/3 width                  │
│                             │                               │
├─────────────────────────────┴───────────────────────────────┤
│  Recent listings table (10 rows, links to PropertyDetail)    │
└─────────────────────────────────────────────────────────────┘
```

### KPI specs

| KPI | Computation | Source | Gradient |
|---|---|---|---|
| Active customers (period) | `count(distinct user_profile_id) from properties where created_at >= period_start` | `properties` join `user_profiles` | `--le-gradient-blue` |
| Videos delivered (period) | `count(*) from properties where status='complete' and completed_at >= period_start` | `properties` | `--le-gradient-navy` |
| Margin % (period) | `(sum(revenue_entries.amount) - sum(cost_events.cost_usd)) / sum(revenue_entries.amount) * 100` over period | `revenue_entries` + `cost_events` | `--le-gradient-beige` |
| System health | Status = max(severity) across: (a) `system_flags` kill-switches in unexpected state, (b) `cost_events` provider error rate over last 24h > 5% (critical) or > 1% (degraded), (c) properties stuck in any non-terminal state > 60min (critical) or > 15min (degraded). Show pill + active-alert count. | `system_flags` + `cost_events` + `properties` | `--le-gradient-status-*` |

Each card also shows a 7-day micro-delta (`+15%` style) below the value, where applicable. System Health shows `N alerts` and a "View details →" link to `/dashboard/dev/system-status`.

### Charts

**Revenue + Spend dual area:**
- X = days in selected period (7/30/90 buckets).
- Y1 (revenue) = `revenue_entries.amount` aggregated daily.
- Y2 (spend) = `cost_events.cost_usd` aggregated daily.
- Revenue area: `--le-gradient-blue` fill, blue stroke. Spend area: `--le-gradient-beige` fill, dark-blue stroke.
- Tooltip: shows date + revenue + spend + net.
- Implementation: `recharts` `AreaChart` (already a dependency).

**Cost mix donut:**
- Segments: provider grouping from `cost_events` over selected period.
- Providers (current list per `cost_events` enum): `anthropic`, `runway`, `kling-via-atlas`, `luma`, `shotstack`, `apify`, `browserbase`, `google`, `higgsfield`.
- Center label: total spend over period.
- Color sequence: 6 ramps off `--le-info`, `--le-success`, `--le-warn`, `--le-danger`, `--le-accent`, `--le-gradient-beige` (solid form). Stable color per provider (memoized).

### Recent listings table

- 10 rows, ordered by `created_at desc`.
- Columns: Order ID (uses `order_id` from migration 041 if present, else short property UUID), Customer (user_profiles.email), Address (truncated), Stage (status pill), Cost (sum of cost_events for property), Date (relative), Stage (badge).
- Row click → `/dashboard/listings/:id`.
- "View all listings →" footer link.

## 6. Per-Page Treatment

### 6.1 Pipeline (Orders › Pipeline)

- Drop the 6-column kanban (Overview shows stage counts).
- Restyle the manual-review queue as a primary list view.
- Each row: property thumbnail + address + customer + failing-scene count + actions (Approve / Resubmit / Try other provider / Edit prompt / Skip).
- Fix N+1: build `GET /api/admin/review-queue` that returns flattened `{ property, failed_scenes[] }` in one call. Replaces the loop of `fetchProperty(id)` in `Pipeline.tsx`.
- Empty state: "No scenes need review. Pipeline is clean."

### 6.2 Orders (Orders › Orders) — stub

- Page renders a "Coming soon" card describing intent: customer-grouped order view derived from `properties` + future `orders` table.
- Stub avoids dead nav while building. No data fetches.

### 6.3 Users — new page

- Route: `/dashboard/users`
- API: new `GET /api/admin/users` returning `{ users: [{ id, email, role, created_at, property_count, total_spend_cents, last_active_at }] }`.
- Page: table with same columns + search + role filter + paginate.
- Row click → `/dashboard/users/:id` (basic detail: profile fields + listings list + cost ledger for that user).
- Implementation note: `last_active_at` derived from `properties.created_at` max per user; revisit if `auth.users.last_sign_in_at` is exposable.

### 6.4 Listings (was Properties)

- Rename: `Properties.tsx` → `Listings.tsx`. Route `/dashboard/properties` → `/dashboard/listings`. Add `/dashboard/properties/*` redirect (301).
- Restyle table per new card / spacing system.
- Move thumbnail batch behind `fetchProperties` (current direct Supabase call is inconsistent).
- Columns adjust to: Order ID · Customer · Address · Stage · Cost · Date.

### 6.5 Finances

- Drop the cost-by-provider pie (Overview owns it).
- Keep: cashflow chart, token-purchase CRUD, expense CRUD, revenue-entry CRUD.
- Restyle KPI strip (Revenue · Spend · Net · Cost/video) using same card system as Overview.

### 6.6 Tools › Blog (hub)

- New route `/dashboard/tools/blog` with 3 tabs: Posts (default) · Images · Templates.
- Each tab mounts the existing component (`BlogPostsList`, `BlogImageLibrary`, `BlogTemplates`) inside the hub container.
- Detail routes unchanged:
  - `/dashboard/blog/posts/:id` → `BlogPostDetail`
  - `/dashboard/blog/templates/:id` → `BlogTemplateDetail`
- Old `/dashboard/blog/{posts,images,templates}` routes 301 to the hub with tab pre-selected.

### 6.7 Dev › Overview (Development.tsx)

- Drop the quick-link grid (sidebar now serves discovery).
- Drop stale "Kling 3.0 default + Wan 2.7 toggle" reference text — pipeline reference is regenerated from `lib/providers/router.ts` constants or removed.
- Keep: session notes (`dev_session_notes` CRUD) + prompt-revision changelog (read from `prompt_revisions`).
- Restyle as a working-log surface, not a landing hub.

### 6.8 Dev › Prompt Lab / Recipes / Knowledge Map / System Status

- Prompt Lab: cosmetic restyle only — same iteration loop, SKU picker, rate-and-promote-to-recipe flow.
- Recipes: cosmetic restyle.
- Knowledge Map: restyle 14×12 grid using LE token palette; cell drill-down (`KnowledgeMapCell`) remains as detail page.
- System Status: gains a "Pipeline logs" panel (port of `Logs.tsx` — 500-row tail, stage + level filters, autoscroll, CSV export).

## 7. Routes & Redirects

| Old | New | Status |
|---|---|---|
| `/dashboard/properties` | `/dashboard/listings` | 301 |
| `/dashboard/properties/:id` | `/dashboard/listings/:id` | 301 |
| `/dashboard/logs` | `/dashboard/dev/system-status#logs` | 301 |
| `/dashboard/development/*` | `/dashboard/dev/*` | 301 (decision: yes) |
| `/dashboard/blog/posts` | `/dashboard/tools/blog?tab=posts` | 301 |
| `/dashboard/blog/images` | `/dashboard/tools/blog?tab=images` | 301 |
| `/dashboard/blog/templates` | `/dashboard/tools/blog?tab=templates` | 301 |
| `/dashboard/rating-ledger` | removed | 410 → `/dashboard/dev/system-status` |
| `/dashboard/development/proposals` | removed | 410 → `/dashboard/dev/overview` |
| `/dashboard/development/lab/*` | removed | 410 → `/dashboard/dev/prompt-lab` |
| `/dashboard/settings` | removed | 410 → `/dashboard` |

Detail-page deep links (`/dashboard/properties/:id` already in customer-facing emails if any) must keep 301-ing forever — do not break them.

## 8. Implementation Stages

Each stage = a separate PR onto `feat/dashboard-redesign`. Branch path: `feat/dashboard-redesign-stageN` → `feat/dashboard-redesign` (integration) → `dev` → `staging` → `main`.

| Stage | Scope | Risk | Notes |
|---|---|---|---|
| 1. Shell + Overview | `DashboardShell`, new Overview page, KPI cards, dual-area chart, donut, recent listings table. Wire all 4 KPIs (with `system-health` API endpoint). | High visual change; isolated to `/dashboard` and `/dashboard/dev/system-status` (no deps elsewhere) | Behind `LE_DASHBOARD_V3` env flag on dev/staging. Flip on per-branch. |
| 2. Listings rename + redirects | Rename `Properties.tsx` → `Listings.tsx`, route move, redirect installs, thumbnail fetch consolidation. | Medium — external deep links. Must keep 301s in place. | |
| 3. Pipeline restructure + Finances trim + Dev Overview fix | Pipeline kanban drop, `GET /api/admin/review-queue`, Finances pie drop, Development.tsx grid + stale-text drop. | Medium | |
| 4. Tools › Blog hub + Users page + Orders stub | New hub route + tabs, new Users page + `GET /api/admin/users`, Orders stub. | Medium — new endpoints. | |
| 5. Archive cuts | Behind a `LE_DASHBOARD_ARCHIVE_LEGACY` flag, remove from build / redirect old routes for: Settings, Learning, Logs, Proposals, RatingLedger, LabListings + New + Detail. Code moves to `src/pages/dashboard/_archive/`. | Low if flag works; reversible if flipped off. | Last stage. |

Flag flow: each stage merges to `dev` with flag OFF, Oliver tests on dev URL with flag ON, then flag flips to ON in staging + main when stage proven.

## 9. API Surface Changes

| Endpoint | Status | Purpose |
|---|---|---|
| `GET /api/admin/overview/system-health` | NEW | Aggregates `system_flags` + `cost_events` errors + stuck properties → `{ status: 'healthy' \| 'degraded' \| 'critical', alerts: [...] }` |
| `GET /api/admin/overview/recent-listings?limit=10` | NEW | Replaces 2× `fetchProperties` calls on Overview |
| `GET /api/admin/overview/cost-by-provider?period=30d` | NEW | Period-aware provider rollup for donut |
| `GET /api/admin/overview/revenue-spend-series?period=30d` | NEW | Daily revenue + spend series |
| `GET /api/admin/review-queue` | NEW | Flattens N+1 `fetchProperty` calls in Pipeline |
| `GET /api/admin/users` | NEW | Powers Users page |
| `GET /api/admin/users/:id` | NEW | Powers Users detail |

All write paths unchanged. No migrations required for Stage 1-4. Stage 5 archive uses the existing repo `archive` convention (`docs/archive/` for docs; for code, files move to `src/pages/dashboard/_archive/` and are excluded from build via path exclusion in `vite.config.ts` when flag OFF).

## 10. Migrations

No new migrations for Stages 1-5.

Optional follow-up (deferred): a real `orders` table if the Orders page ships beyond stub. Out of scope for this redesign.

## 11. Risks & Open Questions

- **"Videos delivered" KPI may read low** until assembly is wired (`runAssembly` in `lib/pipeline.ts:148` is dead code per 2026-05-13 pre-launch gap audit). Spec stands; revisit once assembly ships.
- **`portal_*` migrations** are applied to remote DB but not in repo migration files (per HANDOFF 2026-05-13). The Users page may need to reconcile against `portal_*` tables for accurate `last_active_at`. Out of scope for Stage 1; flagged for Stage 4.
- **Archive flag tooling** is new — `LE_DASHBOARD_ARCHIVE_LEGACY` needs to gate both route registration and build inclusion. Verify on dev before flipping in staging.
- **System Health logic** is heuristic-first. If false positives are noisy, refine the thresholds during Stage 1 dev testing.

## 12. Out of Scope

- Public marketing site (`/`, `/upload`) untouched.
- Customer-facing portal (`portal_*`) untouched.
- New brand work — palette and typography are reused, not redefined.
- Real `orders` schema — deferred.
- Stripe wiring on the Users / Orders pages — deferred.
- Mobile redesign of public site — separate effort.
- Replacing recharts — kept.

---

## Appendix A — Files touched (by stage)

### Stage 1
- NEW: `src/v2/components/DashboardShell.tsx`, `src/v2/components/Sidebar.tsx`, `src/v2/components/TopBar.tsx`, `src/v2/components/KpiCard.tsx`, `src/v2/components/RevenueSpendChart.tsx`, `src/v2/components/CostProviderDonut.tsx`, `src/v2/components/RecentListingsTable.tsx`, `src/v2/components/PeriodSelector.tsx`
- NEW: `api/admin/overview/system-health.ts`, `api/admin/overview/recent-listings.ts`, `api/admin/overview/cost-by-provider.ts`, `api/admin/overview/revenue-spend-series.ts`
- EDIT: `src/pages/Dashboard.tsx` (mounts `DashboardShell`), `src/pages/dashboard/Overview.tsx` (complete rewrite), `src/App.tsx` (mount Shell at `/dashboard/*`)
- EDIT: `src/v2/styles/tokens.css` (add `--le-gradient-*`)
- EDIT: `src/components/TopNav.tsx` (early-return on `/dashboard/*` paths)

### Stage 2
- RENAME: `src/pages/dashboard/Properties.tsx` → `src/pages/dashboard/Listings.tsx` (via `git mv`)
- EDIT: `src/App.tsx` route move + 301 redirects
- EDIT: `src/lib/api.ts` consolidate thumbnail fetch
- EDIT: `src/pages/dashboard/PropertyDetail.tsx` link references

### Stage 3
- EDIT: `src/pages/dashboard/Pipeline.tsx` (drop kanban, restyle queue)
- NEW: `api/admin/review-queue.ts`
- EDIT: `src/pages/dashboard/Finances.tsx` (drop pie)
- EDIT: `src/pages/dashboard/Development.tsx` (drop grid + stale text)

### Stage 4
- NEW: `src/pages/dashboard/ToolsBlog.tsx` (hub), `src/pages/dashboard/Users.tsx`, `src/pages/dashboard/UserDetail.tsx`, `src/pages/dashboard/Orders.tsx` (stub)
- NEW: `api/admin/users/index.ts`, `api/admin/users/[id].ts`
- EDIT: `src/App.tsx` route registrations + redirects

### Stage 5
- MOVE: `Settings.tsx`, `Learning.tsx`, `Logs.tsx`, `PromptProposals.tsx`, `RatingLedger.tsx`, `LabListings.tsx`, `LabListingNew.tsx`, `LabListingDetail.tsx` → `src/pages/dashboard/_archive/`
- EDIT: `src/App.tsx` (route removals + 410-style redirects), `vite.config.ts` (path exclusion behind flag)
- EDIT: `docs/archive/README.md` (add archive entry per LE convention)

## Appendix B — Audit findings (raw, condensed)

See per-cluster audit reports in session transcript 2026-05-13. Headlines:

**Core (7 pages):**
- KEEP: Overview, Listings (renamed), PropertyDetail, Finances
- RESTRUCTURE: Pipeline (drop kanban)
- MERGE: Logs → System Status
- CUT: Settings (5-week mock)

**Dev (12 pages):**
- KEEP: PromptLab, PromptLabRecipes, KnowledgeMap, KnowledgeMapCell, SystemStatus
- RESTRUCTURE: Development.tsx
- CUT: Learning (orphaned), PromptProposals, RatingLedger, LabListings + New + Detail
- Multiple cross-cutting refactors flagged (shared design tokens, shared RatingWidget, unified cost API)

**Blog (5 pages):**
- KEEP all 5; collapse top-level dropdown into a hub-with-tabs page under `Tools › Blog`.

## Appendix C — Decisions log

- 2026-05-13: Fidelity = LE brand + soft gradients + reference layout (Oliver call).
- 2026-05-13: Sidebar > top nav for shell (Oliver call).
- 2026-05-13: Audit-first scope (Oliver call).
- 2026-05-13: Sidebar IA locked: Overview / Orders / Users / Listings / Finances / Tools / Dev (Oliver call).
- 2026-05-13: KPIs locked: Active customers / Videos delivered / Margin % / System health (Oliver call).
- 2026-05-13: Orders page deferred to stub; Users page built against `user_profiles` (Oliver call).
- 2026-05-13: Cut Proposals + Rating Ledger + Lab · Listing (Oliver call).
- 2026-05-13: `/dashboard/development/*` → `/dashboard/dev/*` route shortening (Claude default, awaiting confirmation in review).
