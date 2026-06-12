# Authed-app role split — design rationale

**Date:** 2026-06-11
**Branch:** `feat/authed-app-role-split` (off main @ post-UI-consistency-pass, merge 91e248b)
**Status:** Preview-only. Committed locally; NOT pushed, NOT deployed. Push/prod decision pending Oliver.
**Request (verbatim):** "freshen up the listing elevate back-end to be more modern, more intuitive, more user forward (agent end and owner operator end) the ui/ux lacks clear usage case and the UX is poor. its hard to use and has many inconsistencies and also doesnt really make sense nor look like a platform that is professional and user-forward."

Interpretation: "back-end" = the logged-in app surfaces (the platform behind the marketing site), not server code. Two roles, two jobs-to-be-done, one coherent shell.

> Process note: the council chairman synthesis for this run completed on its
> configured model — no Opus substitution was needed.

---

## 1. Jobs-to-be-done framing

The core diagnosis: the authed app had **one** information architecture (the operator's), and agents were locked out of it entirely. There was no agent experience to be inconsistent — there was a redirect loop. The redesign starts from what each role actually comes here to do and lets IA follow.

### Agent (the customer)

An agent logs in maybe twice per order. Their jobs, in order of frequency:

1. **Order a video** — upload photos + metadata, pay, leave.
2. **Check on my order** — is it in production? done? did something go wrong?
3. **Get the deliverable** — watch, download, share the finished video.
4. **Housekeeping** — billing, profile, brand settings (rare).

What they must **never** see: pipeline internals, other tenants' listings, provider costs/margins, ops vocabulary ("needs_review", "kling-v3-pro", scene statuses).

### Operator (Oliver)

The operator lives here daily. Jobs, in order of urgency:

1. **What needs me right now?** — failed renders, needs_review queue, provider outages (the 2026-06-11 Atlas-402 balance outage is the canonical example).
2. **Run the order pipeline** — move orders through production, intervene in the studio.
3. **Produce content** — video studio, blog, email tools.
4. **Run the business** — finances, logs, system health, Lab experiments, settings.

The old Overview was a generic KPI wall — it answered "how is the business doing?" before answering "what's on fire?". For a daily-driver ops surface that ordering is backwards.

---

## 2. Information architecture — before → after

### Before (single nav, admin-only)

```
/dashboard/*  →  RequireAdmin on everything
└─ Sidebar (one shell, admins only)
   ├─ Workspace: Overview · Pipeline · Listings · Users
   └─ Ops:       Video · Blog · Email · Finances · Logs ·
                 System status · Lab · Settings

Agent (role "user"):  NO working surface at all —
  login → /account → /dashboard/account/profile → RequireAdmin
  → /account → … infinite redirect loop (P0, see §3)
```

### After (one shell, two role-derived item sets)

```
/dashboard  →  RequireAuth (everyone authed gets in)
DashboardIndex: admin → Overview (operator Today) · user → AgentHome

AGENT (role "user") — brand sub-label "Client studio", 5 items:
└─ Studio: Home (/dashboard) · Order a video (/upload) ·
           My listings · Billing · Profile

OPERATOR (role "admin") — brand sub-label "Operator studio", 3 groups:
├─ Operate:  Today (/dashboard) · Orders (pipeline) ·
│            Listings · Agents (users)
├─ Studio:   Video · Blog · Email
└─ Business: Finances · Logs · System status · Lab · Settings
```

Key decisions:

- **One shell component, two item sets** (`getSections(role)` in `DashboardSidebar.tsx`). No parallel app, no second design language — the L2 soft app-shell canon from the 2026-06-09 consistency pass is unchanged. Consistency comes from sharing the shell; clarity comes from role-scoping the contents.
- **Labels renamed, URLs untouched.** "Pipeline"→"Orders", "Users"→"Agents", "Overview"→"Today" are vocabulary fixes (operator thinks in orders and agents, not DB tables). Zero redirects needed; old URLs still resolve (covered by `src/test/navRenameRoutes.test.tsx`).
- **Operate / Studio / Business grouping** mirrors the operator's JTBD ordering: urgency first, production second, back-office third. (Sidebar IA descends from the never-merged `worktree-dashboard-soft-pastel-reskin` prior art, reworked for the current design canon rather than transplanted.)
- **Route guards restructured** (`src/AppRoutes.tsx`, extracted from `App.tsx`): `/dashboard` parent is `RequireAuth`; operator routes get a nested `RequireAdmin` that redirects non-admins to `/dashboard` (terminating, loop-free — 12-case route×role matrix test in `src/test/routeRoleMatrix.test.tsx`).

### Per-role landing experiences

**AgentHome** (`src/pages/dashboard/AgentHome.tsx`) — "Your studio": primary CTA → `/upload`; orders bucketed into Finish checkout (abandoned Stripe checkouts, recovered via the existing `/upload/cancelled` rail), In production, Needs attention (failure shown first-class with reassurance copy, not hidden), Delivered. Live `/api/properties` data only — empty buckets render `EmptyState`, never sample rows. Status vocabulary is translated for customers via `ORDER_STATUS_MAP` (`src/lib/order-status.ts`): Received / Crafting scenes / Rendering / In review / Delivered / Needs attention / Awaiting payment — internal pipeline strings never leak to agents.

**Operator Today** (`Overview.tsx` restructured): a **NeedsYouStrip** (needs_review count + failed-today count, deep-linked) and a **ProviderHealthRow** (per-provider 24h error chips with named balance-error alerts — would have surfaced the Atlas-402 outage at a glance) now sit above the KPI rows. Calm "All clear" state when nothing needs intervention.

**Shared kit + honesty pass:** `StatusChip`, `EmptyState`, `MoneyValue` added to `src/components/dashboard/primitives.tsx`. `MoneyValue` (null → "—", never fabricated $0) is now the sole JSX money-rendering path across all dashboard surfaces — Overview, Finances, Billing, Listings, LabListings, LabListingDetail, Properties — with a `fmtMoney` helper for string contexts and an ESLint ban on raw `fmtCents` in dashboard files (see §5 and §4 item 6). Overview's sample-data fallbacks (fake activity feed, fake provider mix) were removed — a fresh tenant now sees honest empty states instead of an invented business. Navigation dead-ends closed: `Status.tsx` "View all videos" pointed at a dead route (`/account/properties` → now `/dashboard`); `UploadSuccess` gained a "View my orders" primary CTA; `TopNav`'s unreachable dashboard nav code deleted; `Profile.tsx` converted from 29 inline-style objects to canon Tailwind.

---

## 3. Verified security findings and fixes

Opening `/dashboard` to non-admins forced an audit of every API the agent surface consumes. The gates found real holes — all fixed and test-covered on this branch:

| Sev | Finding | Fix | Commit |
|---|---|---|---|
| P0 | **Agent redirect loop**: non-admin login → `/account` → `/dashboard/account/profile` → `RequireAdmin` → `/account` → ∞. Agents had no working authed surface at all. | `RequireAdmin` redirect target → `/dashboard`; `AuthCallback` sends both roles to `/dashboard`; `DashboardIndex` branches by role. Route×role matrix test proves termination. | 25943b9 |
| P0 | **Unauthenticated PATCH** `/api/properties/:id/status`: anyone with a property UUID could flip status (delivered/failed/archived…) with no session. Direct privilege escalation on a multi-tenant SaaS. | `verifyAuth` → 401; owner-or-admin check → 403. 6 tests. | 1140657 |
| P0 | **Unauthenticated GET** `/api/properties`: returned **all tenants'** properties (address, price, agent, costs) to any unauthenticated caller via service-role query. AgentHome was about to become its first customer-facing consumer. | `requireAuth`; non-admins scoped `.eq('submitted_by', user.id)`; admins keep the unscoped view. | bc5ef6f |
| P1 | **Unauthenticated GET** `/api/properties/:id`: full property + internal `cost_events` (provider margin data) for any UUID. | 401 unauthenticated, 403 non-owner; `costEvents` admin-only (owners get `[]`). | bc5ef6f |
| P1 | `pending_payment` was a live status missing from `ORDER_STATUS_MAP` and from every AgentHome bucket — abandoned checkouts were invisible to agents despite an existing recovery rail. | "Awaiting payment" chip + "Finish checkout" section → `/upload/cancelled?property_id=…`; exhaustive status-map test now fails on any future unmapped status. | abab9e9 |
| P2 | Owners could PATCH themselves into ops states (`complete`/`delivered`/`failed`/`needs_review`). | `OWNER_PATCH_STATUSES = {archived}`; everything else admin-only. | bc5ef6f |

---

## 4. Deferred follow-ups (explicitly out of scope this run)

1. **Close GET `/api/properties/:id/status`.** Still unauthenticated **by design for now**: delivery/status emails already in customers' inboxes link to `/status/:id`, which polls this endpoint. Closing it today bricks sent emails. **Partially done (`35180a9`, 2026-06-12):** response narrowed to `{status,label,currentStage,totalStages}` — address, video URLs, timing data, and clip counts are no longer returned unauthenticated. Remaining follow-up: move emailed status links onto the preview-token rails (signed tokens, `property_previews`-style), then require auth on the GET.
2. **Upload re-shell.** `/upload` (glass.css) still lives outside the L2 app shell; agents bounce between two visual worlds when ordering. Re-shell the upload flow into the authed app frame.
3. **CSS / L1–L2 consolidation.** The deliberate two-language split (L1 editorial-dark marketing/auth · L2 soft app-shell) stands, but inside L2 there are still scoped-var islands (`.studio-scope`, glass.css) that should converge on the shared primitives kit page-by-page.
4. **`pending_payment` in the `PropertyStatus` union.** AgentHome carries a commented `as string` cast until the payment flow ships the type update.
5. ~~Pre-existing TSC debt~~ — resolved during the run: main's 28-error baseline was driven to **0** (`tsc --noEmit` clean at branch close), so no debt carries forward.
6. ~~**Adopt `MoneyValue` at remaining `fmtCents` call sites.**~~ **DONE (2026-06-12, commits `5726450` + `fba1e0e`).** `MoneyValue` is now the sole JSX money-rendering path across all dashboard surfaces (Overview, Finances, Billing, Listings, LabListings, LabListingDetail, Properties). String contexts use the new `fmtMoney` helper. An ESLint `no-restricted-syntax` rule in `eslint.config.js` bans direct `fmtCents` calls in `src/pages/dashboard/**` and `src/components/dashboard/**` so the contract cannot be bypassed going forward.

---

## 5. Verification

- `pnpm vitest run --maxWorkers=2` — 150 files / 1333 tests passed, 2 skipped (pre-existing integration skip), 0 failed.
- `pnpm exec tsc --noEmit` — 0 errors at branch close (main baseline was 28; gate was ≤23).
- Every commit on the branch is forensic (what/why/files/before→after/rollback); each is independently revertible — no migrations, no schema changes, no env changes anywhere on the branch.
- Hard rules held: no sample-data KPIs (removed, not added), Inter only, no Helgemo branding, marketing/auth (L1) untouched.
- **Correction (QA gate, 2026-06-11):** The Delivery SLA card shipped with three fabricated values (hardcoded `↑ 2.1%` delta, hardcoded `of 156` denominator, hardcoded `42m`/`1h 12m` MiniStats) and three unwired buttons ("Today's brief", "View pipeline", "All agents"). These were fixed by the QA-gate fix pass on this branch.
- **Update (2026-06-12, commits `5726450` + `fba1e0e`):** `MoneyValue` is now fully adopted across all dashboard surfaces; `fmtCents` in JSX is banned by ESLint. The earlier correction note that MoneyValue had "zero production call sites" is no longer accurate — §4 item 6 has been closed.
- **Update (2026-06-12, commits `b71f42d`, `447b89c`, `4e6b7f0`, `49ae204`, `35180a9`):** Additional hardening post-docs(finish): `/api/logs` auth gate; `StatusPill` delegates to `orderStatusEntry`; `useUnreadCount` role-aware; GET status response narrowed to `{status,label,currentStage,totalStages}`; per-source degraded badges on Overview/Finances; AgentHome progress timeline + qualitative ETA; AgentHome hero card for newest delivered order. See session note for per-commit detail.
