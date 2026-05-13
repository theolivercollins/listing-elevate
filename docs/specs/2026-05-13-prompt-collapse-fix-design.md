# Prompt Collapse Fix — Design

**Date:** 2026-05-13
**Author:** Oliver + Claude (co-investigation with Codex second opinion)
**Status:** approved → in implementation on `feat/prompt-collapse-fix`

## Problem

Production renders are producing the same motion ("low angle glide") in 4–6 of 12 scenes for typical listings, with near-identical prompt phrasing across scenes. Observed by Oliver in shipped videos.

## Root cause (multi-factor)

A stack of changes between 2026-04-20 and 2026-04-28 created a collapse-to-default-motion failure mode:

1. **Gemini analyzer over-suggests `low_angle_glide`** for the two most common rooms (living_room, foyer). `lib/prompts/photo-analysis.ts:134-141` lists it as the FIRST default for coffered/vaulted/tray/picture-window living rooms and foyers with staircase/chandelier.
2. **Director treats `suggested_motion` as a strong default** and only varies motion for *consecutive* scenes (`lib/prompts/director.ts:303-313`). In a 12-scene listing with 5 low-glide suggestions, scenes 2, 4, 6, 8, 10 all collapse to the same verb.
3. **DA.2 motion_headroom hard bans** (`lib/prompts/director.ts:316-367`) prune alternatives on tight interiors, so the director falls back to the suggestion more often.
4. **Production never reads the recipe library.** 115 winning prompts live in `prompt_lab_recipes` and are queried by Lab paths (`directSinglePhoto`, `directListingScenePrompt`), but `lib/pipeline.ts:runScripting` never calls `retrieveMatchingRecipes`. Prod injects a generic top-5 winners block from `fetchRatedExamples` (date-ranked, not photo-similar).
5. **`renderRecipeBlock` only renders `recipes[0]`** (`lib/prompt-lab.ts:390-394`). Even Lab paths that retrieve top-3 throw away matches 2 and 3.
6. **DA.3 prompt/movement mismatch** (`lib/pipeline.ts:621-652`, `lib/prompt-lab-listings.ts:404-441`). The validator overrides `scene.camera_movement` post-hoc but leaves `scene.prompt` unchanged. Result: a SKU selected for `feature_closeup` receives a prompt that says "steady cinematic low angle glide…".
7. **Lab → prod promotion has never happened.** 6 mined DIRECTOR_SYSTEM patches sit unpromoted at `/dashboard/development/proposals` (`c0708a98-…`). The promotion mechanism (`prompt_revisions` + `resolveProductionPrompt`) is built but unused.

## Design

Three independent changes that ship as one branch:

### Phase 1 — DA.3 prompt rewrite guard

When the DA.3 validator overrides `camera_movement`, also rewrite `scene.prompt` so the SKU and the prompt text agree. Deterministic template-fill, not a re-call (latency + cost).

- New module: `lib/prompts/rewrite-on-motion-override.ts`
  - `rewritePromptForNewMotion(originalPrompt: string, newMotion: CameraMovement, subjectFallback?: string): string`
  - Pattern-extracts the modifier (e.g. "steady cinematic") and subject phrase from the original prompt, rebuilds with the new motion verb's canonical phrasing. Falls back to a safe template when extraction fails.
- Apply in both DA.3 sites:
  - `lib/pipeline.ts:625-647` (prod runScripting)
  - `lib/prompt-lab-listings.ts:412-435` (listings lab)

### Phase 2 — Per-photo retrieval into prod + headroom-compatibility filter + top-K rendering

Replace prod's generic top-5 block with per-photo retrieval bundles. Each bundle = top-3 recipes (filtered by motion_headroom) + top-5 winners + top-3 losers, scoped to that photo's room_type and embedded composition.

