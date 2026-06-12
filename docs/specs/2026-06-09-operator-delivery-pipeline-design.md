# Operator Studio: Client Fix + Multi-Checkpoint Delivery Pipeline

**Date:** 2026-06-09 · **Branch:** `feat/operator-delivery` (off main) · **Status:** Approved by Oliver

## Goal

Two workstreams for Operator Studio (admin surface, `order_mode='operator'`):

1. **Client fix** — make client selection work again, enrich the client editor with Creatomate-aware fields.
2. **Delivery pipeline** — a stage-machine-driven flow: intake → Redfin scrape → A/B clip generation → Gemini judging → checkpoint A (operator review) → overlay details → Sonnet voiceover → voice + music selection → Creatomate assembly → checkpoint B (ratings + parsed feedback). Every operator action captured as ML training data.

Customer flow stays byte-identical. Every new path gates on `order_mode='operator'` / `client_id IS NOT NULL`.

## Decisions (locked with Oliver 2026-06-09)

- **A/B on every scene** (his call; ~2× gen cost ≈ +$0.80–1.00/video, accepted for clean pairwise ML data)
- **Redfin scrape at intake**, editable later; missing listing → manual entry, never a blocker
- **Stepper UI inside Property Command Center** (`/dashboard/studio/properties/:id`), not a new wizard route
- **Music library-first** (3 genre options from `music_tracks`) + on-demand "Generate new" via ElevenLabs

## Workstream 1 — Client fix

### Bug
`clients` row for Brian Helgemo exists, unarchived (verified live 2026-06-09: id `5321897b-…`, phone, headshot, `voice_id` all set). `listClients()` has no hidden filters. Therefore the empty picker is a fetch/auth/route failure swallowed by `ClientPicker.tsx` (`d.clients ?? []` renders errors as an empty list). Suspects: studio API route or `requireAdmin()` regression after the dashboard rebuild / UI-pass merges (note prior `fix-vercel-routes-studio-404` worktree).

**Fix:** reproduce against the live preview, fix root cause, AND add visible error + retry state to ClientPicker so auth/route failures can never masquerade as "no clients."

### Schema (migration 079)
- Add `clients.brokerage text`. Brand-kit injection (`lib/operator-studio/brand-kit.ts`) prefers `clients.brokerage`, falls back to `properties.brokerage`.
- No new display-name column: `clients.agent_name` IS the display name; relabel in UI as "Display name (shown on videos)".
- **Addendum (2026-06-10, `fix/operator-feedback-2`):** migration **081** adds `clients.realtor_suffix boolean` — per-client ", Realtor" display-name toggle (checkbox in ClientEdit). `applyRealtorSuffix()` in `brand-kit.ts` appends the suffix wherever the agent name reaches a template: `Brand.agent_name`, `Text-Agent-Name.text`, `Listing-Agent-Mid/Final.text`. Migration NOT yet applied to prod.

### Phone auto-format
- Normalize to digits-only on save (`lib/utils/phone.ts`, pure, unit-tested).
- Render `(941) 205-9011` in editor (format-as-you-type), Command Center, and Creatomate `Brand.phone` modification (new key in `BRAND_KEY_MAP`).

### Creatomate field-seeking
Client editor calls existing `creatomate.getTemplate()` (already returns `elements[].dynamic`) for configured template env IDs and renders a template-coverage panel: green = template consumes key and client has value; amber = template wants it, client missing it; gray = client has it, no template placeholder (surfaces the known missing-`Brand.*`-placeholder gap).

## Workstream 2 — Delivery pipeline

### Data model (migration 080)

**`delivery_runs`** — one row per delivery. `property_id`, `client_id`, `video_type enum('just_listed','just_pended','just_closed')`, `duration_seconds`, `stage enum('intake','scraping','generating','judging','checkpoint_a','details','voiceover','music','assembling','checkpoint_b','delivered')`, `listing_details jsonb` (price, beds, baths, sqft, mls_description, source: scraped|manual), `voiceover_script text`, `voiceover_voice_id text`, `music_track_id`, `error text`, timestamps. Stage transitions only via `lib/delivery/state.ts` (pure, unit-tested). Resumable from any stage.

**`scene_variants`** — `scene_id`, `variant char('A'|'B')`, clip url/provider/cost, `gemini_scores jsonb`, `winner bool`, `winner_source enum('gemini','operator','default')` — `'gemini'` only for pairs Gemini actually judged; `'operator'` for checkpoint-A flips; `'default'` for unjudged auto-wins (degraded pair or judge failure), with `gemini_scores = {"judge_error": ...}` on the winning row so ML excludes them. Variant B failure → degrade to single-clip, flagged `degraded=true`.

