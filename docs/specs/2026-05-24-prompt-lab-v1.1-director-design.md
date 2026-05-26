# Prompt Lab v1.1 — Model picker + Director (Edit) + Assembly speed-ramp

**Date:** 2026-05-24
**Branch:** `feat/prompt-lab-v1.1-director` (off `main`)
**Status:** Draft for approval
**Predecessor:** `2026-05-23-prompt-lab-version-toggle-design.md` (v1/v1.1 toggle)

## Goal

Three additions on top of the v1/v1.1 toggle:

1. **Multi-model picker within v1.1** — under v1.1 sessions, the SKU dropdown comes back with a curated catalog (Seedance 2.0 default, Kling 3 Pro, Kling 2.6 Pro, Kling 2.0 Master, Runway gen4). The v1.1-defining behavior shifts from "Seedance only" → "modern model picker + speed-ramp polish on assembly + Director editor."

2. **Director (Edit) modal** — accessible from any v1.1 session. Lets the user pick rendered iterations from a library, drag-to-reorder them into a sequence, and hit Generate. Backend assembles a single MP4 with FFmpeg.

3. **Speed-ramp on assembly** — every clip in the assembled output gets the existing `applySpeedRamp` (0.5s head + tail at 0.8× speed) before concat. Subtle cinematic "breathe" between cuts.

Per Oliver's explicit scope: **ordering only.** No trimming, cropping, music, overlays, or aspect-ratio controls in this MVP. Those are deferrable.

## Non-goals (YAGNI)