- Fix `renderRecipeBlock` to accept all recipes and render them with similarity scores (1 − distance). Default cap: 3. Phase 2a — separable.
- New module: `lib/prompts/per-photo-retrieval.ts`
  - `fetchPerPhotoRetrievalBundle(photo, opts): Promise<PerPhotoBundle>`
  - `renderPerPhotoBlock(photoId, bundle): string`
  - Recipe compatibility filter: drop any recipe whose `camera_movement` violates the photo's `motion_headroom` keys (uses existing `mapCameraMovementToHeadroomKey`).
- Wire into `lib/pipeline.ts:runScripting`:
  - For each photo in `photoData`, fetch a retrieval bundle in parallel.
  - Concatenate per-photo blocks into the director's user message.
  - Drop the current generic top-5 `learningBlock` block (replaced by per-photo).
  - Distance threshold: 0.35 (matches Lab default at `lib/prompt-lab.ts:339`).
  - Photos without an `image_embedding` skip retrieval (degrade to text-only or empty bundle).

### Phase 3 — Verify + ship

- Run `pnpm vitest`, `pnpm exec tsc --noEmit`, `pnpm run doctor`.
- Append Recent shipping log + Right Now to `docs/HANDOFF.md`.
- Session notes to `docs/sessions/2026-05-13-prompt-collapse-fix.md`.
- Promote pending DIRECTOR_SYSTEM patches at `/dashboard/development/proposals` — operational, not blocking the branch.

## What this is NOT

- Not turning on Thompson router. Done separately once recipe flow is verified working.
- Not changing Gemini analyzer's per-room defaults. Once recipes are flowing and compatibility-filtered, the analyzer's bias should matter less. Revisit if low_angle_glide remains over-clustered after Phase 2.
- Not introducing feature-level retrieval ("aggregate from previous pool successes"). Photo-level retrieval first; feature-level is a future phase.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Per-photo retrieval adds ~150ms × 12 photos to scripting stage | Parallelize all fetches in one `Promise.all`. Expected wall-clock impact: ~200ms. |
| Recipe monoculture — recipes were built from Oliver's ratings | Thompson router (built, off) is the long-term counter. Not in scope; flag for follow-up. |
| Photos without `image_embedding` | Fall back to text-embedding-only retrieval (existing RPC supports this). Empty bundle if no embeddings at all — director runs as today. |
| DA.3 prompt rewrite produces awkward output | Deterministic template-fill is constrained; sanity-tested via vitest. Worst case: same as today (mismatched prompt text). |

## Out of scope

- Promote the 6 pending mined patches — operational, done in browser after merge.
- Turn on `USE_THOMPSON_ROUTER=true` — separate flag flip.
- Feature-level retrieval — future phase.
- Re-running mining — operational.

## Test plan

- Unit: `rewritePromptForNewMotion` covers each of the 11 motion verbs + fallback cases.
- Unit: `filterRecipesByMotionHeadroom` covers recipe-in-headroom + recipe-banned + missing-headroom (Claude-fallback photo) cases.
- Unit: `renderRecipeBlock` renders 1/2/3 recipes correctly; empty list returns empty string.
- Integration: existing pipeline tests still pass (none directly cover runScripting, so manual smoke after deploy).
- Manual smoke after merge to `dev`: render one test property end-to-end; eyeball that motion distribution shows variety.

## File map

**Create:**
- `lib/prompts/rewrite-on-motion-override.ts`
- `lib/prompts/__tests__/rewrite-on-motion-override.test.ts`
- `lib/prompts/per-photo-retrieval.ts`
- `lib/prompts/__tests__/per-photo-retrieval.test.ts`
- `docs/specs/2026-05-13-prompt-collapse-fix-design.md` (this file)
- `docs/plans/2026-05-13-prompt-collapse-fix.md`
- `docs/sessions/2026-05-13-prompt-collapse-fix.md`

**Modify:**
- `lib/prompt-lab.ts` (top-K recipe rendering)
- `lib/pipeline.ts` (DA.3 rewrite + wire per-photo retrieval into runScripting)
- `lib/prompt-lab-listings.ts` (DA.3 rewrite)
- `docs/HANDOFF.md` (shipping log + Right Now)
