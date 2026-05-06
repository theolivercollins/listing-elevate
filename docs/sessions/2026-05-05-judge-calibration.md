# Session 2026-05-05 — Judge calibration (v1.3-anchored attempt + harness ship)

Last updated: 2026-05-06

See also:
- [../HANDOFF.md](../HANDOFF.md) — current state
- [../audits/judge-calibration-2026-05-05.md](../audits/judge-calibration-2026-05-05.md) — full diagnosis + verdict + v1.4 hypotheses
- `feat/judge-calibration-v1.2` branch — carries the harness + the failed v1.3 prompt

## What shipped

Branch `feat/judge-calibration-v1.2` (NOT promoted past feat per Oliver's instruction):
- Commit `6bbac7a` — calibration harness + v1.3-anchored rubric + migration 047
- Commit `0d6c6ce` — honest verdict update after full 189-clip run

What's durable:
- `scripts/judge-calibration.ts` — reusable harness (smoke / baseline / run / report modes; pure-logic metrics; parallel runner)
- `supabase/migrations/047_lab_judge_scores_unique_per_version.sql` — applied to prod via Supabase MCP; allows multiple judge_versions per iteration
- `docs/audits/judge-calibration-2026-05-05.md` — full record
- 189 rows in `lab_judge_scores` with `judge_version='v1.3-anchored'` — preserved per never-delete-data rule
- 2 rows in `lab_judge_calibrations` (v1.3 on n=25 then n=189)

## What's next

Try **Gemini 2.5 Pro on the v1.1 prompt** as the v1.4 attempt — isolates the model variable from the prompt variable. Both v1.1 and v1.3 with `gemini-2.5-flash` produced near-constant outputs (means 4.21 and 2.5 respectively, both ~zero correlation). If Pro moves Pearson materially with no other change, model capacity is the issue. If not, populate `judge_calibration_examples` with 3-5 labeled clips per (room × movement) bucket and re-run with few-shot.

## What was tried + failed

**v1.3-anchored** — prompt rewrite with calibration target, anti-leniency warning, worked 1-5★ anchors, hard rules, and `min(axes) − weak flag-penalty` aggregation. On full 189 V1 clips:
- MAE 1.31 → **1.99** (worse)
- Within ±1 64% → **37%** (worse)
- Pearson −0.10 → **−0.15** (still anti-correlated)
- Judge mean on 5★ clips: 4.00 → **2.42** (severely deflated)

Single biggest culprit: the rule "5★ overall REQUIRES motion=5 AND geom=5 AND room=5 AND zero flags AND confidence ≥ 4" filters essentially every clip out of 5★. Drop or relax this rule before the next prompt iteration.

The 25-clip preliminary that showed Pearson +0.17 was small-sample noise — the full 189-clip run shows no correlation gain.

**v1.2 composite override (TypeScript-side `min(axes) − flag_penalty`)** — discarded mid-session. Penalty double-counted defects that the rubric already encoded as low-axis scores. Reverted before commit.

## Questions answered this session

- **Are the model's per-axis scores trustworthy?** Partially. Motion axis catches motion problems. But geometry + room scores are nearly always ≥ 4 regardless of input. Hybrid scoring (trust model on motion + flags, derive geometry/room from cheaper visual signal) is a viable v1.4 path.
- **Is `gemini-2.5-flash` the right model?** Untested. Both rubric versions on Flash produced near-constant outputs. Need to A/B against Pro before continuing prompt-tuning.
- **Does aggregation tweaking alone fix things?** No. The v1.2 composite override over-corrected. Real fix requires better per-axis signal, not better averaging.
- **How do we get there without burning Oliver's time?** All future judge runs go through `scripts/judge-calibration.ts` against the existing 308-rating ground truth. No new manual ratings needed.

## Cost snapshot

- 5-clip plumbing test: ~$0.01
- 25-clip v1.3 test: ~$0.05
- 189-clip full v1.3 run: ~$3 estimated (exact via `cost_events` where `metadata->>'subtype' = 'judge'`)
- Schema migration: $0
- **Total: ~$3.10**
