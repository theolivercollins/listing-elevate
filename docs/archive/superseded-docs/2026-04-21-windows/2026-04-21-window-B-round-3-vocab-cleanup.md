# Round 3 — Window B — Motion-Vocabulary Cleanup

Last updated: 2026-04-21
Branch: continue on `session/da1-land-2026-04-21` (rebase onto main first) OR cut fresh `session/vocab-cleanup-2026-04-21` off main
Worktree: `/Users/oliverhelgemo/real-estate-pipeline/.worktrees/wt-da1`

## Why this brief exists

Oliver's movement-vocab review (2026-04-21) identified four vocabulary-level bugs in the current system. They are not regressions from DA.1 — they are long-standing mismatches between what the director asks for and what the models can actually do:

1. **`low_angle_glide`** has always been a `push_in` in disguise. Drop it.
2. **`top_down`** is too rare + too risky (most aerials are oblique; model hallucinates straight-down geometry). Drop it.
3. **`orbit`** needs a start+end frame pair 100% of the time — single-image orbit produces the "wobble-arc" artifact. Router must enforce this.
4. **`pull_out`** can't be generated natively from a single image. Needs dual-path routing: paired-model if start+end frames provided, else render `push_in` with a `reverse_in_post` flag that Shotstack honors at assembly.

DA.1 already has the `motion_headroom` hard-ban machinery that makes these fixes mechanical. Your Round 2 evidence confirmed that mechanism works.

## North Star you are serving

Criterion **#2 — no hallucinations** (removes the three motion verbs most likely to produce hallucinated geometry) AND criterion **#3 — no wasted money** (stops dispatching orbit + pull_out to single-image providers that fake them badly).

## Required reading (in order)

1. `docs/HANDOFF.md`
2. `docs/audits/REGRESSION-DIFF-2026-04-21.md` — your own Round 2 verdict
3. `lib/prompts/director.ts` — current DIRECTOR_SYSTEM vocab + motion_headroom hard-bans table
4. `lib/providers/gemini-analyzer.ts` — current MotionHeadroom type
5. `lib/prompt-lab-listings.ts::mapCameraMovementToHeadroomKey` — current verb-to-bucket mapping
6. `lib/providers/router.ts` — current camera-movement-first routing logic
7. `lib/providers/shotstack.ts` — assembly provider (for the `reverse_in_post` wiring)
8. `supabase/migrations/030_photo_camera_state.sql` — your own DA.1 migration, as the pattern for 031

## Scope

### Must do

#### A. Remove `low_angle_glide` and `top_down`

1. `lib/prompts/director.ts` — strip both verbs from `DIRECTOR_SYSTEM`'s vocabulary block + the "HARD MOVEMENT BANS FROM MOTION HEADROOM" table + any don't-do examples that reference them.
2. `lib/prompts/photo-analysis.ts` — remove both from the `suggested_motion` enum description + strip any per-room rules referencing them.
3. `lib/providers/gemini-analyzer.ts` — drop `top_down` from the `MotionHeadroom` type + Gemini request schema + `motion_headroom_rationale` keys.
4. `lib/prompt-lab-listings.ts::mapCameraMovementToHeadroomKey` — confirm `low_angle_glide` already maps to `push_in` (it does). Remove the `top_down` case; `top_down` as an incoming verb will now hit the `default` branch, which means the validator will treat it as unmapped and override to `feature_closeup` via the existing fallback chain.
5. Check whether any historical `photos.analysis_json` rows contain `top_down` keys in `motion_headroom` — do NOT delete them, but note in session log that they become dead fields (validator just ignores them).

#### B. Enforce orbit pairing

