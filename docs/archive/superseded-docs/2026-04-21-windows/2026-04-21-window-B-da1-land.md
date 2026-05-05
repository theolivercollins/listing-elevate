# Round 1 — Window B — Land DA.1 (Gemini as Eyes)

Last updated: 2026-04-21
Branch: `session/da1-land-2026-04-21`
Worktree: `/Users/oliverhelgemo/real-estate-pipeline/.worktrees/wt-da1`

## Your mission

Finish, test, and commit the DA.1 work that's already drafted in your worktree. DA.1 introduces Gemini 3 Flash as the per-photo analyzer, emitting structured `motion_headroom` (per-motion geometric feasibility) + `camera_height` / `camera_tilt` / `frame_coverage`. The director consumes `motion_headroom` as **HARD BANS** on camera-movement choices — this is the fix for the hallucination regression Oliver has been experiencing since the Dev Lab / Kling v3 switch.

## North Star you are serving

Criterion **#2 — no hallucinations**. DA.1 is a direct fix for director hallucinations (top_down planned from already-aerial photos, orbit planned from exteriors with no visible back-of-house, etc.). Everything else (#1 no HITL, #3 no wasted money, #4 right SKU) benefits downstream but is NOT your job this round.

## Required reading (in order, before any edits)

1. `/Users/oliverhelgemo/real-estate-pipeline/docs/HANDOFF.md`
2. `/Users/oliverhelgemo/real-estate-pipeline/docs/state/PROJECT-STATE.md`
3. `/Users/oliverhelgemo/real-estate-pipeline/docs/specs/2026-04-21-daily-engagement-design.md` (the plan)
4. `/Users/oliverhelgemo/.claude/projects/-Users-oliverhelgemo/memory/project_gemini_vision_preprocessor_idea.md`
5. `/Users/oliverhelgemo/.claude/projects/-Users-oliverhelgemo/memory/project_legacy_lab_regression_hypothesis.md`
6. Your worktree's uncommitted diff — start with `git status`, then read:
   - `lib/providers/gemini-analyzer.ts` (new — 394 lines)
   - `supabase/migrations/030_photo_camera_state.sql` (new)
   - `git diff lib/pipeline.ts`
   - `git diff lib/prompts/director.ts`
   - `git diff lib/prompt-lab-listings.ts`
   - `git diff lib/db.ts`
   - `git diff scripts/cost-reconcile.ts`
   - `git diff .env.example`
   - `git diff docs/state/STACK.md`

## Scope

### Must do

1. **Understand the intended integration.** The file `lib/providers/gemini-analyzer.ts` is the new entrypoint. `pipeline.ts` + `prompt-lab-listings.ts` + `director.ts` are modified to call it. Read the whole diff and build a mental model before running anything.
2. **Verify the toolchain.** Run `npm install` if `@google/genai` is newly added in `package.json`. Confirm `GEMINI_API_KEY` is present in `.env` (NOT just `.env.example`) — if not, ask Oliver in coordinator window before continuing.
3. **Run migration 030.** Apply `supabase/migrations/030_photo_camera_state.sql`. Preferred path: `npx supabase migration up` or the existing migration runner this repo uses (check `package.json` scripts). Verify the columns exist: `psql` or the Supabase MCP `execute_sql` with `SELECT column_name FROM information_schema.columns WHERE table_name = 'photos' AND column_name IN ('analysis_json', 'analysis_provider');`
4. **Unit-test the analyzer in isolation.** Write a minimal script `scripts/test-gemini-analyzer.ts` that calls `analyzePhotoWithGemini(imageUrl)` on ONE real photo URL from Supabase Storage. Log the full result. Confirm the `motion_headroom` booleans look sensible (aerial photo → `top_down: false`; close shot → `push_in: false`; etc.).
5. **End-to-end test on one scene.** Pick one existing scene in a dev listing (use the Lab UI on localhost or query the DB for a scene with a photo). Trigger a full photo analysis → director → (but do NOT actually render the clip unless budget allows — see budget section). Capture the director prompt that gets produced. Confirm it mentions or respects the new fields.
6. **Optional render test, if budget allows.** Render ONE scene end-to-end on the new path, then log it to `docs/audits/test-render-log-2026-04-21.md`. Compare subjectively vs the Legacy behavior if you can find one to compare against.
7. **Update docs + memory via docs-subagent (see below).**
8. **Commit in small logical chunks** on your branch. Suggested commits: (a) migration + schema types, (b) analyzer + deps, (c) pipeline integration, (d) prompt-lab-listings integration, (e) director integration, (f) test script + docs.

