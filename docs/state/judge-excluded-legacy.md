# Judge calibration — legacy exclusion list

Sidecar to [`JUDGE-RUBRIC-V1.md`](./JUDGE-RUBRIC-V1.md). Established per Q3 resolution (Oliver, 2026-04-22).

## Purpose

The Gemini auto-judge is calibrated against a few-shot pool of past iterations. Any iteration whose `director_output_json.camera_movement` matches a **banned camera-movement enum value** must be excluded from the calibration pool — otherwise the judge inherits obsolete mental models from a director vocabulary that no longer ships. This file is the auditable denylist the pool-builder script (P2 Session 2 deliverable) reads at every regenerate.

If judge behavior surprises us later — e.g., the judge rates a current `push_in` against muscle memory of how a `pull_out` used to look — this list is the first place to inspect.

## Banned camera-movement enum values

The director vocabulary deletions, with date and reason:

| Enum value | Removed | Replacement | Reason |
|---|---|---|---|
| `drone_pull_back` | 2026-04-19 | `drone_push_in` (editor reverses in post) | Pullouts hallucinate revealed geometry the model can't infer. |
| `pull_out` | 2026-04-19 | `push_in` (editor reverses in post) | Same — pullouts invent off-frame world. |
| `tilt_up` | pre-2026-04 | `feature_closeup` or rich 3D move with rise component | Pure vertical motion; ends staring at ceiling. |
| `tilt_down` | pre-2026-04 | `feature_closeup` | Pure vertical motion; ends staring at floor. |
| `crane_up` | pre-2026-04 | rich 3D move with rise as secondary component | Pure vertical motion. |
| `crane_down` | pre-2026-04 | rich 3D move with descent as secondary component | Pure vertical motion. |
| `slow_pan` | pre-2026-04 | (deleted entirely; pick another verb) | 0% success rate in production. |
| `orbital_slow` | pre-2026-04 | `orbit` (just `orbit`) | Redundant variant of `orbit`. |

Source of truth: `lib/prompts/director.ts` — the `CAMERA MOVEMENT ENUM` section enumerates the current 11 valid values. Anything outside that 11-set is a banned legacy.

## Excluded iterations (seed list, 2026-04-22)

This is the v0 hand-curated seed. The pool-builder script will append additional matches at runtime.

| iteration_id | rating | bucket (room / movement) | reason |
|---|---|---|---|
| `a7249526-3e38-45be-ac11-937b6feb72fd` | 1★ | aerial / `drone_pull_back` | Banned enum value; also rendered with no clip (render failed). Preserved in JUDGE-RUBRIC-V1.md as the B5 null-clip teaching anchor — referenced from rubric, but excluded from any auto-rebuilt calibration pool. |

## How the pool-builder uses this file

P2 Session 2 ships a script (working name: `scripts/build-judge-calibration-pool.ts`) that regenerates the calibration few-shot pool per the Q4 retirement triggers in JUDGE-RUBRIC-V1.md Section 6. That script:

1. Pulls candidate iterations from `prompt_lab_iterations` (and later `prompt_lab_listing_scene_iterations` once V1 routes through there).
2. For each candidate, looks up `director_output_json.camera_movement`.
3. If the value is in the "Banned camera-movement enum values" table above, EXCLUDE the iteration and append `{iteration_id, rating, bucket, reason: "banned enum: <value>"}` to the bottom of this file (so the audit trail grows automatically).
4. Otherwise, the iteration is eligible for stratified sampling across (room × movement × SKU).

The pool-builder is the single writer of new rows below this line. Hand-edits above this line (specifically: the "Banned camera-movement enum values" table) require a `judge_version` minor bump per JUDGE-RUBRIC-V1.md Section 6, because they expand the denylist semantics that the calibration pool depends on.

---

<!-- pool-builder writes auto-discovered exclusions below this line -->