6. In `lib/providers/router.ts`, add a rule: if `camera_movement === 'orbit'` and the scene has NO start+end frame pair (`scene.end_photo_id IS NULL` or equivalent), emit a ProviderDecision of `{ skip: true, reason: 'orbit_requires_paired_input' }`. The caller (pipeline + DA.3 validator) then overrides the scene to `scene.suggested_motion` (if in-headroom) or `feature_closeup`.
7. If the scene IS paired, orbit routes to the paired model (Oliver's rule: `kling-v3-pro`). Confirm this path works with the existing DM.3/DM.4 paired dispatch.

#### C. Pull_out dual-path

8. Add a `reverse_in_post: boolean` column to `scenes` via migration `031_scene_reverse_in_post.sql` (default `false`).
9. In `lib/providers/router.ts`, add a rule: if `camera_movement === 'pull_out'`:
   - If scene is paired → route to `kling-v3-pro` (paired model), render normally, `reverse_in_post = false`.
   - If scene is single-image → rewrite the render-side motion to `push_in`, set `reverse_in_post = true` on the scene row, leave director_prompt unchanged (the prompt still says "pull out" for director's internal reasoning, but the provider sees `push_in`).
10. In `lib/providers/shotstack.ts` assembly, when `scene.reverse_in_post === true`, add a `reverse` filter to that clip before concatenation.
11. Log a `cost_event` with `scope='pull_out_post_reversal'` and `amount_cents=0` on every reverse so we can audit how often this path fires.

#### D. Type-check + unit tests

12. `npx tsc --noEmit` clean on all edited files (your Round 1 + 2 standard).
13. Add one unit test per new routing rule (orbit-requires-paired + pull_out-dual-path) using existing test patterns from `lib/providers/__tests__/`.
14. `npx vitest run` all-green before committing.

#### E. Docs + memory via docs-subagent

15. Update `docs/HANDOFF.md` Recent shipping log.
16. Update `docs/state/PROJECT-STATE.md`: new subsection "2026-04-21 — Motion-vocab cleanup" listing the four changes + the new verbs-that-no-longer-exist list.
17. Update `docs/state/STACK.md`: amend the motion_headroom field to drop `top_down`.
18. Update memory `project_legacy_lab_regression_hypothesis.md`: note the vocab cleanup fires on the same root-cause family.
19. Create memory `project_motion_vocab_2026_04_21.md` (type: project) summarizing the new verb set.

#### F. Commit in ≥3 logical chunks

- (a) vocab removal + director + photo-analysis
- (b) motion_headroom schema change + gemini-analyzer + mapCameraMovementToHeadroomKey
- (c) migration 031 + router orbit rule + pull_out dual-path + shotstack reverse wiring
- (d) unit tests + docs-subagent

### Must NOT do

- Do NOT render anything. This is a code-only change; verification via type-check + unit tests.
- Do NOT backfill historical `analysis_json` rows to strip `top_down` — leave them alone.
- Do NOT touch the 5-bucket router-table work (that's D's territory).
- Do NOT change `pull_out`'s director_prompt wording — the director still reasons about the shot as a pull_out; only the render-side dispatch changes.
- Do NOT edit files outside this worktree.
- Do NOT push.

## Self-check protocol (MANDATORY)

Session log: `docs/sessions/2026-04-21-window-B-round-3.md`. Every ~45 min + each milestone, append a **Self-check**:

- **(a) Criterion served?** Expected: #2 no hallucinations + #3 no wasted money.
- **(b) Highest-leverage next step?** Pivot triggers:
  - Migration 031 won't apply cleanly → stop, flag, don't proceed with the pull_out dual-path half until resolved.
  - Unit tests reveal the orbit-requires-paired rule breaks an existing scene fixture → stop, investigate whether fixture is wrong or rule is wrong.
  - Shotstack reverse filter doesn't exist in the version we're using → flag, stash that one chunk, land the rest.
- **(c) Evidence?** tsc clean? vitest green? Migration applied + verified via Supabase MCP? Router tests cover both paired + single-image dispatch?
- **(d) Pivot? → STOP, commit WIP, document.**

**Stuck >30 min:** commit WIP, write `docs/sessions/2026-04-21-window-B-round-3-blocker.md`, ping Oliver.

## Exit criteria (3 hours)

- [ ] `low_angle_glide` and `top_down` removed from director vocab + motion_headroom schema + photo-analysis suggested_motion list
- [ ] Orbit routing rule enforced: single-image orbit → override to fallback; paired orbit → kling-v3-pro
- [ ] Pull_out dual-path: paired → kling-v3-pro; single-image → push_in + `reverse_in_post=true`
- [ ] Migration 031 applied to dev Supabase; `scenes.reverse_in_post` column present
- [ ] Shotstack reverse filter wired for `reverse_in_post` clips
- [ ] `npx tsc --noEmit` clean on DA.1 + router + shotstack + director files
- [ ] New unit tests pass; existing test suite still all-green
- [ ] Committed in ≥3 chunks on your branch
- [ ] Session log + docs + memory updated via docs-subagent
- [ ] Zero renders executed — this is a code-only change

## Budget

**$0 renders.** Verification is purely code-side this round. Oliver may choose to run a second regression-diff later to validate the fixes on a real scene — that would be Round 4.

## If you finish early

1. Fix the `mapCameraMovementToHeadroomKey('drone_push_in')` single-vs-both-keys gap from your Round 1 carry-forward notes. Small, surgical, commit separately.
2. Add a `docs/audits/motion-vocab-before-after-2026-04-21.md` with a compact diff: verbs that existed, verbs that exist now, rationale per removal.

## Success definition

A listing that tries to render a single-image orbit or pull_out on the post-cleanup pipeline should produce either a paired-model render, a post-production reversal, or a feature_closeup fallback — never a single-image "fake pull_out" or "wobble orbit" again. Unit tests prove the routing holds. Real-render proof is deferred to a later round.
