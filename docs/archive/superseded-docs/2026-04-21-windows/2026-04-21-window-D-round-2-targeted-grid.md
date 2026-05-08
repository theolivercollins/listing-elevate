# Round 2 — Window D — Targeted-Grid Rating Harness

Last updated: 2026-04-21
Branch: `session/router-2026-04-21` (same as Round 1)
Worktree: `/Users/oliverhelgemo/real-estate-pipeline/.worktrees/wt-router`

## Why this brief exists

Round 1 verdict: 170 rated iterations across 3 surfaces → 32 (room × movement) buckets → **0 winners**, because 68% of those ratings only know provider family (kling/runway/atlas), not the SKU. See `docs/audits/router-coverage-2026-04-21.md`. The "audit-first, no fresh rating grid" path is dead.

But you identified **5 quota-high buckets** where a small rating session would unlock a real router-table. Phase 2.8 Lab natively captures `model_used` going forward, and your aggregator script (`scripts/build-router-table.ts`) is idempotent: re-run it after any rating session and winners emerge without code changes.

**Your Round 2 job:** remove every obstacle between Oliver and rating those 5 buckets. No router-wiring yet (there's nothing to wire). Just make the rating session trivial.

## North Star you are serving

Criterion **#4 — right SKU per (room × movement)** directly. Downstream unblocks **#1 no-HITL** and **#3 no-wasted-money** (both depend on the router auto-selecting correctly).

Criterion **#2 no-hallucinations** is Window B's independent track. DA.1 landing is a soft prerequisite for rendering this grid — see Sequencing below.

## Required reading (in order)

1. `docs/audits/router-coverage-2026-04-21.md` — your own Round 1 output; identify the 5 quota-high buckets by name
2. `docs/briefs/2026-04-21-window-D-router-aggregation.md` — Round 1 brief, for context
3. `docs/sessions/2026-04-21-window-D.md` — your own session log
4. `lib/providers/atlas.ts`, `lib/providers/kling.ts`, `lib/providers/router.ts` — SKU candidate set + current dispatch logic
5. `lib/prompt-lab-listings.ts` + `api/admin/prompt-lab/listings/*` — how Phase 2.8 Lab iterations get seeded and persisted
6. `~/.claude/projects/-Users-oliverhelgemo/memory/project_kling_sku_observations.md` — Oliver's informal SKU intuition (O3 Pro = least movement, V2.6 Pro best for single-image, V3 Std ≈ V3 Pro but worse); use this to rank SKU candidates per bucket
7. `~/.claude/projects/-Users-oliverhelgemo/memory/project_router_table_aggregation.md` — your own Round 1 verdict

## Sequencing (hard constraint)

**Do NOT render until Window B's DA.1 is merged to main.** Reason: DA.1 adds `motion_headroom` hard bans at the director. Rendering your grid before DA.1 means some director prompts will still hallucinate geometrically impossible moves, polluting your signal. All non-rendering prep (photo selection, SKU candidate list, seeding script, test harness) can proceed in parallel while B lands.

At the start of each self-check, confirm: "Is DA.1 on main yet?" (`git log --oneline main -5 | grep -i gemini` from the main worktree). If no: keep building prep. If yes: rebase your branch onto main, then proceed to render.

## Scope

### Must do

1. **Identify the 5 quota-high buckets.** Extract from your own coverage audit. Record them in your session log with the evidence that made each one quota-high (e.g., "master bedroom × push_in: 14 existing iterations, 0 SKU-granular, frequently requested in listings Lab").
2. **Select candidate SKUs per bucket.** For each bucket, list 3–5 SKU candidates to render. Use the authoritative SKU set from `lib/providers/*`. Filter by: which SKUs can actually serve this movement (per router.ts dispatch rules)? Which are cheap enough to be tolerable failures? Which has Oliver already expressed intuition about (per the memory file)? Document each choice.
3. **Select one representative photo per bucket.** Reuse photos already in the listings Lab corpus where possible — same photos Oliver has already seen reduces his cognitive load at rating time. For each photo, record: `prompt_lab_listing_photos.id`, `image_url`, and why it cleanly represents this bucket.
4. **Write `scripts/seed-router-grid.ts`** — a script that:
   - Takes the (bucket, SKU-candidates, photo) tuples as a const in the file (or JSON in `scripts/router-grid-config.json`)
   - Creates (or reuses) ONE Phase 2.8 Lab listing session named `Router Grid 2026-04-21 — 5 Quota Buckets`
   - Creates one scene per bucket (5 scenes), each linked to its photo
   - Pre-queues iterations — one per SKU candidate per scene — via the existing listings-Lab render pipeline so they persist to `prompt_lab_listing_scene_iterations` with `model_used` populated natively
   - Has a `--dry-run` flag (default) that prints what it WOULD do without spending
   - Logs every render intent to `docs/audits/test-render-log-2026-04-21.md` BEFORE the render starts
5. **Dry-run first, always.** Paste the dry-run output into your session log. Self-check against budget BEFORE triggering renders.
6. **Wait for DA.1 on main.** Block the actual render step on this. Update session log with the wait state.
7. **Once DA.1 is on main:** rebase your branch (`git fetch && git rebase origin/main` inside your worktree), re-run dry-run (DA.1 may filter some SKU × movement combos), then trigger the renders.
8. **Monitor renders to completion.** Every render row logged to the shared test-render log with timestamp, SKU, cost, clip URL / task ID. Spot-check one clip from each bucket loads correctly.
9. **Smoke-test the rating surface.** Open the Lab locally (`npm run dev`), navigate to the `Router Grid 2026-04-21` session, confirm every iteration renders a clip and every iteration's row shows a `model_used` SKU badge. If any iteration is missing its SKU field, STOP and flag Oliver — that's the one bug that would invalidate the whole exercise.
10. **Write Oliver's rating workflow note** at `docs/briefs/2026-04-21-rating-session-prep.md`: a one-page, no-decisions doc that says exactly:
    - "Open this URL: `http://localhost:5173/dashboard/prompt-lab/listings/<id>`"
    - "You will see 5 scenes, each with 3–5 iterations."
    - "Rate every iteration 1–5★ based on whether the camera move actually works for the room type."
    - "Estimated time: ~30 minutes."
    - "When done, tell the coordinator in Window A."
11. **Commit in ≥3 logical chunks** on your branch: (a) seeding script + config, (b) dry-run artifacts + session log, (c) render results + rating-prep doc.
12. **Docs-subagent before every commit.**

### Must NOT do

- **Do NOT wire `router-table.draft.ts` into `lib/providers/router.ts`.** There is nothing to wire. Winners are zero until ratings land.
- Do NOT invent a new rating UI, batch-rate endpoint, or RLM. Use the existing Phase 2.8 Lab surface exactly as-is.
- Do NOT render before DA.1 is on main.
- Do NOT render outside the $40 budget. One hard stop.
- Do NOT ask Oliver any configuration questions. He rates; he does not configure.
- Do NOT edit files outside this worktree.
- Do NOT push.

## Self-check protocol (MANDATORY)

Append to the same session log `docs/sessions/2026-04-21-window-D.md`. Every ~45 minutes + at every milestone:

- **(a) Criterion served?** Expected: #4 right SKU per (room × movement).
- **(b) Highest-leverage next step?** Key pivot triggers:
  - If DA.1 drags past 2h into Round 2 → do all non-rendering prep, then stop and hand back to coordinator rather than render on stale code.
  - If 5 buckets turn out to have <3 SKU candidates each (bucket is exotic) → drop that bucket, promote a 6th from the next-tier list.
  - If a photo you picked has `motion_headroom[movement] === false` once DA.1 lands → swap the photo, don't override DA.1.
  - If dry-run projects >$40 → trim SKU candidates to the top 3 per bucket, not all 5.
- **(c) Evidence?** Dry-run output compiles and projects realistic cost? Seeding script idempotent (running twice doesn't double-create)? Rendered clips load? `model_used` populated on every row?
- **(d) Pivot? → STOP, commit WIP, document, ping Oliver.**

**Stuck >30 min:** commit WIP, write `docs/sessions/2026-04-21-window-D-blocker.md`, ping Oliver.

## Docs-subagent (before every commit)

Sonnet subagent prompt:

> "Update `docs/HANDOFF.md` (one-line Recent shipping log entry; update Right now if the Phase B next-action just changed — e.g., from 'rating session pending' to 'grid rendered, ready to rate'). Update `docs/state/PROJECT-STATE.md` Phase B section. Update `~/.claude/projects/-Users-oliverhelgemo/memory/project_router_table_aggregation.md` with the grid-render step's outcome. `git status` — confirm only files inside `.worktrees/wt-router/` touched. Commit with a clean Conventional-Commits message."

## Exit criteria (3 hours)

- [ ] 5 quota-high buckets identified with evidence in session log
- [ ] SKU candidate list per bucket, documented with rationale
- [ ] One representative photo per bucket, documented
- [ ] `scripts/seed-router-grid.ts` + `scripts/router-grid-config.json` (or equivalent) committed
- [ ] Dry-run output captured in session log
- [ ] IF DA.1 on main: grid rendered, every iteration has `model_used`, every clip loads, total spend ≤$40 confirmed via `cost_events` query
- [ ] IF DA.1 NOT on main yet: prep complete, session log explains the wait state, no renders triggered
- [ ] `docs/briefs/2026-04-21-rating-session-prep.md` written (Oliver-facing, zero-decision rating workflow)
- [ ] Committed in ≥3 chunks on `session/router-2026-04-21`
- [ ] Session log has self-check entries
- [ ] Docs-subagent run

## Budget

**Render cap: $40 total this window.** Hard stop. Reconcile against `cost_events` at the end and record the number.

Rough projection to sanity-check your dry-run:
- 5 buckets × 4 SKUs avg × 1 scene = 20 renders
- Average ≈ $1.50/render across Kling SKUs → ~$30
- Headroom for 1–2 retries on failed renders

If projected spend >$40, trim candidate SKUs (top 3 per bucket is fine) before triggering.

## If you finish early

Do NOT freelance into Window B or C territory. Instead: one of the following, pick highest-leverage:

1. **SKU backfill scout.** Query `prompt_lab_iterations` (legacy Lab) for any log-line or config evidence that could let you retro-populate the SKU field on a subset of the 108 legacy ratings. Write a dry-run backfill script only — do not execute. Even 20% recovery would roughly double usable SKU-granular signal.
2. **Coverage heatmap data endpoint.** Expose a GET at `api/admin/router-coverage` that returns the same data as your coverage audit in JSON, so Window C's Round 2 Ledger heatmap can read live data instead of parsing a markdown file.
3. **Cost-aware SKU-rank prep.** Write a second script that emits, per bucket, the SKU candidates **ranked by cost × Oliver's prior intuition** (from `project_kling_sku_observations.md`) — so when ratings land and ties occur, the tiebreak is already documented.

## Success definition

At end of Round 2, Oliver should be able to rate the grid in ≤30 minutes of his time, with zero setup on his end. That is the entire deliverable. Everything else (router-wiring, winner emergence, Phase B close-out) is Round 3 and beyond, and happens automatically once he rates.
