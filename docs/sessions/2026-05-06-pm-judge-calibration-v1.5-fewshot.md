# Session 2026-05-06 PM — Judge calibration v1.5 (few-shot) + judge architecture verdict

Last updated: 2026-05-06 PM

See also:
- [./2026-05-06-judge-calibration-v1.4-pro.md](./2026-05-06-judge-calibration-v1.4-pro.md) — same-day morning session (v1.4-pro + cost-events FK fix)
- [../HANDOFF.md](../HANDOFF.md) — current state
- [../audits/judge-calibration-2026-05-05.md](../audits/judge-calibration-2026-05-05.md) — v1.3-anchored verdict

Branch: `feat/judge-calibration-v1.5-fewshot` (off `main` post-AM-promotion).

## TL;DR — punt the judge

After **three failed lever attempts** (prompt-tuning v1.3, model-swap v1.4-pro, few-shot v1.5 both directions), the same constant-output pathology persists. The Gemini-as-judge architecture is not the right tool for this domain. **Recommend pausing further calibration work** and reallocating effort to either (a) higher-leverage product gaps (voiceover, music, brokerage logo, duration enforcement) or (b) a structurally different evaluator (multi-stage classifier on flags only, fine-tuned model, or different model family).

| Variant | n | Pearson | MAE | Within±1 | Verdict |
|---|---:|---:|---:|---:|---|
| v1.1 baseline (Flash, zero-shot) | 150 | −0.103 | 1.31 | 64% | constant-output, mean ~4.21 |
| v1.3-anchored (Flash, 2026-05-05) | 189 | −0.150 | 1.99 | 37% | regression |
| v1.4-pro (Pro, zero-shot) | 31 | **+0.048** | 1.52 | 55% | direction flip; signal trivial |
| v1.5-fewshot (Flash, 38 down-corrections) | 25 | −0.066 | 1.32 | 56% | judge unlocked 1-2★ for first time; partial structure win |
| v1.5-fewshot-balanced (38 down + 18 up) | 24 | **−0.452** | 1.63 | 42% | regression — up-corrections introduced rating noise |

Best Pearson ever achieved: **+0.048** (v1.4-pro). Acceptance threshold for shipping: ≥ **+0.30**. Gap is fundamental, not parameter-tuning.

## What shipped on `feat/judge-calibration-v1.5-fewshot`

Durable infrastructure (worth keeping in main even though the experiment failed):

- `scripts/judge-calibration.ts` — harness now mirrors prod cron's `loadCalibrationFewShot(roomType, movement, 10)` call before each `judgeLabIteration`. New CLI flags: `--no-fewshot` (disables auto-load), `--tag <s>` (extra suffix on `judge_version` for separable A/B buckets).
- `scripts/oneoff-populate-judge-calibration-examples.mts` — auto-derives down-corrections from rated `prompt_lab_iterations` rows (Oliver ≤2★, judge ≥3). Idempotent.
- `scripts/oneoff-populate-judge-calibration-up-corrections.mts` — same shape for up-corrections (Oliver ≥4★, judge ≤3). **Not recommended for re-use as-is** — the 18 examples it produced introduced noise because some "Oliver ≥4 / judge ≤3" cases are actually accurate judge calls on clips Oliver rated leniently for non-motion reasons.
- `scripts/oneoff-survey-fewshot-data.mts` — confusion matrix + bucket distribution probe.
- `scripts/oneoff-survey-fewshot-balance.mts` — same for up/down balance.

DB state in prod (judge currently paused so no live impact):
- `judge_calibration_examples`: 38 down-correction rows + 18 up-correction rows = 56 total. Tagged in `correction_reason` field.
- `lab_judge_scores`: 25 v1.1-fewshot rows + 24 v1.1-fewshot-balanced rows added. Preserves both A/B regimes per the never-delete-data rule.
- `lab_judge_calibrations`: 2 new summary rows (one per regime).

## What was tried + what we learned

