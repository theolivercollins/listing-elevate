# Session — 2026-05-13 — Prompt-collapse fix

**Branch:** `feat/prompt-collapse-fix` (off `origin/dev`)
**Commits:** 7 (see below)
**Status:** local-only; pending Oliver's OK to push.

## Trigger

Oliver: "videos are generating themselves [with] the same prompt over and over (in a lot of scenarios) like a low glide for example, instead of the prompts we've built into the recipe."

## Investigation

Two-agent co-investigation (Claude + Codex). Findings converged with complementary coverage:

**What Claude found (production-side):**
- Production `lib/pipeline.ts:runScripting` never calls `retrieveMatchingRecipes` at all — the 115-recipe library is consulted only by Lab paths.
- Production injects a generic top-5 winners + top-5 losers block via `fetchRatedExamples`, date-ranked across all properties (not per-photo).
- Gemini analyzer's per-room defaults bias `low_angle_glide` as the FIRST default for living_room and foyer — the two most common rooms.
- Director rule respects `suggested_motion` as a strong default and only varies for consecutive-scene sameness. In a 12-scene listing with 5 low-glide suggestions, the director just spaces them out.
- HANDOFF flag: "0 overrides ever promoted" — the Lab→prod promotion mechanism is built but unused.

**What Codex found (additional bugs):**
- `renderRecipeBlock` only renders `recipes[0]` — even when retrieval returns 3, the other 2 are silently dropped.
- DA.3 validator overrides `scene.camera_movement` but never updates `scene.prompt`, so a SKU selected for the replacement motion receives a prompt naming the original verb.

