# Round 2 — Window C — Bucket-Progress Dashboard

Last updated: 2026-04-21
Branch: reuse `session/ledger-2026-04-21` (rebase onto main first) OR fresh `session/bucket-progress-2026-04-21`
Worktree: `/Users/oliverhelgemo/real-estate-pipeline/.worktrees/wt-ledger`

## Why this brief exists

Round 1 shipped the Rating Ledger — Oliver can now see every rating he's ever given, linked to image, clip, SKU, stars. Round 2 closes the loop: show Oliver **bucket-level progress** so that as he rates the 5 quota-high buckets (Window D's Round 2 grid), the dashboard fills up in real time. Ratings stop "going into an abyss."

The 5 quota buckets are: **kitchen × push_in**, **living_room × push_in**, **master_bedroom × push_in**, **exterior_front × push_in**, **aerial × drone_push_in**. Each bucket's winner is a SKU with ≥3 iterations AND ≥80% of those rated 4★+.

## North Star you are serving

Criterion **#1 — no HITL** via transparency. This closes the ML-loop visibility gap. Secondary: directly supports criterion **#4 — right SKU per (room × movement)** by making Window D's rating session actionable.

## Required reading (in order)

1. `docs/HANDOFF.md`
2. `docs/audits/router-coverage-2026-04-21.md` — Window D's audit; your data source for the 5 bucket list + winner rule
3. `scripts/build-router-table.ts` — Window D's aggregator; mirror its query shape server-side rather than importing (keep C's endpoint self-contained)
4. `docs/sessions/2026-04-21-window-C.md` — your Round 1 log + verification gap note
5. `src/pages/dashboard/RatingLedger.tsx` + `api/admin/rating-ledger.ts` — your existing Round 1 code

## Scope

### Must do

1. **New endpoint `api/admin/bucket-progress.ts`**. GET, `requireAdmin`. Returns:
   ```ts
   type BucketProgress = {
     bucket_id: string;              // 'kitchen_push_in' etc.
     room_type: string;
     camera_movement: string;
     total_iter: number;             // all iter, all SKUs, in this bucket
     total_rated_4plus: number;      // iter with rating >= 4
     sku_breakdown: Array<{
       sku: string;                  // 'kling-v2-6-pro' etc.
       iter_count: number;
       rated_4plus_count: number;
       win_rate: number;             // rated_4plus_count / iter_count
     }>;
     winner: { sku: string; win_rate: number } | null;
     status: 'WINNER' | 'NO_WINNER' | 'EMPTY';
   };
   ```
   Reads from `prompt_lab_listing_scene_iterations` (Phase 2.8 Lab) first for SKU-granular data; fall back to `scene_ratings` + `prompt_lab_iterations` for provider-level context. Winner rule: ≥3 iter on a single SKU, ≥80% at 4★+. Tiebreak: higher avg rating, then cheaper per-clip cost.

2. **Extend `RatingLedger.tsx` with a top strip**. Five cards, one per bucket. Each shows:
   - Bucket label (`kitchen × push_in`)
   - Progress bar: iter count / 3-minimum (≥3 triggers winner eligibility)
   - Stars bar: 4★+ rate within the leading SKU
   - Status chip: 🟢 WINNER / 🟡 NO_WINNER / 🔴 EMPTY
   - Winner SKU label (if any)
   - Total iter count + SKU count

   Cards should be compact horizontal tiles above the existing ledger table. Use existing Card / Badge / Progress components from the app.

3. **Auto-refresh** — poll the endpoint every 30s while the page is open. When Oliver rates a clip in the Lab (separate tab), the dashboard picks it up without a manual refresh.

4. **Filter pass-through** — when a bucket card is clicked, filter the ledger table below to show only that bucket's iterations. Click again to clear.

5. **Config for buckets** — the 5 buckets are defined in a const at top of the endpoint file (not hardcoded across multiple files). Schema: `{ room_type, camera_movement, label }`. Easy to edit when Oliver adds a 6th bucket later.

6. **Smoke test** — `vite build` + `tsc --noEmit` + `vitest run` all clean. Note the same Round 1 verification gap: Vite doesn't serve /api/*, so full UI→API→data requires Oliver's authenticated browser session on a deployed preview. Flag in session log.

7. **Docs-subagent + commits** in ≥3 chunks: (a) endpoint, (b) page strip + client, (c) click-to-filter + polling + docs.

### Must NOT do

- Do NOT import from `scripts/build-router-table.ts` — keep C's endpoint self-contained (easier to evolve independently).
- Do NOT change the existing RatingLedger filters or table — add above it.
- Do NOT hardcode bucket IDs in more than one place.
- Do NOT add renders; this is zero-budget.
- Do NOT edit files outside this worktree.
- Do NOT push.

## Self-check protocol (MANDATORY)

Session log: `docs/sessions/2026-04-21-window-C-round-2.md`. Every ~45 min + each milestone:

- **(a) Criterion?** Expected: #1 no HITL via transparency. If your work stops supporting that, pivot.
- **(b) Highest-leverage?** Pivot triggers:
  - Endpoint query gets complex enough to take >1h — simplify; drop `sku_breakdown` detail if needed; winner + status chips are the must-ship.
  - Auto-refresh polling causes lag — fall back to manual refresh button; ship that first.
  - Click-to-filter integration fights existing toolbar — drop the filter link for Round 2, ship cards-only.
- **(c) Evidence?** Endpoint returns valid shape? Page renders ≥3 cards with non-zero iter counts? `tsc` clean? `vitest` green?
- **(d) Pivot? → STOP, commit WIP, document.**

**Stuck >30 min:** commit WIP, write `docs/sessions/2026-04-21-window-C-round-2-blocker.md`, ping Oliver.

## Exit criteria (3 hours)

- [ ] `api/admin/bucket-progress.ts` endpoint committed + type-checks
- [ ] `RatingLedger.tsx` has the 5-bucket strip visible at top
- [ ] At least one card renders with real data (existing ratings produce non-zero iter counts for some buckets — the `aerial × drone_push_in` bucket has the most existing data, should show most iterations)
- [ ] Status chips render (expected: all 🔴 EMPTY or 🟡 NO_WINNER until D's grid ratings land)
- [ ] Auto-refresh working (DevTools Network tab shows polling)
- [ ] Optional: click-to-filter — if skipped, note in session log
- [ ] Committed in ≥3 chunks on the session branch
- [ ] Session log + docs-subagent run

## Budget

**$0 renders.** If any render is attempted, STOP.

## If you finish early

1. Add a summary-stats strip above the buckets: total ratings across all surfaces, avg rating, % with comments, % with retrieval-ready data (has_embedding + has_model_used).
2. Add a "recent rating" feed — last 5 ratings, timestamped, with clip preview — so Oliver can see the most recent signal without hunting.

## Success definition

When Oliver rates a D-rendered clip in the Lab, he can open `/dashboard/rating-ledger` in another tab, refresh (or wait 30s for auto-poll), and SEE the corresponding bucket card update its iter count, its winner status chip, and — once ≥3 iter at ≥80% 4★+ — flip from 🟡 to 🟢. The loop visually closes.