**`ml_events`** — `run_id`, `event_type enum('reorder','regenerate','variant_override','script_edit','voice_choice','music_choice','rating','comment','details_edit')`, `payload jsonb`, `created_at`. The ML training corpus.

RLS: same service-role-only posture as the other operator tables (migration 062 pattern).

### Stages

1. **Intake** — `/dashboard/studio/new` gains video-type selector (duration selector exists). On create: delivery_run inserted, Redfin scrape (`lib/mls/scrape-redfin.ts`, existing `tri_angle/redfin-detail` actor) fires async. Hit → `listing_details` populated, `source='scraped'`. Miss → amber manual-entry state.
2. **Generate** — existing analysis + director run unchanged; generation fires **two independent provider runs per scene** (same prompt; Kling output variance differentiates). Both variants → `scene_variants`.
3. **Judge** — Gemini judge (reuse `lib/providers/gemini-judge.ts` patterns; clips uploaded via the Gemini Files API — HTTPS fileUri passthrough is unsupported on the Developer API) scores each A/B pair (motion quality, artifacts, realism, composition) → sets `winner`, `winner_source='gemini'`. Degraded pairs and judge failures auto-win with `winner_source='default'` + `gemini_scores.judge_error` (never recorded as a Gemini verdict). Draft order via existing `orderScenesForAssembly()`.
4. **Checkpoint A** — stepper in Command Center: drag-reorder draft order, regenerate a scene, flip A↔B. Every action → `ml_events`.
5. **Details** — overlay fields pre-filled from `listing_details`; operator verifies/edits; edits logged.
6. **Voiceover** — Sonnet 4.6 writes script from MLS description + details + video type (extend `lib/voiceover/`). Editable textarea (edits → `ml_events.script_edit` with before/after). Voice options: ElevenLabs V3 roster + client `voice_id` when set (badged "Client voice"). Audio generated on selection.
   - **Addendum (2026-06-10, `fix/operator-feedback-2`):** word-budget trimming is now sentence-aware (no mid-sentence cutoffs); scripts may not open with "Welcome to"/"Step inside" (prompt constraint in both generators); and a **duration audit** runs after TTS — real MP3 duration measured (`estimateMp3DurationMs`, CBR 128kbps), and if audio exceeds `duration_seconds`+1s, Sonnet auto-shortens the script (max 2 passes; `cost_events` + `ml_events` `script_edit/auto_shorten` recorded), persisting the final script+audio together and surfacing `duration_warning` in the UI. A failed shorten keeps the last good audio (no wasted TTS spend).
7. **Music** — 3 genre options library-first from `music_tracks`; "Generate new" button → `lib/providers/elevenlabs-music.ts`, new track joins library. Choice → `ml_events`.
8. **Assemble** — existing Creatomate template path: brand kit + overlay details + voiceover + music. Reuse `rerunAssembly()` plumbing.
9. **Checkpoint B** — four 1–5 ratings (overall, music, voiceover, script) + freeform comment. Haiku parses comment → structured tags (`pacing`, `voice_tone`, `clip_quality`, `music_fit`, `script_style`, `other`) stored with raw text in `ml_events.rating`/`comment`. Then `delivered`.

### Error handling
- Each stage writes `error` to the run; UI shows retry per stage; no stage failure dead-ends a run.
- Redfin miss → manual entry. One A/B variant fails → single clip, flagged. ElevenLabs failure → retry once, then skip-with-flag (assembly proceeds without VO/music rather than blocking).

### Cost tracking (first-class)
Every new call writes `cost_events` with `metadata.delivery_run_id`: 2× clip generation, Gemini judge, Sonnet script, Haiku comment-parse, ElevenLabs VO + music. Command Center cost panel gains per-run breakdown.

### Testing
- Unit: state transitions, judge winner selection, phone formatter, comment parser, music selection, variant degradation.
- Smoke scripts: Redfin scrape one address; Creatomate render with Brand.phone.
- `vite build` before every push (tsc misses PostCSS/Tailwind errors — known trap).
- Baseline note: 1 pre-existing failure on main (`MarketComparison` copy test) — not ours.

### Out of scope
ML model training itself (we only collect), customer-flow exposure of any feature, Creatomate template placeholder authoring (manual dashboard step, surfaced by coverage panel), the Apify `listing-intelligence` views-tracker fix (separate concern).