### Step 1: down-only few-shot (v1.5-fewshot)
- 38 examples auto-derived from inversions where Oliver=1-2★ and judge=3-5★
- `oliver_correction_json`: overall + motion_faithfulness clamped to human rating; geom/room kept at judge's values; motion_too_static flag forced if motion ≤2
- Result on 25 fresh stratified clips: Pearson −0.066. Per-bucket judge means dropped uniformly by ~0.7 stars across all human ratings. **First time the judge ever output 1★ or 2★ in 169 cumulative paired rows** — structural unlock.
- But it pulled GOOD clips down too (human=5 mean dropped 4.00 → 3.40). Global down-shift, not selective correction.

### Step 2: balanced few-shot (v1.5-fewshot-balanced)
- Hypothesis: adding up-corrections will give the judge BOTH ends and prevent global down-shift.
- Added 18 examples auto-derived from rows where Oliver=4-5★ and judge=3.
- Result on 25 fresh stratified clips: Pearson −0.452. **Regressed dramatically.** Per-bucket means inverted: human=1 mean back up to 4.20, human=5 mean down to 3.20.
- **Root cause analysis (without manual clip review):** Many "Oliver=5★ / judge=3★" rows turned out to be cases where the judge correctly identified motion failure (e.g. judge reasoning: "sub-pixel camera movement, reading as a still image, motion_too_static flagged"). Oliver may have rated those 5★ on aesthetics or framing despite the motion defect. Treating them as "judge under-rated, here's the correction" trains the judge to ignore real motion defects.

### What this tells us about the architecture
The judge can *describe* what's happening in clips (the per-axis reasoning is often accurate, including correctly flagging motion_too_static). But the **overall aggregation** is broken in a way prompt-tuning and few-shot can't fix:
- The v1.1 weighted-mean formula is the original culprit (motion=2 averages back up to overall=4)
- v1.3-anchored tried to fix aggregation via prompt rules ("5★ requires all three axes ≥5 + zero flags") and broke it the other way
- v1.5-fewshot tried to teach aggregation via examples but couldn't generalize without bidirectional clean data
- The model has no underlying signal that distinguishes "good push-in" from "bad push-in" beyond the per-axis description; it can describe defects but not weight them appropriately

## Recommended next direction (for Oliver to choose)

Three plausible paths:

**A) Minimal-judge: trust flags only, derive overall from TypeScript.**
The per-axis judge output IS reliable on flags (motion_too_static, geom warps, etc. — those correlate with what we'd expect). What's broken is aggregation. Derive overall in code: `overall = clamp(min(motion, geom, room) - flagPenalty, 1, 5)`. This is what v1.2-min-axes tried and abandoned mid-session — but with the down-only few-shot examples now available, the per-axis numbers might be cleaner. Worth one cheap re-run.

**B) Stop investing in the judge; focus on product gaps.**
Per the project memory, several user-facing promises are unbuilt: voiceover/voice clone (charged but no code), brokerage logo + brand colors (captured but never rendered), music (not even captured), duration enforcement (priced but not enforced), order form fields not persisted. Any of these moves customer experience more than a working judge would.

**C) Different evaluator architecture entirely.**
Fine-tune a small model on Oliver's 169 paired rows. Or use Anthropic Sonnet vision (Claude has been more reliable on multi-axis evaluation in other domains). Or build a tiny multi-stage classifier (motion classifier + geometry classifier separately, no aggregation prompt). Higher cost-to-experiment than (A) or (B).

My recommendation: **A first** (one cheap test, ~$0.30 + one harness run), then if (A) doesn't pop above +0.30 Pearson, **B** (judge stays paused; product gaps are bigger ROI). Skip (C) until data + product foundation justifies it.

## Cost snapshot

| Item | Recorded |
|---|---|
| 25-clip v1.5-fewshot run | ~25¢ (Flash; 1¢/clip floor due to SDK video-token undercount) |
| 25-clip v1.5-fewshot-balanced run | ~25¢ (1 errored) |
| 38 + 18 calibration row inserts | $0 |
| Survey + verify scripts | $0 (read-only) |
| **Total v1.5 session** | **~$0.50 recorded; real ~$1-3 with Google video-token under-report** |

## Decision

- Promote `feat/judge-calibration-v1.5-fewshot` through `dev → staging → main` for the durable harness wiring + populate scripts. The 38 + 18 calibration rows in prod stay (judge paused so no behavior change).
- Mark the judge calibration program **paused** in HANDOFF until Oliver picks A / B / C.
- Reset focus to product gaps for next session unless Oliver explicitly wants to test (A).
