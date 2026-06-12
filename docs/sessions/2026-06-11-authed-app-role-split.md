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
- Commit (this one) — design rationale spec, HANDOFF update, this note.

(`bca774e`/`8288c20` at the branch root are a stray docs commit + its own revert — net zero.)

## Verification (closing gate)

- `pnpm vitest run --maxWorkers=2` — 150 files / 1333 tests passed, 2 skipped (pre-existing integration skip), 0 failed.
- `pnpm exec tsc --noEmit` — 0 errors at branch close (main baseline 28; gate was ≤ 23).
- No migrations, no env changes, no API contract breaks anywhere on the branch.

## What's next

Oliver reviews the design rationale spec + branch; push/preview-deploy/promotion is his call. Deferred follow-ups (spec §4): move emailed status links to preview-token rails then close GET `/api/properties/:id/status`; Upload re-shell into L2; L2-internal CSS consolidation; add `pending_payment` to the PropertyStatus union with the payment flow.

## Questions answered this session

- "Back-end" = the logged-in app surfaces, not server code.
- One shell, two role-derived nav sets — no second design language; L1/L2 split from the 2026-06-09 consistency pass stands; marketing/auth untouched.
- Label renames (Pipeline→Orders, Users→Agents, Overview→Today) without URL changes.
- GET status endpoint stays open deliberately until emailed links are migrated (documented, not forgotten).