- Per-clip trim / crop / extend.
- Music track or voiceover overlay.
- Text/address/branding overlays.
- Aspect ratio toggle (horizontal only — 1920×1080).
- Multiple parallel assemblies side-by-side (the screenshot's "Video 1 / Video 2 / Video 3" tabs).
- Director for v1 sessions (v1.1 only).
- Real-time preview before generate.

## Architecture

### 1. v1.1 SKU catalog — `src/lib/labModels.ts` + `lib/providers/router.ts`

New constant:

```ts
export const V1_1_LAB_SKUS = [
  'seedance-pro-pushin',   // default for v1.1
  'kling-v3-pro',
  'kling-v2-6-pro',
  'kling-v2-master',
  'runway-gen4-native',
] as const;
export type V1_1LabSku = typeof V1_1_LAB_SKUS[number];
```

(Easy to extend — adding Luma / Hunyuan / Wan later is a 1-line array push once Atlas SKU is verified.)

**Render override logic update** in `api/admin/prompt-lab/render.ts` + `rerender.ts`:
- When `session.pipeline_version === 'v1.1'`:
  - If user-supplied SKU is in `V1_1_LAB_SKUS` → use it.
  - Else → default to `seedance-pro-pushin`.
- The push-in prompt override + speed-ramp on download (Lane A's prior change) apply **only** when the selected SKU is `seedance-pro-pushin`. Other v1.1 SKUs render with the user's director prompt as-is, no movement override.

**UI** in `src/pages/dashboard/PromptLab.tsx`:
- Today: under v1.1, the SKU dropdown is hidden.
- Change: under v1.1, dropdown is **shown** but populated from `V1_1_LAB_SKUS`. Default = `seedance-pro-pushin`. Each option shows its label + price from `LAB_MODELS`.
- The "v1.1 push-in" note is **shown only when SKU is Seedance**; other v1.1 SKUs are normal renders with the chosen model.

### 2. Director modal — new `src/components/lab/DirectorModal.tsx`

**Trigger**: a "🎬 Direct" button on every v1.1 session-detail header (next to existing Generate-All button).

**Layout** (single `<Dialog>` from shadcn, fills 90vw × 90vh):

```
┌──────────────────────────────────────────────────────────────┐
│  Direct video — [session name]                          ✕    │
├─────────────────────┬─────────────────────────────────────────┤
│  LIBRARY            │  SEQUENCE                              │
│  ┌───┐ ┌───┐ ┌───┐  │  ┌──────┐ ┌──────┐ ┌──────┐           │
│  │ 1 │ │ 2 │ │ 3 │  │  │  1   │ │  2   │ │  3   │   …       │
│  └───┘ └───┘ └───┘  │  └──────┘ └──────┘ └──────┘           │
│  ┌───┐ ┌───┐        │   ↳ drag to reorder, X to remove       │
│  │ 4 │ │ 5 │        │                                        │
│  └───┘ └───┘        │   Total: 3 clips · ~15s                │
│                     │                                        │
│  (click to add →)   │   [ Generate ]   [Status: idle]        │
└─────────────────────┴─────────────────────────────────────────┘
│  ▼ Output                                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              <video> player when complete            │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Library panel** (left):
- Lists every iteration in this session with `clip_url != null`.
- Each card: 96×54 thumbnail (poster image extracted from the first frame of the clip via `<video poster>` or just the source photo), iteration number, SKU, rating (if any), duration.
- Click adds the iteration to the end of the sequence. Adding the same iteration twice is allowed (you can repeat a clip).

**Sequence panel** (right):
- `<Reorder.Group axis="x">` from `framer-motion` (already installed).
- Each `<Reorder.Item>`: 96×54 thumbnail + iteration number + ✕ button.
- Drag-handle is the whole card.
- Total clip count + sum of durations shown below.

**Footer**:
- `Generate` button (disabled when sequence is empty or assembly in flight).
- Status line: `Idle` | `Assembling… (N/M clips processed)` | `Complete` | `Failed: <error>`.

**Output**:
- When assembly completes, native `<video controls>` plays the result inline below the sequence.
- The assembled URL also persists in `prompt_lab_assemblies` so reopening the modal later shows the most recent assembly's video at the bottom.

### 3. Backend — `api/admin/prompt-lab/assemble.ts` (NEW)

Endpoint: `POST /api/admin/prompt-lab/assemble`
Body: `{ session_id: string, iteration_ids: string[] }` (ordered)

Flow:
1. Auth gate (admin only — same gate as other lab endpoints).
2. Validate: session exists, every `iteration_id` belongs to that session, every iteration has a `clip_url`.
3. Insert `prompt_lab_assemblies` row with `status='assembling'`.
4. For each `iteration_id` (in order):
   a. `fetch(clip_url)` → temp file.
   b. `applySpeedRamp(tempIn, tempOut, { rampSeconds: 0.5, rampFactor: 0.8 })`.
   c. On ramp failure (clip too short, ffmpeg error): log warn, fall back to raw clip for that segment.
5. Build a concat list file `concat.txt`, run `ffmpeg -f concat -safe 0 -i concat.txt -c copy -y assembled.mp4` (stream copy — fast, no re-encode, lossless since all segments share the same codec from the ramp pass). If stream copy fails because segment codecs differ, re-encode with libx264.
6. Upload to `property-videos/lab/<session_id>/assembled/<timestamp>.mp4`.
7. Update `prompt_lab_assemblies`: `status='complete'`, `assembled_url=…`, `duration_seconds=…`, `completed_at=NOW()`.
8. Return `{ id, assembled_url, duration_seconds }`.

On any failure: update row to `status='failed', error=<msg>` and return 500 with the error.

Synchronous (~5-30s for typical 3-10 clip sessions, well under Vercel's 300s ceiling). No cron / no background polling for v1 — keep simple.

### 4. DB — migration 068 — `prompt_lab_assemblies`

```sql
CREATE TABLE IF NOT EXISTS prompt_lab_assemblies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES prompt_lab_sessions(id) ON DELETE CASCADE,
  iteration_order UUID[] NOT NULL,
  assembled_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  duration_seconds NUMERIC,
  pipeline_version TEXT NOT NULL DEFAULT 'v1.1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (status IN ('queued', 'assembling', 'complete', 'failed')),
  CHECK (pipeline_version IN ('v1', 'v1.1'))
);
CREATE INDEX idx_prompt_lab_assemblies_session ON prompt_lab_assemblies (session_id, created_at DESC);
```

Stays for v1.1 specifically (per `pipeline_version`); future v1 director use would add `'v1'` to the default. Default `'v1.1'` because v1 doesn't have an editor.

### 5. Speed-ramp on assembly

Implementation lives inside the `assemble.ts` flow (step 4b above), reusing `applySpeedRamp` from `lib/utils/ffmpeg.ts`. **No double-ramp concern** for Seedance Lab clips:
- Lane A's prior wiring already ramps Seedance Lab clips on cron download → the stored `clip_url` points at a ramped version.
- Assembly applies ramp again per segment → segments get a SECOND ramp (0.8 × 0.8 = 0.64× at the edges).
- For other v1.1 SKUs (Kling 3, etc.), no prior ramp → assembly is the first and only ramp.

**Decision**: accept the double-ramp on Seedance assembled output. The compounded effect is "even more cinematic" and only affects 0.5s at each cut — still subtle. If it ends up too dramatic in practice, we add a per-clip "already-ramped" flag in `prompt_lab_iterations` and skip the second pass. **Don't pre-build that gate** — measure first.

### 6. Files touched

| Path | Reason |
|---|---|
| `supabase/migrations/068_prompt_lab_assemblies.sql` | NEW |
| `src/lib/labModels.ts` | NEW `V1_1_LAB_SKUS` constant + lookup |
| `api/admin/prompt-lab/render.ts` | only-force-Seedance-when-user-picked-Seedance gate |
| `api/admin/prompt-lab/rerender.ts` | same |
| `lib/prompt-lab.ts::submitLabRender` | gate the push-in prompt override on `sku === 'seedance-pro-pushin'` (not just on `pipelineVersion === 'v1.1'`) |
| `api/cron/poll-lab-renders.ts` | gate the speed-ramp on download on `sku === 'seedance-pro-pushin'` (not just on `pipelineVersion === 'v1.1'`) |
| `api/admin/prompt-lab/assemble.ts` | NEW endpoint |
| `src/components/lab/DirectorModal.tsx` | NEW component |
| `src/pages/dashboard/PromptLab.tsx` | mount Director button + modal on v1.1 SessionDetail; un-hide SKU dropdown under v1.1 with V1_1_LAB_SKUS catalog |
| `src/components/lab/IterationCard.tsx` | undo the "hide SKU dropdown under v1.1" — show dropdown but with v1.1 catalog when applicable |
| `src/lib/promptLabApi.ts` | new `assembleLab(sessionId, iterationIds)` client + `listAssemblies(sessionId)` |
| `lib/types.ts` | `PromptLabAssembly` interface |
| `docs/HANDOFF.md` | new "Right now" entry |

### 7. Test plan

- `api/admin/prompt-lab/__tests__/assemble.test.ts` — validates body shape, returns 400 on missing iteration, 200 on success (mock supabase + ffmpeg, no real network).
- `lib/utils/__tests__/ffmpeg.concat.test.ts` (extend existing speed-ramp test) — given 3 fixture clips, produce a single concat output and assert duration ≈ sum of segment durations (within 0.5s).
- `lib/prompt-lab.test.ts` — `submitLabRender` no longer forces Seedance prompt override when SKU is `kling-v3-pro` under v1.1.

### 8. Out of scope (explicit)

- Per-clip trim/crop/extend.
- Music or voiceover.
- Text overlays (address, brokerage, etc.).
- Vertical (9:16) assembly. Add later via duplicate render pass.
- Editing in v1 sessions.
- Multiple parallel assemblies side-by-side.

## Open questions (none blocking)

- Should the Director button also appear on v1 sessions in read-only mode (so you can assemble a sequence from existing v1 iterations)? Not for MVP — v1.1 only. Easy to extend.
- Should assembled MP4s show up in `cost_events` (CPU cost only)? Skip — FFmpeg is local, $0.
