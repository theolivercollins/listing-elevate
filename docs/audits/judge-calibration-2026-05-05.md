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

## Full 189-clip v1.3-anchored run — VERDICT: regression

Ran v1.3-anchored against 196 V1 clips (189 succeeded, 7 errored — likely clip-URL 404s; non-blocking). Honest results:

| Metric | v1.1 baseline (n=150) | v1.3-anchored (n=189) | Delta |
|---|---|---|---|
| MAE | 1.31 | **1.99** | **+0.68 (worse)** |
| Within ±1 | 64% | **37%** | **−27pp (worse)** |
| Pearson | −0.10 | **−0.15** | barely changed, still anti-correlated |
| Mean on human=1 (n=25) | 4.17 | 2.68 | better but still inflated |
| Mean on human=2 (n=18) | 4.36 | 3.67 | slight improvement |
| Mean on human=3 (n=36) | 4.13 | 2.69 | now too low |
| Mean on human=4 (n=38) | 4.21 | 2.50 | too low |
| Mean on human=5 (n=72) | 4.00 | **2.42** | severely deflated |

**Root cause:** v1.3's anti-leniency posture worked too well. Judge now defaults to ~2.5 instead of ~4.2 — same constant-output disease, different shifted mean. Pearson stayed near zero, meaning the per-clip discrimination didn't actually improve.

**Single biggest culprit:** the hard rule "5★ overall REQUIRES motion=5 AND geom=5 AND room=5 AND zero flags AND confidence ≥ 4" filters out essentially every clip from the 5★ bucket. Almost no clip survives all five conditions, so almost nothing can be 5★ under v1.3.

The 25-clip preliminary that showed Pearson +0.17 was small-sample noise — the full 189-clip run shows the change is a regression.

**Status:** v1.3-anchored stays on the feat branch as a documented failed experiment. NOT promoted past feat. The v1.1 rubric remains the production prompt (still terrible, just less terrible than v1.3).

To replicate or extend:
```bash
npx tsx scripts/judge-calibration.ts --report v1.3-anchored   # current numbers
npx tsx scripts/judge-calibration.ts --baseline               # v1.1 + v1.0 numbers
```

## Recommendations for next session (v1.4)

Both v1.1 and v1.3 produced near-constant outputs (just at different means). Pearson stayed near zero in both. Conclusion: **prompt-only tuning hits a ceiling for this model.** Real progress probably requires one of:

1. **Drop the rigid 5★ filter, recover the upper end.** Single change with the most leverage. Replace "5★ requires ALL three axes 5 AND zero flags AND confidence ≥ 4" with "5★ requires zero MAJOR flags AND average axis ≥ 4.5". Test this in isolation as v1.4.
2. **Few-shot examples in every call.** The infrastructure (`judge_calibration_examples` table, `loadCalibrationFewShot()` function) is built but the table is empty. Populate it with 3-5 example clips per (room × movement) bucket — labeled by Oliver — and load them into the prompt at call time. Cost: +1-2k input tokens per call. Benefit: model anchors to actual ground-truth examples, not just verbal descriptions.
3. **Upgrade to Gemini 2.5 Pro.** v1.3 used `gemini-2.5-flash` (~$0.0001/call, single-shot reasoning). Pro is ~10× cost but materially better at multi-axis reasoning. Try Pro on the SAME v1.1 prompt first to isolate the model variable from the prompt variable.
4. **Hybrid scoring.** Trust model only on motion_faithfulness + hallucination_flags (where it's most reliable per the diagnosis). Score geometry + room from a separate, cheaper visual-similarity signal. Aggregate in TypeScript. This decouples "what the model is good at" from "what the model is bad at."

Suggested next-session order: try (3) Gemini Pro on v1.1 first. If Pearson moves materially, the issue is model capacity. If it doesn't, the issue is the rubric design itself and we should try (2) few-shot.

## Conditions to flip on (`JUDGE_ENABLED=true` + un-pause cron)

The judge stays off until **all four acceptance criteria pass on a held-out test set of ≥ 50 clips**. Suggested gating:
- Lab only first (poll-judge cron writes to `prompt_lab_iterations.judge_*`); leave prod scenes alone
- After 7 days of Lab use with no false-positive complaints from Oliver, evaluate flipping for prod scenes too

## What this session shipped

- `scripts/judge-calibration.ts` — calibration harness with metrics + smoke test + parallel runner. **Keep this** — it's the durable infrastructure.
- `lib/prompts/judge-rubric.ts` — v1.1 → v1.3-anchored. **Failed experiment; documented for the record. Do NOT promote past feat branch.**
- `supabase/migrations/047_lab_judge_scores_unique_per_version.sql` — enables multi-version-per-iteration scoring (applied via Supabase MCP). **Keep — strictly additive schema improvement.**
- 189 rows in `lab_judge_scores` with `judge_version='v1.3-anchored'` — preserved as the empirical record of the failed v1.3 attempt.
- 2 rows in `lab_judge_calibrations` (v1.3 on n=25 then n=189). Preserved as run history.
- This audit doc with honest verdict.

Branch: `feat/judge-calibration-v1.2` (off `dev`). Per Oliver's instruction this session: **NOT promoted past feat**. The branch carries the harness + the failed v1.3 prompt + the audit. Next session can either (a) rebuild a v1.4 prompt on this branch, or (b) revert just the rubric file to v1.1 before any future merge to dev.

## Cost (this session)

- Schema migration: $0
- 25-clip v1.3 run: ~$0.05 (estimated; rows in `cost_events.subtype='judge'` for exact)
- 5-clip plumbing-test run: ~$0.01
- Full 241-clip run (in progress): ~$3 estimated
- Total: under $5

## Data integrity

Per Oliver's strict instruction: NO row deletions performed. All writes are INSERTs into `lab_judge_scores` and `lab_judge_calibrations`. The historical v1.1 judge data on `prompt_lab_iterations.judge_*` is preserved untouched. Migration 047 dropped a unique constraint and added a wider one — also strictly additive (no row data lost).
