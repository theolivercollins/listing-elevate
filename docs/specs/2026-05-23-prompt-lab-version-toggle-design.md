# Prompt Lab — v1 / v1.1 version toggle

**Date:** 2026-05-23
**Branch:** `feat/prompt-lab-version-toggle` (off `main`)
**Status:** Draft for approval
**Predecessor:** `2026-05-23-v1.1-seedance-pushin-design.md` (production pipeline_mode toggle)

## Goal

A "Version" segmented control at the top of Prompt Lab that splits the entire Lab UX into two parallel views:

- **v1** — current behavior. Iterations rendered with the user-chosen Kling/Runway/Atlas SKU. Free choice of camera movement.
- **v1.1** — Seedance 2.0 push-in only. SKU picker is hidden (Seedance is the only option). Camera movement is forced to push-in. Speed-ramp polish applied on download. Listings, iterations, ratings, recipes, modifications, and Thompson stats are scoped to v1.1 — they do NOT mingle with v1's learning signal.

Switching the toggle changes which listings appear in the session list, which iteration history shows, and which recipes/feedback inform routing. **A listing is locked to its version at create time** — you don't migrate a v1 listing to v1.1 or vice versa.

## Non-goals (YAGNI)

- Cross-version comparisons in the same view. Want a side-by-side? Open two tabs, one per version.
- Re-rendering an existing v1 iteration under v1.1 (or vice versa). The version is a property of the listing.
- A "v1.0.1 / v1.0.2 / …" version system. Two values only: `'v1'` and `'v1.1'`. Future extension uses the same `pipeline_version` column.
- Thompson sampling for v1.1. v1.1 has one SKU and no movement variety — no exploration to do.

## Architecture

### 1. DB — migration 063

Add `pipeline_version TEXT NOT NULL DEFAULT 'v1' CHECK IN ('v1','v1.1')` to three tables:

```sql
ALTER TABLE prompt_lab_listings
  ADD COLUMN pipeline_version TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE prompt_lab_listings
  ADD CONSTRAINT prompt_lab_listings_pipeline_version_check
  CHECK (pipeline_version IN ('v1', 'v1.1'));

ALTER TABLE prompt_lab_listing_scene_iterations
  ADD COLUMN pipeline_version TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE prompt_lab_listing_scene_iterations
  ADD CONSTRAINT prompt_lab_listing_scene_iterations_pipeline_version_check
  CHECK (pipeline_version IN ('v1', 'v1.1'));
CREATE INDEX idx_prompt_lab_iterations_version ON prompt_lab_listing_scene_iterations (pipeline_version);

ALTER TABLE prompt_lab_recipes
  ADD COLUMN pipeline_version TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE prompt_lab_recipes
  ADD CONSTRAINT prompt_lab_recipes_pipeline_version_check
  CHECK (pipeline_version IN ('v1', 'v1.1'));
CREATE INDEX idx_prompt_lab_recipes_version ON prompt_lab_recipes (pipeline_version);

COMMENT ON COLUMN prompt_lab_listings.pipeline_version IS
  'Pinned at listing creation. v1 = legacy Kling/Runway/Atlas mixed-movement routing. v1.1 = Seedance 2.0 push-in only with FFmpeg speed-ramp polish. Iterations + recipes inherit this value.';
```

Existing rows default to `'v1'` — no backfill needed beyond the `DEFAULT`.

**Not touched** (intentional): `router_bucket_stats`. v1.1 uses a single SKU (`seedance-pro-pushin`) and Thompson sampling has nothing to explore there. We exclude `seedance-pro-pushin` from `router_bucket_stats` writes and reads instead of widening the schema.

### 2. Render endpoints — `api/admin/prompt-lab/render.ts` + `rerender.ts`

Both endpoints already accept `{ iteration_id }` (render) or `{ source_iteration_id, provider, sku }` (rerender). New flow:

1. Load the iteration → load `prompt_lab_listing.pipeline_version`.
2. If `pipeline_version === 'v1.1'`:
   - **Override SKU** to `seedance-pro-pushin` regardless of what the user passed. Atlas dispatches via the existing SKU registry (already pinned to `bytedance/seedance-2.0/image-to-video`).
   - **Override prompt** using `forceSeedancePushInPrompt(directorPrompt)` from `lib/providers/router.ts`. Stored director prompt remains unmutated (audit trail).
   - **Tag** the new iteration row with `pipeline_version = 'v1.1'` (defaults from the listing).
3. If `pipeline_version === 'v1'`: existing behavior unchanged.

### 3. Speed-ramp polish in Lab

Lab iteration clip download is currently `submitLabRender()`'s downstream path (poll-lab-renders cron — `api/cron/poll-lab-renders.ts`). When the iteration's `pipeline_version === 'v1.1'`:
- After `downloadClip()`, run `applySpeedRampToBuffer()` (same utility shipped in production cron).
- On ramp failure: log + ship raw clip (same fallback policy as prod).

This means Lab ratings reflect the actual production output 1:1 — no surprises when a v1.1 recipe gets promoted.

### 4. Recipe promotion — `lib/prompt-lab.ts::autoPromoteIfWinning`

