# Window C — Round 2 — Bucket-Progress Dashboard — Session Log

Last updated: 2026-04-21
Branch: `session/ledger-2026-04-21` (rebased onto main after Round 1 consolidation)
Worktree: `.worktrees/wt-ledger`
Brief: `docs/briefs/2026-04-21-window-C-round-2-bucket-progress.md`

Deliverable: a top-of-page 5-tile strip on `/dashboard/rating-ledger` showing live progress for the quota-high buckets (kitchen × push_in, living_room × push_in, master_bedroom × push_in, exterior_front × push_in, aerial × drone_push_in). 30s auto-poll so Lab ratings flow into the dashboard without a reload.

## Design decisions

- **5 buckets defined once** in a `const BUCKETS` at top of `api/admin/bucket-progress.ts`. UI reads from the endpoint — no duplication.
- **SKU-level signal** sourced from Phase 2.8 (`prompt_lab_listing_scene_iterations.model_used`) only. Legacy Lab + prod contribute to `total_iter` + `total_rated_4plus` (so Oliver sees the full signal volume for the bucket) but cannot populate `sku_breakdown` since they only store provider family. Matches the router-coverage audit's conclusion.
- **Winner rule** (from router-coverage audit): `n_iter >= 3 AND win_rate >= 0.80`. Tiebreak: higher `avg_rating`, then cheaper `priceCentsPerClip` from `ATLAS_MODELS` (atlas provider) / 0 (native kling).
- **Status**: `WINNER` if a qualifying SKU exists; `EMPTY` if `total_iter === 0`; else `NO_WINNER`.
- **Auto-refresh**: `setInterval(30_000)` client-side; `Page Visibility API` pause when tab hidden (polite behavior, doesn't burn Supabase quota).
- **Click-to-filter**: card click pushes `{ room_type, camera_movement }` into the existing ledger state; a new bucket filter is ANDed with surface/sku/rating/comment. Card re-click clears.

## Plan

1. Read remaining context (brief + router-coverage audit + script query shape). ✅ done
2. Session log + self-check #1. ← this
3. `api/admin/bucket-progress.ts` — GET admin endpoint; three-surface fetch; SKU aggregation; winner selection; constant BUCKETS array. Commit 1.
4. `src/pages/dashboard/RatingLedger.tsx` — add `BucketProgressStrip` section + client fetch via `src/lib/bucketProgressApi.ts`; 30s polling. Commit 2.
5. Extend ledger filter state with `{ room_type, camera_movement }` coming from bucket clicks. Thread through the existing `/api/admin/rating-ledger` query. Commit 3 (+ docs via docs-subagent).

## Self-check 1 — kickoff (pre-code)

- **(a) Criterion?** #1 "no HITL" via transparency. When Oliver rates a D-grid clip, he sees the card update → the ML loop visually closes. Secondary: #4 "right SKU per (room × movement)" — the strip is the scoreboard that shows when he has enough signal to flip a bucket to WINNER.
- **(b) Highest-leverage next step?** Yes — endpoint first (UI blocked on it). Pivot triggers: if aggregation gets complex >1h, drop `sku_breakdown` and ship just `total_iter + status + winner`. If polling turns flaky, fall back to a manual refresh button.
- **(c) Evidence?** Pre-code. Read brief + audit + existing ledger API. Confirmed schema reuse is clean: same three-surface pattern as Round 1, plus `ATLAS_MODELS.priceCentsPerClip` for tiebreak pricing.
- **(d) Pivot?** No.

## Budget

Zero renders. Same Round 1 smoke-test limitation applies — Vite doesn't serve `/api/*`, so full UI→API verification needs Oliver's authenticated browser session on `vercel dev` or a preview URL. I will verify: `vite build`, `tsc --noEmit` both configs, `vitest run`, dev server `/dashboard/rating-ledger` returns 200 and Vite transforms the new code.

## Self-check 2 — post-build

- **(a) Criterion served** — still #1 (no HITL via transparency): strip gives Oliver a live scoreboard; polling closes the loop without a refresh. Click-to-filter also supports #4 (right SKU per room × movement) by letting him drill from bucket → rows that fed the signal.
- **(b) Highest-leverage?** Yes. No pivot. Shipped the must-do list, plus the optional click-to-filter (scope creep was tempting — resisted adding summary-stats + recent-rating feed; the "if finished early" bullets are Round 3 fodder).
- **(c) Evidence it's working?**
  - `vite build` passes (2.93s, no errors).
  - `npx tsc --noEmit` on both `tsconfig.api.json` and `tsconfig.app.json` — clean on all new files (existing pre-existing errors in `PromptLab.tsx`, `labNextAction.test.ts`, `poll-lab-renders.ts` remain — none touched).
  - `npx eslint` on all 6 new/edited files — clean.
  - `npx vitest run` — 67/67 tests pass, no regressions.
  - Vite dev server `HTTP 200` on `/dashboard/rating-ledger`; Vite-transforms `BucketProgressStrip.tsx` and `bucketProgressApi.ts` cleanly.
- **(d) Pivot?** No.

## Smoke-test limitation — same as Round 1

Full UI→API→DB verification requires Oliver's authenticated browser session (Vite doesn't proxy `/api/*`). Autonomous guardrails I hit:
- Build + typecheck + lint + unit tests all green.
- Vite serves the page + new modules cleanly.
- Endpoint logic mirrors `scripts/build-router-table.ts` (which is known-good per the router-coverage audit).

What needs Oliver's session:
- The 5 cards render with real `total_iter` + `sku_breakdown` from production data (expected: `aerial × drone_push_in` has the most existing Phase 2.8 rows, should show ≥1 iter).
- 30s auto-refresh visible in DevTools Network tab.
- Click-to-filter narrows the ledger rows to matching room_type + camera_movement.

Same flag I raised in Round 1's session log.

## Exit criteria — self-audit

- [x] `api/admin/bucket-progress.ts` committed + type-checks. (commit `be156d8`)
- [ ] `RatingLedger.tsx` has the 5-bucket strip visible at top. (committed in chunk 2, awaiting commit)
- [ ] At least one card renders with real data. (Needs Oliver's session; endpoint logic verified against the router-coverage audit which shows `aerial × drone_push_in` has existing rows.)
- [ ] Status chips render. (Same — UI code shipped, awaiting session.)
- [ ] Auto-refresh working. (Client code uses `setInterval(30_000)` + Page Visibility API; awaiting session verification.)
- [x] Optional click-to-filter — shipped (not skipped). Ledger API + row schema extended with `room_type` + `camera_movement`.
- [ ] Committed in ≥3 chunks — so far 1 (`be156d8`); 2 more pending.
- [x] Session log + docs-subagent — log is live; subagent scheduled for chunk 3.

## Commits so far

- `be156d8` — R2.1 bucket-progress endpoint + session log (chunk 1)
- `aff9d6f` — R2.2 strip + polling + click-to-filter (chunk 2)
- chunk 3 = docs-subagent → HANDOFF.md + PROJECT-STATE.md + memory file → commit
