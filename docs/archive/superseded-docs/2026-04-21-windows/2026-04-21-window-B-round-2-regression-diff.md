# Round 2 — Window B — DA.1 Regression-Diff Evidence

Last updated: 2026-04-21
Branch: reuse `session/da1-land-2026-04-21` (already merged), or cut a fresh `session/regression-diff-2026-04-21` off main
Worktree: `/Users/oliverhelgemo/real-estate-pipeline/.worktrees/wt-da1` (rebase onto main first)

## Why this brief exists

DA.1 landed on main in Round 1 and unit-test-verifies that the director now receives `motion_headroom` booleans and writes them into the assembled prompt. What is **not** verified: that the resulting rendered clip is actually better than the pre-DA.1 output on a known-bad scene. Right now "DA.1 fixes the regression" is a hypothesis supported by code tests, not by pixels.

Oliver's 4 North Stars include #2 **no hallucinations**. Without a rendered A/B, we have no evidence the regression is closed — we've only shown the prompt changed shape.

**Your job:** produce that evidence on 1–2 of Oliver's known-bad regression anchor scenes. Answer "did DA.1 actually close the Legacy → Dev Lab regression, or is it necessary-but-not-sufficient?" with rendered clips, not assumptions.

## North Star you are serving

Criterion **#2 — no hallucinations**, but this time with rendered evidence rather than code tests.

## Required reading (in order)

1. `docs/HANDOFF.md` — confirm DA.1 is on main
2. `docs/state/PROJECT-STATE.md` — DA.1 section (lines ~16–32)
3. `~/.claude/projects/-Users-oliverhelgemo/memory/project_legacy_lab_regression_hypothesis.md` — Oliver's "Legacy was great, Dev regressed" observation
4. `docs/sessions/2026-04-21-window-B.md` — your Round 1 log, especially the carry-forward notes
5. `docs/audits/ML-AUDIT-2026-04-20.md` — M.1 audit context
6. Supabase data: query `prompt_lab_sessions` for Oliver's named regression anchors — **"San Massimo"**, **"Manasota Key"**, **"Kittiwake"**. Each is a Legacy Prompt Lab listing where Oliver rated one or more iterations ≥4★. Find one (or two at most) 5★ Legacy iterations — note the photo URL, the director_prompt Legacy used, and Oliver's rating + reasons.

## Scope

### Must do

