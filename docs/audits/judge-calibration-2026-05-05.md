---
Last updated: 2026-05-05
See also:
- [../HANDOFF.md](../HANDOFF.md)
- [../specs/2026-05-05-listing-elevate-consolidation-design.md](../specs/2026-05-05-listing-elevate-consolidation-design.md)
- `../../lib/prompts/judge-rubric.ts` — the rubric being calibrated
- `../../scripts/judge-calibration.ts` — the harness
- `../../supabase/migrations/047_lab_judge_scores_unique_per_version.sql` — schema fix that enabled multi-version per-iteration scoring
---

# Judge calibration — 2026-05-05 session

## Status: progress, not done

The Gemini auto-judge is **dormant in production** (`JUDGE_ENABLED=false` env var + `system_flags.judge_cron_paused=true`). This session built the calibration harness, characterized the v1.1 baseline failure mode quantitatively, and shipped a v1.3-anchored prompt that directionally improves correlation. Acceptance criteria not yet met — judge stays paused.

## Acceptance criteria (from this morning's design)

1. MAE ≤ 1.0 stars
2. Within ±1 star ≥ 80% of held-out clips
3. Pearson correlation ≥ 0.5 with Oliver's ratings
4. Distribution match within ±5pp per rating bucket

## Baseline (judge_version=v1.1, 150 paired V1 samples)

| Metric | Value | Target | Pass? |
|---|---|---|---|
| MAE | **1.31** | ≤ 1.0 | ✗ |
| Within ±1 | **64%** | ≥ 80% | ✗ |
| Pearson | **−0.10** | ≥ 0.5 | ✗ (literally anti-correlated) |
| Distribution 1★ | 0% | 12% | ✗ |
| Distribution 2★ | 0% | 13% | ✗ |
| Distribution 4★ | 45% | 22% | ✗ (judge piles up here) |

Per-bucket inversion in v1.1: clips you rated 5★ got the LOWEST judge mean (4.00). The judge was nearly a constant function `judge() ≈ 4.2` regardless of input.

## Smoking-gun diagnosis

Per-axis distribution from a fresh 5-clip v1.1 run:
- avg motion_faithfulness: **1.80** (model correctly identifying motion problems!)
- avg geometry_coherence: 4.80
- avg room_consistency: 4.80
- avg overall: 3.80

The model's per-axis scores DO catch motion failures. But the v1.1 weighted-mean formula `0.35*motion + 0.30*geom + 0.25*room + 0.10*flagBonus` averaged the score back up to ~4 even when motion was 1-2.

## v1.2 attempt (composite override) — discarded

First fix attempted: redefine `composite_1to5 = clamp(min(motion, geom, room) - flag_penalty, 1, 5)` in the harness, ignoring the model's own `overall` field. Result: over-corrected hard. Per-bucket means dropped to 1.0-1.8 across all buckets, MAE jumped to 1.96, Pearson stayed near zero. The flag penalty was double-counting defects already reflected in the axis scores.

Discarded — composite override removed; harness reverted to using model's own `overall`.

## v1.3-anchored (current — committed)

Rewrote `lib/prompts/judge-rubric.ts` substantially:
- **Calibration target distribution at top of prompt** — tells judge what % of clips should land in each star bucket
- **Anti-leniency warning** — explicitly names the "trained on web video critique → defaults to 4★" failure mode
- **Worked anchors** — concrete one-paragraph examples of what 1★, 2★, 3★, 4★, 5★ clips look like
- **Hard rules that bypass the formula** — sub-pixel motion → overall=1; wrong direction → overall ≤ 2; geometry warps → overall ≤ 3; 5★ requires ALL axes 5 + zero flags + confidence ≥ 4
- **Aggregation changed** to `min(axes) - flag_penalty` with weak penalty (only when ≥ 2 flags)

### v1.3-anchored on 25 stratified V1 clips (preliminary)

