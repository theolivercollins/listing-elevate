# Session 2026-05-06 — Judge calibration v1.4 (Gemini 2.5 Pro on v1.1 prompt) + cost_events FK fix

Last updated: 2026-05-06

See also:
- [../HANDOFF.md](../HANDOFF.md) — current state
- [./2026-05-05-judge-calibration.md](./2026-05-05-judge-calibration.md) — prior session
- [../audits/judge-calibration-2026-05-05.md](../audits/judge-calibration-2026-05-05.md) — v1.3-anchored verdict

Branch: `feat/judge-calibration-v1.4-pro` (off `dev`).

## TL;DR

1. **v1.4 hypothesis (model is the lever) is REJECTED.** Pro on the unchanged v1.1 prompt produced Pearson +0.048 vs Flash's −0.103. Direction flipped but the absolute correlation is still effectively zero. MAE got worse (1.31 → 1.52), Within±1 got worse (64% → 55%). The constant-output pathology persists — judge still never uses ratings 1 or 2 regardless of model.
2. **Standing cost-tracking bug found and fixed.** `cost_events.property_id_fkey` was silently rejecting every `recordCostEvent` call from `gemini-judge`, `embeddings-image`, and `prompt-lab.finalizeLabRender` (when session has no property_id) since 2026-04-30. Sentinel UUID `00000000-…-0` doesn't exist in `properties`. Empty catch blocks swallowed all 250 failures. `recordCostEvent` now accepts `propertyId: string | null`. Backfilled 249 missing rows ($2.49 recovered telemetry).
3. **Next lever per the original plan:** few-shot calibration examples in `judge_calibration_examples` per (room × movement) bucket. Both prompt-tuning (v1.3-anchored) and model-swap (v1.4-pro) failed; the remaining hypothesis is the judge has never been shown what "1★" or "2★" looks like in this domain.

## What shipped (NOT promoted past `feat`)

Branch `feat/judge-calibration-v1.4-pro`:

| Commit | What |
|---|---|
| `4849190` | bring forward harness + 047 migration + 2026-05-05 audit doc, drop v1.3 prompt edit |
| `93689f8` | model-aware judge_version (`judgeVersionFor`) + Gemini pricing (`geminiCostCents`) |
| `9f173e6` | **fix(cost): null property_id for Lab cost_events instead of sentinel UUID** |
| `7e2f10b` | backfill 249 missing judge cost_events from `lab_judge_scores.cost_cents` |

Durable artifacts:
- `lib/prompts/judge-rubric.ts` — adds `judgeVersionFor(model)` so Flash returns bare `v1.1` (backward compat with 150 existing rows) and Pro returns `v1.1-pro`. Pattern extends to any future model with a slug suffix.
- `lib/providers/gemini-judge.ts` — model-aware pricing lookup table (`gemini-2.5-flash` $0.075/$0.30 vs `gemini-2.5-pro` $1.25/$10.00 per Mtok). Falls back to Flash pricing for unknown models — recoverable since each cost_event metadata records the actual `judge_model`.
- `lib/db.ts` — `recordCostEvent.propertyId: string | null`; skips `addPropertyCost` rollup when null.
- `scripts/oneoff-backfill-judge-cost-events.mts` — idempotent backfill from `lab_judge_scores`. De-dupes on `(iteration_id, judge_version)` in metadata.
- `scripts/judge-calibration.ts` — `JUDGE_MODEL=<model>` env var now drives a model-aware `judge_version` for resume + summary.

## Numbers

### v1.1 × Flash (production baseline; n=150 organic, from prompt_lab_iterations)
- MAE: **1.31**
- Within±1: **64.0%**
- Pearson: **−0.103**
- Judge means by human bucket: 4.17 / 4.36 / 4.13 / 4.21 / 4.00 (constant ~4.2 regardless of input)
- Judge never used ratings 1 or 2.

### v1.1 × Pro (today, n=31 in lab_judge_scores)
- MAE: **1.52** (worse)
- Within±1: **54.8%** (worse)
- Pearson: **+0.048** (still effectively zero, direction flipped)
- Judge means by human bucket: 4.14 / 4.50 / 3.83 / 4.00 / 4.50 (still essentially flat)
- Judge still never used ratings 1 or 2.

### v1.3-anchored × Flash (prior session, n=189)
- MAE: 1.989, Within±1: 37%, Pearson: −0.15

All three rubric × model combinations show the same disease: the judge cannot distinguish bad clips from good clips in this video domain. The mean shifts (4.21 on Flash v1.1, 2.5 on Flash v1.3-anchored, 4.21 on Pro v1.1) but distributional collapse is total.

## What was tried + failed

**v1.4-pro = Gemini 2.5 Pro on the unchanged v1.1 prompt**, scaled 5 → 1 → 25 = 31 clips total (stratified across rating buckets). Stopped at n=31 because the result is decisive at that scale: Pro is marginally less anti-correlated than Flash but nowhere near production-quality. Did NOT trigger the full 150-clip parity run — would have cost ~$1.50–$15 (depending on actual Google billing for video tokens, which the SDK undercounts) but couldn't change the verdict.

