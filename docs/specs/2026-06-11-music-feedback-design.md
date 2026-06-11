# Music feedback + 4-genre generation — design

Date: 2026-06-11 · Status: approved by Oliver (in-session) · Branch: `feat/music-feedback`

## Goal

1. Operators rate AI-generated music tracks with a one-tap feedback button; feedback feeds back into future generation prompts so output improves.
2. Every "Generate" in the delivery Music step produces **4 candidates — one per genre treatment** — instead of 1.

## What exists (reused, not rebuilt)

- `lib/providers/elevenlabs-music.ts` — `composeMusic(prompt, lengthMs)` + per-mood `MOOD_PROMPTS`, cost recorded to `cost_events`.
- `api/admin/studio/delivery/[runId].ts` — `generate_music` action: compose → upload to storage → insert `music_tracks` row (`source: 'elevenlabs_music'`, `prompt`, `mood_tag`) → library fallback on failure → `ml_event 'music_choice'`.
- `src/components/studio/DeliveryMusic.tsx` — track cards (preview, Select, AI badge), Generate button, fallback notice.
- Feedback-loop precedent: `prompt_lab_model_feedback` → `retrieveRecentModelFeedback` → `renderFeedbackBlock` injected into prompts.
- Migration 073 `genre` column on `music_tracks` (currently unused).

## Design

### A. Per-track feedback (👍/👎 + optional comment)

- **UI:** each track card in DeliveryMusic gets ThumbsUp/ThumbsDown icon buttons + an optional one-line comment input (revealed after a verdict is tapped; submit on Enter/blur). Verdict is instant (optimistic), comment upserts onto the same feedback row. CheckpointB's 5-star Music rating is unchanged (it rates the delivered video).
- **Storage:** new table `music_track_feedback` (migration 082):
  `id uuid pk, track_id uuid fk→music_tracks on delete cascade, run_id uuid fk→delivery_runs on delete set null, mood text, genre text, prompt text, verdict text check ('up','down'), comment text, created_at timestamptz default now()`; index `(mood, created_at desc)`. mood/genre/prompt denormalized from the track at write time.
- **API:** new `music_feedback` action on `POST /api/admin/studio/delivery/{runId}`: body `{ track_id, verdict: 'up'|'down', comment?: string }`. Inserts (or updates the same run+track row on repeat) → records `ml_event 'music_feedback'` (CHECK constraint extended in migration 082; `MlEventType` union updated) → **on 'down', sets `music_tracks.active = false` where `source = 'elevenlabs_music'`** (curated library tracks are never auto-deactivated). Returns `{ ok: true }`.
- **The improvement loop:** `generate_music` retrieves the latest 5 `music_track_feedback` rows for the run's mood and appends a block to every generation prompt:
  `OPERATOR FEEDBACK ON PREVIOUS TRACKS (apply these preferences): - [2026-06-11] disliked (orchestral): "too cheesy, heavy strings" …` (entries without comments render as `liked/disliked a <genre> track`). Pure function `buildFeedbackBlock(rows)` in `lib/providers/elevenlabs-music.ts`, unit-tested.

### B. 4 genre candidates per generation

- Shared genre set applied to any mood prompt, each a fragment appended to the mood's base prompt:
  1. `acoustic` — warm acoustic guitar + piano treatment
  2. `orchestral` — cinematic strings/orchestral treatment
  3. `ambient` — minimal ambient pads treatment
  4. `modern` — contemporary electronic-pop treatment
- `generate_music` fires 4 `composeMusic` calls in parallel (`Promise.allSettled`), one per genre; each success uploads + inserts its own `music_tracks` row with `genre` set and the **full final prompt** stored. Response becomes `{ tracks: TrackOption[], failures: number, fallback?, warning? }` where `TrackOption = { id, name, file_url, mood_tag, source, genre }`. Partial failure → return the successes (warning notes the count); all 4 fail → existing library-fallback path unchanged. Nothing is auto-selected; the operator previews and Selects one.
- UI: candidates render as a 4-card group labeled by genre. Cost ~25¢/track → ~$1 per Generate click; each call records its own `cost_event` (existing path).

## Error handling

- Feedback insert failure → non-blocking toast/inline error; UI verdict reverts.
- Deactivation failure → logged, doesn't block the feedback response.
- Generation partial failure → render what succeeded + amber count notice.

## Testing

- Unit: `buildFeedbackBlock` (empty/with/without comments), genre prompt assembly, feedback action handler (insert, repeat-upsert, down→deactivate AI-only), generate_music 4-up partial-failure shapes.
- Existing endpoint test files extended; full suite + tsc + vite build before ship.

## Prod gates

- Migration 082 (additive table + ml_events CHECK extension) — needs Oliver's prod approval at ship time.