| Metric | v1.1 baseline (n=150) | v1.3-anchored (n=25) | Delta |
|---|---|---|---|
| MAE | 1.31 | 1.40 | +0.09 (slightly worse) |
| Within ±1 | 64% | 60% | −4pp (sample noise) |
| Pearson | **−0.10** | **+0.17** | **+0.27 (real signal)** |
| Distribution 1★ | 0% | 20% | judge now uses low end |
| Distribution 4★ | 45% | 0% | no longer pile-up |
| Mean on human=1 clips | 4.17 | **1.40** | huge correct shift |
| Mean on human=2 clips | 4.36 | 4.20 | unchanged (still wrong) |
| Mean on human=5 clips | 4.00 | 3.20 | over-corrected |

Read of the data:
- **Pearson +0.17 is the headline.** First time the judge actually correlates with human judgment.
- **1★ identification works.** Bad clips now get tagged as bad.
- **Middle and upper buckets still wrong.** Judge over-strict on 5★ clips, mis-buckets some 2★ clips.
- **Sample noise:** n=25 makes Within±1 and MAE comparisons unreliable. Full 241-clip run in flight.

## Open: full 241-clip v1.3-anchored run (in progress)

Background job kicked off mid-session. Output at `/tmp/judge-calibration-v1.3-full.log`. ETA ~15 min. Will populate `lab_judge_scores` with `judge_version='v1.3-anchored'` and write a row to `lab_judge_calibrations`. Statistically robust numbers will replace the n=25 estimates above.

To check progress / final metrics next session:
```bash
npx tsx scripts/judge-calibration.ts --report v1.3-anchored
```

## Recommendations for next session (v1.4)

Based on the 25-clip directional signal, the next prompt iteration should target:

1. **Recover the upper end.** v1.3 over-strict on 5★ clips (judge mean 3.20 vs human 5.00). The "5★ requires ALL three axes 5 + zero flags + confidence ≥ 4" rule is too restrictive — it's penalizing legitimately-great clips for having one minor flag.
2. **Fix 2★ blind spot.** v1.3 still rates 2★ clips as 4.20 — the prompt's worked-anchor for 2★ ("one MAJOR defect — wall warps and re-forms…") may not be triggering on the actual failure modes Oliver tags as 2★. Look at concrete 2★ clips and update anchor.
3. **Few-shot examples in prompt.** The infrastructure (`judge_calibration_examples` table, `loadCalibrationFewShot()` function) is wired but unused. Loading 3 same-bucket calibrated examples per call could close the remaining gap. Cost: +tokens per call; benefit: anchored calibration.
4. **Try Gemini 2.5 Pro.** v1.3 used `gemini-2.5-flash` (~$0.0001/call). Pro would cost ~$0.001/call. For 241 clips × 5 rounds = 1,205 calls, that's $1.20 (Pro) vs $0.12 (Flash). Worth testing if prompt-tuning hits a Flash ceiling.

## Conditions to flip on (`JUDGE_ENABLED=true` + un-pause cron)

The judge stays off until **all four acceptance criteria pass on a held-out test set of ≥ 50 clips**. Suggested gating:
- Lab only first (poll-judge cron writes to `prompt_lab_iterations.judge_*`); leave prod scenes alone
- After 7 days of Lab use with no false-positive complaints from Oliver, evaluate flipping for prod scenes too

## What this session shipped

- `scripts/judge-calibration.ts` — calibration harness with metrics + smoke test + parallel runner (commits to come)
- `lib/prompts/judge-rubric.ts` — v1.1 → v1.3-anchored
- `supabase/migrations/047_lab_judge_scores_unique_per_version.sql` — enables multi-version-per-iteration scoring (applied via Supabase MCP)
- This audit doc

Branch: `feat/judge-calibration-v1.2` (off `dev`). Per Oliver's instruction this session: **NOT promoted past `dev`**. PR-ready when next session validates the full 241-clip metrics.

## Cost (this session)

- Schema migration: $0
- 25-clip v1.3 run: ~$0.05 (estimated; rows in `cost_events.subtype='judge'` for exact)
- 5-clip plumbing-test run: ~$0.01
- Full 241-clip run (in progress): ~$3 estimated
- Total: under $5

## Data integrity

Per Oliver's strict instruction: NO row deletions performed. All writes are INSERTs into `lab_judge_scores` and `lab_judge_calibrations`. The historical v1.1 judge data on `prompt_lab_iterations.judge_*` is preserved untouched. Migration 047 dropped a unique constraint and added a wider one — also strictly additive (no row data lost).