## The cost-tracking bug, in detail

**Symptom:** During v1.4-pro plumbing verification I queried `cost_events` for the new Pro rows and found zero. Querying further showed no judge `cost_events` since 2026-04-30 — meaning the entire 2026-05-05 v1.3 calibration session (~$2 spend) had no telemetry either.

**Root cause:** Migration 045 (2026-04-28) dropped `NOT NULL` on `cost_events.property_id`, but the FK constraint to `properties.id` remained. Three callsites still passed a sentinel `"00000000-0000-0000-0000-000000000000"` UUID that doesn't exist in `properties`. Every insert failed with PG error 23503; the surrounding `try/catch` blocks were intentionally `non-fatal` (so a cost-event failure couldn't break clip rendering or judge polling) and swallowed the error silently. Two-layer mask: silent FK failure + silent catch.

**Why it didn't show up sooner:** `prompt-lab.ts.finalizeLabRender` reads `session.property_id` and only falls back to the sentinel when null — most production sessions have a real property_id, so that path mostly worked. But `gemini-judge.ts` and `embeddings-image.ts` are Lab-only utilities that *always* used the sentinel. So Lab judge + image-embedding cost was 100% lost; Lab render cost was lost only on the subset of sessions without an attached property.

**Fix scope:**
1. `lib/db.ts` `recordCostEvent`: widen `propertyId` to `string | null`; skip `addPropertyCost` rollup when null (no property to attribute to).
2. Three callsites pass `null` instead of sentinel: `gemini-judge.ts` (success + failure paths), `embeddings-image.ts` (success + failure paths), `prompt-lab.ts.finalizeLabRender` (Lab fallback).
3. `LAB_SYNTHETIC_PROPERTY_ID` constant deleted (was only referenced once).
4. Comments updated to reflect null-as-canonical-Lab-marker.

**Backfill:** `scripts/oneoff-backfill-judge-cost-events.mts` recovers cost from `lab_judge_scores.cost_cents` (which `gemini-judge` *did* compute correctly before the cost_events insert failed). De-dupes on `(iteration_id, judge_version)`. Idempotent — re-runs are no-ops. Backfilled 249 rows totaling $2.49.

**Caveat (separate, not fixed here):** the @google/genai SDK reports `promptTokenCount=0` for video inputs on this code path, so per-row `cost_cents` is at the 1¢ Math.ceil floor. Real Pro spend per call is higher (Gemini bills ~258 tokens per second of video at default mediaResolution × $1.25/Mtok input + a few hundred output tokens × $10/Mtok = roughly 1–3¢/clip at 5s). Reconcile against Google Cloud invoice for accurate figures. Logged for follow-up; doesn't block the v1.4 verdict.

## Cost snapshot

| Item | Recorded | Notes |
|---|---|---|
| 5-clip Pro plumbing (initial) | 5¢ | 1¢ floor each — backfilled |
| 1-clip Pro re-probe (post-fix) | 1¢ | Verified cost_events writes work |
| 25-clip Pro stratified | ~25¢ recorded; real spend probably $0.25–$0.75 | SDK undercount — reconcile vs invoice |
| Backfill recovery | $2.49 | 249 rows from prior 7 days |
| **Total this session** | **~$0.31 recorded** | Real ~$0.50–$1.00 max |

## Decision: do NOT promote `feat/judge-calibration-v1.4-pro` past `feat` for the calibration changes

The harness, model-aware version, and pricing helpers are durable and worth keeping but the v1.4-pro experiment itself is a negative result. v1.1 stays the canonical rubric in dev/staging/main. Judge stays paused (`JUDGE_ENABLED=false` env + `system_flags.judge_cron_paused=true` both still set).

**However:** the cost_events FK fix (`9f173e6`) and backfill (`7e2f10b`) are **standing-bug fixes** that should be promoted to main quickly. Every Lab judge call and Lab image embedding currently in production is silently dropping its cost telemetry. Recommend cherry-picking `9f173e6 + 7e2f10b` (and the `judge-rubric.ts` / `gemini-judge.ts` model-aware changes that the fix depends on) onto a separate `fix/cost-events-fk-null` branch off `dev` for immediate promotion through the standard `dev → staging → main` path.

## Next session

Per HANDOFF.md's original 2026-05-06 next-action: **populate `judge_calibration_examples` with 3-5 labeled clips per (room × movement) bucket and re-run with few-shot.** Few-shot is now the only untried lever — model swap and prompt-tuning both failed.

Concretely:
- Pick the 25-30 lowest-rated clips (Oliver-rated 1★ or 2★) from `prompt_lab_iterations` and write them to `judge_calibration_examples` with the correct `oliver_correction_json` reflecting Oliver's 1-2★ verdict.
- The harness already handles few-shot via `loadCalibrationFewShot` (10 most-recent overrides per bucket loaded at judge time); that surface just needs labeled data.
- Re-run `--run --limit 50` on Flash with calibration examples populated. If Pearson moves above +0.30, that's the lever. If not, judge architecture itself may be unsuitable and we punt.