When a v1.1 iteration is rated ≥4★ and gets auto-promoted to a recipe, the new `prompt_lab_recipes` row inherits `pipeline_version = 'v1.1'`. Recipe retrieval at render time filters by version: a v1.1 render only retrieves v1.1 recipes; a v1 render only retrieves v1 recipes. Prevents v1.1's narrow push-in style from polluting v1's mixed-movement recipes.

**Files to edit:** wherever the recipe is `INSERT`ed (probably `lib/prompt-lab.ts`) and wherever recipes are `SELECT`ed for retrieval (per-photo retrieval path).

### 5. Thompson router isolation

`scripts/refresh-router-bucket-stats.ts` (or equivalent aggregator) — add a `WHERE iter.model_used != 'seedance-pro-pushin'` clause so v1.1 iterations never feed into Thompson alpha/beta. Belt + suspenders: `lib/providers/router.ts::resolveDecisionAsync` already only fires for V1 SKUs (`V1_ATLAS_SKUS`), so even if a stat row leaked in it wouldn't be picked. No schema change needed.

### 6. UI — `src/pages/dashboard/PromptLab.tsx`

**A. URL state.** Add `?v=v1` | `?v=v1.1` query param. Default = `v1` when absent. Deep links preserve the version.

**B. Version segmented control.** Sits at the **top of the page**, above the SessionList header (and above the SessionDetail header when viewing a single session). Two pill buttons: "v1 — Default" / "v1.1 — Seedance". Selected pill is filled; unselected is muted outline.

**C. SessionList — filter.** Query `prompt_lab_listings WHERE pipeline_version = <selected>` (with the existing user-id filter). Listings created in v1 mode do not appear in v1.1 mode and vice versa.

**D. SessionList — "New session" button.** Inherits the currently-selected version when creating the new `prompt_lab_listings` row.

**E. SessionDetail.**
- Header shows a version badge ("v1.1 — Seedance push-in").
- The badge is non-interactive (clicking it does nothing). To switch versions you go back to SessionList and toggle there.
- When viewing a v1.1 session:
  - **Hide the SKU dropdown** entirely on `IterationCard` (no choice — Seedance is the only option).
  - **Hide the camera-movement picker** (push-in is forced).
  - Show a one-line note: "v1.1 — Seedance 2.0 push-in. Camera movement forced to push-in; speed-ramp polish applied on download."
  - Re-render buttons ("Try Kling", "Try Runway") are hidden.

**F. Empty state.** When a user lands on v1.1 with no v1.1 listings yet, show: "No v1.1 sessions yet. Click 'New session' to create one — every iteration will route through Seedance 2.0 push-in with FFmpeg speed-ramp polish, separate from your v1 work."

### 7. Test plan

- `lib/prompt-lab.test.ts` (new) — given a v1.1 listing, `submitLabRender` overrides SKU to seedance-pro-pushin and prompt to push-in directive.
- `api/admin/prompt-lab/__tests__/render-v1.1.test.ts` — POST with a v1.1 iteration → row created with `pipeline_version='v1.1'`, `model_used='seedance-pro-pushin'`.
- `api/admin/prompt-lab/__tests__/rerender-v1.1.test.ts` — same shape; ignores user's provider/sku override.
- `lib/prompt-lab.test.ts` — `autoPromoteIfWinning` on a v1.1 iteration creates a v1.1-tagged recipe.
- Recipe retrieval test — v1.1 render only retrieves v1.1 recipes; v1 render only retrieves v1 recipes.
- UI: not in scope for automated tests (existing Lab UI has none). Manual screenshot.

### 8. Files touched

| Path | Reason |
|---|---|
| `supabase/migrations/063_prompt_lab_pipeline_version.sql` | NEW |
| `lib/prompt-lab.ts` | render override, autoPromoteIfWinning version tag, recipe retrieval version filter |
| `api/admin/prompt-lab/render.ts` | read listing.pipeline_version → override |
| `api/admin/prompt-lab/rerender.ts` | read listing.pipeline_version → override |
| `api/cron/poll-lab-renders.ts` | apply speed-ramp on v1.1 iteration download |
| `lib/promptLabApi.ts` (client) | createListing takes pipelineVersion; listListings takes version filter |
| `src/pages/dashboard/PromptLab.tsx` | URL state, segmented control, filter, badge, hide SKU/movement pickers on v1.1 |
| `src/components/lab/IterationCard.tsx` | hide SKU dropdown when pipeline_version='v1.1' |
| `src/components/lab/GenerateAllModal.tsx` | hide model picker when v1.1 |
| `lib/types.ts` | add `pipeline_version` to `PromptLabListing` + `PromptLabIteration` + `PromptLabRecipe` interfaces |
| `scripts/refresh-router-bucket-stats.ts` | exclude seedance-pro-pushin |
| `docs/HANDOFF.md` | new "Right now" entry |

### 9. Out of scope

- Re-rating older v1 iterations under v1.1 (or vice versa). Don't support.
- Migration tool to clone a v1 session into v1.1. Don't build.
- Mixed sessions (some scenes v1, some v1.1). The pipeline_version is on the listing, not the scene.
- Cross-version Thompson sampling. Permanent — v1.1 has one SKU, no signal to compare.

## Open questions

- **`prompt_lab_listings.model_name`** — currently unused TEXT column. Worth dropping? Out of scope; revisit later.
- **Recipe re-promotion** — if a v1 recipe is later found to also work great under v1.1 (or vice versa), is there a tool to clone it? No. Don't build. Real-world need first.