**What they missed:**
- Codex initially scoped to `lib/prompt-lab-listings.ts`, missing that production is a separate code path (`lib/pipeline.ts`) and the root issue (prod doesn't fetch recipes at all) is larger than what's visible in the listings-lab file.

## Design

Three independently-shippable fixes on one branch:

1. **Phase 1 — DA.3 prompt-rewrite guard.** Deterministic template-fill, no extra LLM call.
2. **Phase 2 — Per-photo retrieval into prod + top-K rendering + headroom-compatibility filter.**
3. **Phase 3 — Verify + HANDOFF.**

Spec: `docs/specs/2026-05-13-prompt-collapse-fix-design.md`.
Plan: `docs/plans/2026-05-13-prompt-collapse-fix.md`.

## What shipped

### Phase 1 — DA.3 prompt rewrite

- **New module** `lib/prompts/rewrite-on-motion-override.ts` — `rewritePromptForNewMotion(originalPrompt, newMotion, subjectFallback?)`. Pattern-extracts subject from original prompt, falls back to caller-provided subject (typically `director_intent.subject`), final fallback to a generic safe template. 11 motion verbs mapped to canonical templates.
- **Applied in prod DA.3 site** `lib/pipeline.ts:625-647` — after `scene.camera_movement = replacement`, also rewrites `scene.prompt`. Logs both original and rewritten prompt for post-hoc audit.
- **Applied in listings-lab DA.3 site** `lib/prompt-lab-listings.ts:412-441` — same fix, defensive subject extraction because `director_intent` is still raw JSON at this point.
- 9 vitest cases (`lib/prompts/__tests__/rewrite-on-motion-override.test.ts`).

### Phase 2a — Top-K recipe rendering

- **Modified** `renderRecipeBlock` in `lib/prompt-lab.ts:390` from `recipes[0]`-only to top-K (default 3) with explicit similarity scores (`1 - distance` × 100, rounded). Configurable via `opts.maxK`.
- Block header changed from "VALIDATED RECIPE MATCH" (singular) to "VALIDATED RECIPE MATCHES" (plural) to reflect multi-recipe rendering. Guidance updated to tell the director "Prefer the highest-similarity match unless its motion clearly doesn't fit this frame."
- 6 vitest cases (`lib/prompts/__tests__/render-recipe-block.test.ts`).

### Phase 2b — Per-photo retrieval helper

- **New module** `lib/prompts/per-photo-retrieval.ts`:
  - `fetchPerPhotoRetrievalBundle({photoId, roomType, motionHeadroom, opts?})` — reads `photos.image_embedding`, fetches top-3 recipes + top-5 exemplars + top-3 losers in parallel via the existing RPCs (`match_lab_recipes`, `match_rated_examples`, `match_loser_examples`), filters recipes via `filterRecipesByMotionHeadroom`. Distance threshold default 0.35 (matches Lab). Returns empty bundle when no image_embedding.
  - `filterRecipesByMotionHeadroom(recipes, headroom)` — encodes the same AND/OR semantics as DIRECTOR_SYSTEM motion-headroom bans (push_in/orbit/parallax/dolly_*/low_angle_glide → require key; reveal → requiresAny: parallax OR push_in; drone_push_in → requires BOTH push_in AND drone_push_in; feature_closeup/rack_focus → always; unknown movements → defer to director).
  - `renderPerPhotoBlock(photoId, bundle)` — composes the per-photo block by stacking `renderRecipeBlock` + `renderExemplarBlock` + `renderLoserBlock` under a labelled header.
- 8 vitest cases for the filter (`lib/prompts/__tests__/per-photo-retrieval.test.ts`).

### Phase 2c — Wire into prod

- **Replaced** `learningBlock` in `lib/pipeline.ts:runScripting` (lines 522-550 pre-fix). Now fetches per-photo bundles in parallel (`Promise.all` over `photoData`), filters out empty blocks, concatenates under a new "PER-PHOTO RETRIEVAL" wrapper, and logs counts per stage. Falls back to no-block (silent) on retrieval error.
- Removed now-unused `fetchRatedExamples` import.

### Bundled hygiene

- `chore(deps): pin vitest to ^3 on dev branch for vite-5 compatibility` — forward-port of `757823a` from the portal branch. Dev had `vitest@^4.1.4` which breaks under vite 5 with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Without this pin the test suite couldn't run.

## Test results

- `pnpm exec tsc --noEmit` — clean.
- `pnpm exec vitest run` — 254 pass / 1 fail. The 1 failure is the pre-existing `src/v2/components/landing/MarketComparison.test.tsx > renders the section headers for each pitch prong` flake (called out in prior HANDOFF entries, unrelated to this work).
- `pnpm run doctor` — no new issues.

## Commits (newest on top)

```
c0509ee feat(pipeline): per-photo recipe + exemplar + loser retrieval in prod
10014b2 feat(prompts): per-photo retrieval bundle + motion_headroom compat filter
72ccf81 fix(prompts): renderRecipeBlock renders top-K with similarity scores
f7e41a0 fix(prompt-lab-listings): DA.3 rewrites prompt text on motion override
ccc2dbb fix(pipeline): DA.3 rewrites prompt text when overriding camera_movement
5dc4771 chore(deps): pin vitest to ^3 on dev branch for vite-5 compatibility
97e2dcb feat(prompts): rewritePromptForNewMotion + design spec + plan
```

## Operational follow-ups (after merge)

- Promote the 6 pending DIRECTOR_SYSTEM patches at `/dashboard/development/proposals` (`c0708a98-…`). The Lab→prod promotion mechanism has never been used; this is the second axis of fix (DIRECTOR_SYSTEM rules, separate from retrieval).
- Once recipe flow is observed working on the dev preview render, flip `USE_THOMPSON_ROUTER=true` on Vercel — adds exploration so the system doesn't lock onto recipe monoculture from Oliver's early ratings.
- Re-run mining (`POST /api/admin/prompt-lab/mine`) after a week of new ratings to surface fresh patches.

## What's NOT in this branch

- Thompson router flip (separate flag).
- Gemini analyzer per-room default rewrite (deferred — re-evaluate if low-glide remains over-clustered after retrieval is live).
- Feature-level retrieval ("aggregate from previous pool successes"). Photo-level retrieval first; feature-level is a future phase that requires new entity-embedding infrastructure.
- Promote-to-prod button click for pending patches (operational, post-merge).

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Per-photo retrieval adds latency to scripting stage | Parallelized via `Promise.all`. Expected wall-clock impact: ~200ms total for 12 photos. |
| Photos without `image_embedding` | `fetchPerPhotoRetrievalBundle` returns empty bundle → director runs with no exemplar guidance for that photo. Same as today, just per-photo instead of global. |
| Recipe monoculture inherited from Oliver's ratings | Thompson router (built, off) is the long-term counter. Flagged for follow-up. |
| DA.3 prompt rewrite produces awkward text | Deterministic template-fill is constrained; 9 vitest cases. Worst case = same as today (mismatched prompt). |

## Recommended manual smoke after merge to dev

1. Render one test property on `dev` preview URL.
2. Eyeball the scene table for motion variety (expect ≥5 different `camera_movement` values across 10-12 scenes, no single motion repeated >3 times).
3. Find a scene whose DA.3 fired (warn log: "DA.3 override: scene N picked X but ...") — verify `prompt` text contains the replacement motion verb (e.g. "feature_closeup" → prompt contains "shallow depth of field").
4. Check Vercel function logs for "Per-photo retrieval: N/12 photos got retrieval blocks (R recipes, E exemplars, L losers)" — confirms the new code path fired.