1. **Identify the comparison target.** Pick ONE anchor scene from the three candidates where Oliver has a clear 5★ Legacy iteration. If you find one that's geometrically tricky (e.g., aerial / exterior with movement ambiguity) that's the ideal case since DA.1's `motion_headroom` is most load-bearing there. Document your pick with evidence.
2. **Capture the Legacy baseline.** Record the Legacy iteration: photo URL, director prompt, SKU, rating, clip URL. This is your "pre-DA.1 gold standard."
3. **Render the same photo through the post-DA.1 pipeline.** Use the existing Phase 2.8 Listings Lab — create a new scene in a dev listing (or reuse the Lab surface), feed it the same photo, run it through `directListingScenes` → `analyzePhotoWithGemini` → updated director → same SKU Legacy used (OR Oliver's rule-based pick if Legacy used something we no longer support). Capture: the Gemini analysis output (including `motion_headroom`), the new director prompt, the rendered clip URL.
4. **Side-by-side comparison.** In `docs/audits/REGRESSION-DIFF-2026-04-21.md` render a table with: photo | Legacy prompt | Legacy clip | Legacy rating | DA.1 prompt | DA.1 clip | DA.1 `motion_headroom` | observable difference. Be concrete — which motion fields differ, which hallucinations got banned, did the DA.3 validator override anything.
5. **If time + budget permits, do a second scene.** Second scene = different room type (pick one interior and one exterior across the 1–2 renders) so the test covers both regimes.
6. **Write a verdict paragraph** at the top of the audit doc. Three possible verdicts:
   - **CLOSED** — DA.1 clip is clearly better or equal on the anchor scene, regression hypothesis validated.
   - **NECESSARY BUT NOT SUFFICIENT** — DA.1 fixes the specific hallucination it was designed to fix, but the clip still has other issues. Document the residual problems.
   - **NO CHANGE** — DA.1 doesn't improve this anchor. Document why (maybe this scene's regression wasn't motion-headroom-driven).
7. **Log every render** to `docs/audits/test-render-log-2026-04-21.md` (timestamp, window, photo_id, SKU, cost_cents, clip URL, observation).
8. **Docs-subagent run + commits in logical chunks.**

### Must NOT do

- Do NOT re-render more than the minimum needed. Budget cap: **$5**. One scene = ~$1.50–$3. Two scenes max. If you find yourself reaching for a third, stop.
- Do NOT edit production code. This is a measurement exercise, not a code change.
- Do NOT touch `lib/providers/router.ts` or any SKU routing — use whatever SKU the Lab picks / Oliver's rule would pick.
- Do NOT push.
- Do NOT edit files outside this worktree.

## Self-check protocol (MANDATORY)

Keep a session log at `docs/sessions/2026-04-21-window-B-round-2.md`. Every ~45 minutes + at every milestone, append a **Self-check** answering:

- **(a) Criterion served?** Expected: #2 no hallucinations, with rendered evidence.
- **(b) Highest-leverage next step?** Key pivot triggers:
  - Anchor scene can't be found in DB (legacy data incomplete) → stop, report to coordinator, don't render.
  - First render visibly matches Legacy quality → consider ONE second render on a different regime (interior if first was exterior) to broaden evidence, but don't chase perfection.
  - First render looks worse than Legacy → STOP and investigate before spending more budget. That's a critical finding.
- **(c) Evidence?** Gemini analysis JSON shows coherent `motion_headroom`? Director prompt visibly includes the camera-state block + hard-ban rule? Rendered clip actually differs from Legacy clip?
- **(d) Pivot? → STOP, commit WIP, document.**

**Stuck >30 min:** commit WIP, write `docs/sessions/2026-04-21-window-B-round-2-blocker.md`, ping Oliver.

## Docs-subagent (before every commit)

> "Update `docs/HANDOFF.md` Recent shipping log (one line per commit). Update `docs/state/PROJECT-STATE.md` DA.1 section to reflect regression-diff verdict. Update memory file `project_legacy_lab_regression_hypothesis.md` with the verdict + evidence. `git status` — confirm only files in `.worktrees/wt-da1/` touched (or a fresh `session/regression-diff-2026-04-21` branch). Commit with a clean message."

## Exit criteria (3 hours)

- [ ] One anchor scene identified with Legacy-5★ evidence documented
- [ ] One DA.1 post-merge render on the same photo, logged to test-render-log
- [ ] Optionally: a second scene covering the other regime (interior/exterior)
- [ ] `docs/audits/REGRESSION-DIFF-2026-04-21.md` committed with verdict paragraph + side-by-side table
- [ ] Self-check entries in the Round 2 session log
- [ ] Committed in ≥2 logical chunks
- [ ] Total spend ≤$5 confirmed against `cost_events`
- [ ] Memory + HANDOFF + PROJECT-STATE updated via docs-subagent

## Budget

**Render cap: $5.** One scene typically ≈$1.50–$3 depending on SKU + duration. Two scenes max. If `cost_events` shows you approaching $5, stop immediately and write up whatever you have.

## If you finish early

Do NOT freelance. Instead: pick the highest-leverage follow-up:

1. **Carry-forward notes from Round 1:** fix the `mapCameraMovementToHeadroomKey('drone_push_in')` mapping that only returns one key instead of both `push_in` and `drone_push_in`. That's a real validator gap Oliver flagged himself. Small, surgical, commit separately.
2. **Quick ML-flow check:** query `prompt_revisions` for any rows promoted from `prompt_lab_recipes` in the last 30 days. If the answer is still 0 (as M.1 audit found), write a one-line note in `docs/audits/REGRESSION-DIFF-2026-04-21.md` — that's a separate issue but worth surfacing in the same session.

## Success definition

One paragraph at the top of `REGRESSION-DIFF-2026-04-21.md` that Oliver can read in 30 seconds and know: did DA.1 actually close the Dev Lab regression on a real scene, or not? Everything else in the doc is evidence for that paragraph.
