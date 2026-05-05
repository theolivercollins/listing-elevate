# Round 1 — Window D — Router-Table Aggregation Script

Last updated: 2026-04-21
Branch: `session/router-2026-04-21`
Worktree: `/Users/oliverhelgemo/real-estate-pipeline/.worktrees/wt-router`

## Your mission

Build `scripts/build-router-table.ts` — a script that reads **every rating Oliver has given across all three surfaces** (legacy Prompt Lab, Phase 2.8 listings Lab, prod `scene_ratings`), aggregates them by (`room_type` × `camera_movement` × `sku`), and emits:

1. A **draft `lib/providers/router-table.ts`** file — one row per (room × movement) with the winning SKU where a winner exists. DO NOT commit this into the wired production path yet; it's Round 2's job to wire it.
2. A **coverage-gap report** at `docs/audits/router-coverage-2026-04-21.md` showing which (room × movement) buckets have ≥3 iterations with a ≥80% 4★+ winner, which have data but no clear winner, and which are empty.

Goal: answer "can we build router-table.ts from existing signal without a fresh rating session?" with evidence, not opinion.

## North Star you are serving

Criterion **#4 — right SKU per (room × movement)**, which drives #1 (no HITL — pipeline picks SKU itself) and #3 (no wasted money — correct SKU first try).

## Required reading (in order, before any edits)

1. `/Users/oliverhelgemo/real-estate-pipeline/docs/HANDOFF.md`
2. `/Users/oliverhelgemo/real-estate-pipeline/docs/state/PROJECT-STATE.md`
3. `/Users/oliverhelgemo/real-estate-pipeline/docs/specs/2026-04-21-daily-engagement-design.md` (the plan)
4. `/Users/oliverhelgemo/real-estate-pipeline/docs/specs/2026-04-20-back-on-track-design.md` — Phase B section. Your script is the automated alternative to the manual rating grid.
5. `/Users/oliverhelgemo/real-estate-pipeline/docs/audits/ML-AUDIT-2026-04-20.md` — especially the M.2d SKU-capture findings
6. Code orientation:
   - `lib/providers/router.ts` — current dispatch logic (understand it, do NOT modify)
   - `lib/providers/atlas.ts` / `lib/providers/kling.ts` / `lib/providers/runway.ts` — the provider surface + SKU naming conventions
   - `lib/db.ts` — schema types
   - Existing scripts: `scripts/cost-reconcile.ts`, `scripts/backfill-scene-embeddings.ts` — use them as style templates

## Scope

### Must do

1. **Design the aggregation query.** For each of the three rating surfaces, join rating → scene/iteration → source photo → model_used. Normalize SKU strings to the canonical set: `kling-v3-pro`, `kling-v3-std`, `kling-v2-6-pro`, `kling-v2-1-pair`, `kling-v2-master`, `kling-o3-pro`, `runway-gen-4`, `native-kling-v2-0`, etc. (check `lib/providers/` for the authoritative set).
2. **Define the winner rule** (from the Phase B spec):
   - Bucket: (room_type, camera_movement)
   - Winner candidate: a SKU with ≥3 iterations in this bucket AND ≥80% of those iterations rated ≥4★
   - If multiple SKUs qualify, pick the one with the higher average rating; tiebreak by cheaper per-clip cost
   - If no SKU qualifies: bucket has no winner (→ gap list)
3. **Write `scripts/build-router-table.ts`** that:
   - Takes `--dry-run` flag (default true) that prints the table + coverage report to stdout instead of writing files
   - With `--write`, writes `lib/providers/router-table.draft.ts` (DRAFT — not the active one) and `docs/audits/router-coverage-2026-04-21.md`
   - Prints a summary: N buckets total, N with winners, N with data-but-no-winner, N empty
4. **Run it once** in `--dry-run` mode, paste the output into your session log for review.
5. **Run it with `--write`** once you're satisfied the output looks sane; review the generated files.
6. **Write the coverage report** in a shape that's useful for humans: a table grouped by room_type, with columns [movement, winner_sku, win_rate, iter_count, status (WINNER / NO_WINNER / EMPTY)]. Include a short "Interpretation" section at the top: does Oliver's existing signal support building a real router table, or are there so many gaps that a fresh rating session is unavoidable?
7. **Do NOT wire the draft router-table.ts into `lib/providers/router.ts`.** That's explicitly Round 2's job, and it's gated on Window B's audit verdict.
8. **Update docs + memory via docs-subagent (see below).**
9. **Commit in ≥2 logical chunks** on your branch.

### Must NOT do

- Do not modify `lib/providers/router.ts`, `lib/pipeline.ts`, or any code path actually used by prod/Lab. Read-only against production code; write-only to `scripts/` + `docs/` + the `.draft.ts` output.
- Do not run any renders. Your work is pure data aggregation.
- Do not edit files outside this worktree.
- Do not push.

## Self-check protocol (MANDATORY)

Keep a live session log at `/Users/oliverhelgemo/real-estate-pipeline/docs/sessions/2026-04-21-window-D.md`. Every ~45 minutes + at every milestone, append a **Self-check** answering:

- (a) Which of Oliver's 4 criteria am I serving? (Expected: #4 right SKU per bucket.)
- (b) Is this the highest-leverage next step, or would a different approach close the gap faster? (Example pivot: if the SKU field is mostly missing across surfaces — M.2d didn't backfill it historically — the most useful output is a SKU-presence coverage report that tells Oliver whether a rating-session is unavoidable, not a half-empty router table.)
- (c) Evidence it's working? (Query returns rows? Aggregation counts match intuition? Draft table compiles?)
- (d) If (b) says pivot — stop, commit WIP, document the pivot.

**If stuck >30 minutes:** commit WIP, write `docs/sessions/2026-04-21-window-D-blocker.md`, ping Oliver.

## Docs-subagent (before every commit)

Dispatch a Sonnet subagent:

> "Update `/Users/oliverhelgemo/real-estate-pipeline/docs/HANDOFF.md` (one-line Recent shipping log entry). Update `/Users/oliverhelgemo/real-estate-pipeline/docs/state/PROJECT-STATE.md` to flag Phase B's router-table is now auto-derivable (or document the gaps found). Add/update `/Users/oliverhelgemo/.claude/projects/-Users-oliverhelgemo/memory/project_router_table_aggregation.md` (type: project) summarizing coverage findings. Then `git status`, confirm only files in `.worktrees/wt-router/` touched, commit."

## Exit criteria (3 hours)

- [ ] `scripts/build-router-table.ts` runs clean in dry-run mode and prints a readable table + coverage report.
- [ ] `lib/providers/router-table.draft.ts` committed (draft only — do NOT commit it as `router-table.ts` without `.draft`).
- [ ] `docs/audits/router-coverage-2026-04-21.md` committed with a clear Interpretation paragraph: "yes, existing signal is enough to build a real router table" OR "no, the SKU field is missing on N% of ratings — a fresh rating session is needed for these buckets" — backed by numbers.
- [ ] Committed in ≥2 chunks on `session/router-2026-04-21`.
- [ ] Session log exists with self-check entries.
- [ ] Docs-subagent has run.

## Budget

Zero dollars. Zero renders. If you touch anything that costs money, STOP.

## If you finish early

Do NOT freelance into Window B or C territory. Instead: produce a second coverage artifact — per-photo-type coverage (not just room_type × movement, but camera_height × frame_coverage × movement once DA.1 lands). This primes Round 2's router-wiring step and future-proofs against the DA.1 taxonomy that Window B is landing.
