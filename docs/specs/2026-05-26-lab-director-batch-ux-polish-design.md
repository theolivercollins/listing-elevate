# Listings Lab Director (batch) + PromptLab UX polish

**Date:** 2026-05-26
**Branch:** `feat/lab-batch-director-ux-polish` (off `main`)
**Status:** Draft for approval

## Goals

### A — Listings Lab Director (batch)
The Director (Edit) modal exists today only in the Sessions Lab (`/dashboard/development/prompt-lab/...`). Add the same capability to the Listings Lab (`/dashboard/lab-listings/...`) so an operator can direct a property's batch — pick rendered iterations across all scenes in the listing, drag to reorder, press Generate, see the assembled output.

### B — PromptLab UX polish
Three rough edges in the v1/v1.1 toggle flow today:

1. **Defaults to v1 every visit.** No memory of last selection. User wants their last-chosen version sticky across visits.
2. **Version toggle scrolls off-screen.** Has to scroll down past the sub-nav (Prompts / Recipes / Proposals / Ratings / Ledger / Learning) to find it. Should sit alongside or above the sub-nav so it's always visible.
3. **Back button from a session loses the version.** Click into a v1.1 session, hit back → lands on v1 SessionList. Detail URLs don't carry the `?v=v1.1` param.

## Non-goals (YAGNI)

- Per-listing "best clip per scene" auto-selection. Operator picks manually.
- Director for v1 sessions. v1.1 only (matches existing Director scope).
- New table for listing assemblies if `prompt_lab_assemblies` can be widened cheaply — actually, we'll add a sibling `prompt_lab_listing_assemblies` instead, since polymorphic FKs are messier than two clean tables.
- Drag-to-reorder of scenes within a listing's render pipeline. The Director's reorder is for the assembled-output sequence only.

## Architecture

### A.1 — DB: migration 071 (`prompt_lab_listing_assemblies`)

Sibling of `prompt_lab_assemblies`. Same shape, different FK.

```sql
CREATE TABLE prompt_lab_listing_assemblies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES prompt_lab_listings(id) ON DELETE CASCADE,
  iteration_order UUID[] NOT NULL,  -- ids from prompt_lab_listing_scene_iterations
  assembled_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  duration_seconds NUMERIC,
  pipeline_version TEXT NOT NULL DEFAULT 'v1.1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT plla_status_check CHECK (status IN ('queued','assembling','complete','failed')),
  CONSTRAINT plla_pipeline_version_check CHECK (pipeline_version IN ('v1','v1.1'))
);
CREATE INDEX idx_plla_listing ON prompt_lab_listing_assemblies (listing_id, created_at DESC);
```

### A.2 — Endpoint: `POST /api/admin/prompt-lab/assemble-listing`

Body: `{ listing_id, iteration_ids: string[] }`

Flow (mirrors `assemble.ts` exactly, just substitute table names):
1. Auth (admin).
2. Validate: listing exists, every iteration_id belongs to that listing's scenes (`JOIN prompt_lab_listing_scenes`), every iteration has a non-null `clip_url`.
3. Insert assembly row with `status='assembling'`, `iteration_order=ids`, `pipeline_version` inherited from listing.
4. For each id: download `clip_url`, apply `applySpeedRamp` (skip on failure → use raw), collect segment paths.
5. `concatClips` → upload to `property-videos/lab-listing/<listing_id>/assembled/<assemblyId>.mp4`.
6. Update row → complete. Return `{ id, assembled_url, duration_seconds }`.

`GET /api/admin/prompt-lab/listing-assemblies?listing_id=<>` for history.

### A.3 — UI: mount DirectorModal in `LabListingDetail.tsx`

`DirectorModal` already accepts an abstract iteration list. Generalize its props slightly:

```ts
interface DirectorModalProps {
  source: { kind: 'session'; sessionId: string } | { kind: 'listing'; listingId: string };
  open: boolean;
  onClose: () => void;
}
```

Internally, the modal switches data-fetching and POST endpoint based on `source.kind`. Library panel shows iterations from either `prompt_lab_iterations` or `prompt_lab_listing_scene_iterations` (extra column: scene number, so it's easy to identify "the kitchen shot iteration 3").

`LabListingDetail.tsx` gets a "🎬 Direct" button on the header, mirrors PromptLab's pattern.

### B.1 — PromptLab version persistence

`src/pages/dashboard/PromptLab.tsx` already reads `?v=` from `useSearchParams`. New behavior:

- On root mount (`/dashboard/development/prompt-lab` with no `?v=` param): read `localStorage.getItem('lab.pipelineVersion')`, default `'v1.1'` (better default — most active work is here). Replace URL with the saved value (via `setSearchParams({ v: <saved> }, { replace: true })`).
- When user toggles the version control: write to localStorage.

### B.2 — Sticky version toggle

The toggle currently lives in the SessionList region. Move it to sit ALONGSIDE the existing sub-nav (Prompts/Recipes/Proposals/etc.) as a right-aligned segmented control in the same sticky row. That way it's always visible alongside the other Lab nav.

If the sub-nav is in a separate component (`LabSubNav` per docs), the toggle goes into the same `<div>` as a flex right-aligned child. If they're not currently in a shared container, wrap them.

### B.3 — Back-button correctness

Every `navigate('/dashboard/development/prompt-lab/${id}')` in PromptLab.tsx (12 call sites) becomes `navigate(\`/dashboard/development/prompt-lab/${id}?v=${currentVersion}\`)`. The session-detail header's back button (line 1394) becomes `navigate(\`/dashboard/development/prompt-lab?v=${sessionVersion}\`)` — using the SESSION's own `pipeline_version` (so the SessionList opens to the right tab).

Easier helper: a `versionedPath(id?)` function used everywhere so we don't repeat the param-append.

## Files touched

| Path | Reason |
|---|---|
| NEW `supabase/migrations/071_prompt_lab_listing_assemblies.sql` | sibling assembly table |
| NEW `api/admin/prompt-lab/assemble-listing.ts` | POST endpoint |
| NEW `api/admin/prompt-lab/listing-assemblies.ts` | GET endpoint |
| `src/components/lab/DirectorModal.tsx` | source-kind prop; dual-fetch + dual-POST |
| `src/pages/dashboard/LabListingDetail.tsx` | mount DirectorModal + "🎬 Direct" button |
| `src/lib/promptLabApi.ts` | `assembleListing`, `listListingAssemblies` clients |
| `lib/types.ts` | `PromptLabListingAssembly` interface |
| `src/pages/dashboard/PromptLab.tsx` | localStorage version persistence, all navigate() preserve `?v=`, sticky toggle (move into sub-nav row) |

## Test plan

- `api/admin/prompt-lab/__tests__/assemble-listing.test.ts` — mirror of `assemble.test.ts`. Happy path + 3 validation cases + 2 failure cases.
- Manual: load `/dashboard/development/prompt-lab`, expect URL to reflect last-saved version. Click into a v1.1 session, hit back, expect to land back on v1.1. Toggle to v1 → reload → URL has `?v=v1`.
- Manual: load LabListingDetail for a property with rendered iterations, click 🎬 Direct, build a sequence, Generate → assembled MP4 plays.

## Out of scope (explicit)

- Per-scene rating UI in the listings director.
- Cross-version assemblies (mixing v1 and v1.1 iterations in one output).
- Vertical (9:16) assembled output for listings.
