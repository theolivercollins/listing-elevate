# Session 2026-06-11 — Authed-app role split (team run)

Last updated: 2026-06-11

See also:
- [../HANDOFF.md](../HANDOFF.md) — current state
- [../state/PROJECT-STATE.md](../state/PROJECT-STATE.md) — authoritative state
- [../specs/2026-06-11-authed-app-role-split-design.md](../specs/2026-06-11-authed-app-role-split-design.md) — full design rationale (JTBD, IA maps, security findings)

Team-code run (council mode) on Oliver's request: "freshen up the listing elevate back-end to be more modern, more intuitive, more user forward (agent end and owner operator end)…". Interpreted as a UX/IA redesign of the logged-in app surfaces for both roles. Council chairman synthesis ran on its configured model — no Opus substitution needed (the earlier failure was a transient session limit; the rerun succeeded normally).

## What shipped (branch `feat/authed-app-role-split`, PREVIEW-ONLY — not pushed, not deployed)

- Commit `25943b9` — role-split routes: `/dashboard` parent now RequireAuth; DashboardIndex branches admin → Overview, user → AgentHome; **P0 fix**: killed the non-admin redirect loop (`/account` ↔ `RequireAdmin`) that locked agents out of the authed app entirely; routes extracted from App.tsx → AppRoutes.tsx; 12-case route×role matrix test.
- Commit `1140657` — **P0 fix**: PATCH `/api/properties/:id/status` was fully unauthenticated; now verifyAuth + owner-or-admin (401/403), 6 tests.
- Commit `42cd29b` — shared kit: `ORDER_STATUS_MAP` (customer-facing status vocabulary), StatusChip / EmptyState / MoneyValue primitives; removed Overview's sample-data fallbacks (fake activity + fake provider mix → honest empty states).
- Commit `e0b58c0` — AgentHome real landing ("Your studio": order CTA, in-production / needs-attention / delivered buckets, live data only); role-derived sidebar (5-item "Client studio" set for agents); closed dead nav loops (Status "View all videos" dead route, UploadSuccess → "View my orders").
- Commit `abab9e9` — review-gate P1: `pending_payment` added to ORDER_STATUS_MAP ("Awaiting payment") + AgentHome "Finish checkout" recovery section; PATCH now returns proper 404.
- Commit `93d6d17` — operator Today landing: NeedsYouStrip (needs_review + failed-today, deep-linked) + ProviderHealthRow (24h error chips, named balance-error alerts — would have caught the Atlas-402 outage); sidebar regrouped Operate / Studio / Business; TopNav dead nav code deleted.
- Commit `1bd0285` — idiom sweep: Profile.tsx 29 inline styles → canon Tailwind; 7 pre-existing TSC errors fixed (28 → 21).
- Commit `bc5ef6f` — safety gate: **P0** GET `/api/properties` was unauthenticated + tenant-unscoped (leaked all customers' data); **P1** GET `/api/properties/:id` leaked cost_events to anyone; **P2** owners could set ops statuses. All gated + 13 new tests.
- Commit `d5b1ebd` — design rationale spec, HANDOFF update, this note (original docs(finish)).

(`bca774e`/`8288c20` at the branch root are a stray docs commit + its own revert — net zero.)

## Post-docs(finish) commits (8 additional, 2026-06-11–12)

- `b71f42d` — review-gate P1/P2: `StatusPill` delegates to `orderStatusEntry` (kills internal vocab on agent surfaces); `/api/logs` gains `requireAdmin` guard (was firing unauthenticated for every agent page load); `useUnreadCount` made role-aware — skips both fetches when `isAdmin=false`.
- `60d36c5` — QA-gate fixes: agent Billing → `stripe_amount_cents` (not `total_cost_cents`); Listings rows → `/status/:id` (not admin-gated `/dashboard/properties/:id`); Overview SLA card live data + three dead buttons wired; AgentHome "delivered" status bucket added + API errors surfaced explicitly; spec §2/§5 corrected (MoneyValue zero-call-sites at docs(finish) time).
- `5726450` — MoneyValue fully adopted: all JSX cost render sites in Overview, Finances, Billing, Listings, LabListings, LabListingDetail, Properties replaced with `<MoneyValue>`; string contexts use new `fmtMoney` helper; 10 new tests.
- `fba1e0e` — ESLint ban: `no-restricted-syntax` rule on `fmtCents` calls in `src/pages/dashboard/**` + `src/components/dashboard/**`; remaining three files (LabListings, LabListingDetail, Properties) swept to finish WS1a.
- `447b89c` — degraded badges: `costFailed`/`healthFailed` state on Overview and `costBreakdownFailed` on Finances; amber `DegradedBadge` + Retry replaces silent $0/empty when a fetch rejects; 4 new tests.
- `35180a9` — GET `/api/properties/:id/status` narrowed: returns `{status,label,currentStage,totalStages}` only; address, video URLs, timing data, clip counts stripped; 2 new tests for exact key-set and label correctness.
- `4e6b7f0` — AgentHome: 5-stage progress strip (Received → Crafting scenes → Rendering → In review → Delivered) on every In-Production card; qualitative ETA phrase (omitted unless ≥3 delivered samples; digit-free); 3 new tests.
- `49ae204` — AgentHome: hero card for newest delivered order with `horizontal_video_url`; Watch/Download/Share actions; degrades if no URL; 2 new tests.

## Verification (branch tip, 2026-06-12)

- `pnpm vitest run --maxWorkers=2` — 153 files / 1349 tests passed, 2 skipped, 0 failed.
- `pnpm exec tsc --noEmit` — 0 errors.
- No migrations, no env changes, no API contract breaks anywhere on the branch.

## What's next

Oliver reviews the design rationale spec + branch; push/preview-deploy/promotion is his call. Remaining deferred follow-ups (spec §4): move emailed status links to preview-token rails then fully close GET `/api/properties/:id/status`; Upload re-shell into L2; L2-internal CSS consolidation; add `pending_payment` to the PropertyStatus union with the payment flow. (MoneyValue adoption — §4 item 6 — is now closed.)

## Questions answered this session

- "Back-end" = the logged-in app surfaces, not server code.
- One shell, two role-derived nav sets — no second design language; L1/L2 split from the 2026-06-09 consistency pass stands; marketing/auth untouched.
- Label renames (Pipeline→Orders, Users→Agents, Overview→Today) without URL changes.
- GET status endpoint stays open deliberately until emailed links are migrated (documented, not forgotten).