### Must NOT do

- Do not push to origin.
- Do not merge into main.
- Do not edit files outside this worktree.
- Do not run more than **$15 of renders** total. Every render appends a row to `docs/audits/test-render-log-2026-04-21.md`.
- Do not rewrite or refactor the existing DA.1 code beyond what's needed to make it pass type-check and the smoke tests. This work was drafted intentionally — you are LANDING it, not redesigning it.

## Self-check protocol (MANDATORY)

Keep a live session log at `/Users/oliverhelgemo/real-estate-pipeline/docs/sessions/2026-04-21-window-B.md`. Append a **Self-check** entry every ~45 minutes AND at every milestone answering:

- (a) Which of Oliver's 4 North-Star criteria am I serving? (Expected: #2 no hallucinations.)
- (b) Is this step the highest-leverage next step, or would a different approach close the gap faster? (Example pivots: if Gemini API is down, drop back to pure-prompt fixes; if migration won't apply, file a coordinator-flag note and move to analyzer-only testing.)
- (c) What's my evidence the work is actually working? (Migration succeeded? `npm run type-check` passes? Analyzer returned a sane JSON for a real photo? Director prompt visibly changed?)
- (d) If (b) says pivot — STOP, commit WIP, document the pivot and its reason at the top of the session log. Then ping Oliver in the coordinator window if the pivot changes scope.

**If stuck >30 minutes on the same problem:** commit WIP with `WIP — stuck on <thing>`, write a short dispatch brief at `/Users/oliverhelgemo/real-estate-pipeline/docs/sessions/2026-04-21-window-B-blocker.md` describing what you tried and what you need, then tell Oliver.

## Docs-subagent (run before every commit)

Dispatch a Sonnet subagent with this prompt:

> "Update `/Users/oliverhelgemo/real-estate-pipeline/docs/HANDOFF.md`: add one line to Recent shipping log for this commit; update Right now if next-action changed. Update `/Users/oliverhelgemo/real-estate-pipeline/docs/state/PROJECT-STATE.md` if DA.1 now flips the Gemini-analyzer feature to shipped / partially-shipped. Update `/Users/oliverhelgemo/.claude/projects/-Users-oliverhelgemo/memory/project_gemini_vision_preprocessor_idea.md` to reflect that DA.1 is no longer 'idea' but 'in-progress landing'. Before committing: run `git status`, confirm only files inside this worktree (path contains `/wt-da1/`) are modified, then commit with a Conventional-Commits-style message like `feat(ml): DA.1 Gemini analyzer with motion_headroom (part N/M)`."

## Exit criteria (3 hours)

- [ ] Migration 030 applied to dev Supabase; `photos.analysis_json` + `photos.analysis_provider` exist.
- [ ] `scripts/test-gemini-analyzer.ts` runs end-to-end on one real photo URL and prints a sane JSON with `motion_headroom` booleans matching the photo's actual camera geometry.
- [ ] At least one director prompt produced through the new pipeline path observably reflects the new camera-state input (e.g. rejects an impossible motion, or selects one from the headroom set).
- [ ] Committed in ≥3 logical chunks on `session/da1-land-2026-04-21` branch.
- [ ] `docs/sessions/2026-04-21-window-B.md` exists with self-check entries.
- [ ] `docs/HANDOFF.md` updated via docs-subagent.
- [ ] `docs/audits/test-render-log-2026-04-21.md` has any renders you ran logged.

## Budget

Render cap: **$15** this window. Zero renders is acceptable — smoke tests of analyzer + director without actual Kling/Atlas calls are the minimum bar. Every render MUST log to the shared test-render log.

## If you finish early

Do NOT freelance into Window C or D territory. Instead: begin the Round 2 work on your own window — start a lightweight regression-diff audit by querying `prompt_lab_sessions` for Oliver's Legacy Prompt Lab anchors ("San Massimo", "Manasota Key", "Kittiwake"). Pull 1–2 of his 5★ Legacy iterations and diff their director prompts against a current Dev Lab 2–3★ iteration. Save to `docs/audits/REGRESSION-DIFF-2026-04-21-partial.md`. This primes your Round 2.
