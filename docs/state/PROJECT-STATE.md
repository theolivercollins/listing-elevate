# Listing Elevate — Project State (Handoff)

See also:
- [../HANDOFF.md](../HANDOFF.md) — right-now state + recent shipping log (READ FIRST on cold entry)
- [STACK.md](./STACK.md) — tech inventory
- [TODO.md](./TODO.md) — active backlog
- [../plans/back-on-track-plan.md](../plans/back-on-track-plan.md) — active roadmap
- [../specs/2026-04-20-back-on-track-design.md](../specs/2026-04-20-back-on-track-design.md) — full roadmap spec

Last updated: **2026-04-21 (DA.1 merged to main)** — Phases A (Lab UX spine), M.1 (director-prompt trace audit), DQ (director concise prompts), DM (dev/legacy merge), CI.1–CI.5 (cost integrity), C (prod end-to-end), and M.2 (ML consolidation) all shipped. **DA.1 Gemini-eyes** merged to main 2026-04-21 — director now receives `motion_headroom` booleans per photo and hard-bans geometrically impossible camera moves. Phase 2.8 listings Lab previously shipped: Atlas Cloud + 6 Kling SKUs, multi-photo listings, scene-level master-detail UI, streaming scene chat with Haiku 4.5 + rewrite tool, end-frame pairing, scene + iteration archive, rating reasons taxonomy, generate-all-models + side-by-side compare, recipe retrieval restored in listings director.

Authoritative state doc. Read first when entering the repo. If anything here conflicts with the code, trust the code and update this doc.

---

## 2026-04-21 — DA.1 Gemini-eyes (merged to main)

Merged 2026-04-21 via consolidation of `session/da1-land-2026-04-21` (6 commits).

**Goal:** fix director hallucinations (top_down on already-aerial shots, orbit on dense interiors, etc.) by introducing a Gemini 3 Flash per-photo analyzer that emits `motion_headroom` booleans, and wiring the director to respect them as HARD BANS.

| Item | Detail |
|---|---|
| Analyzer | `lib/providers/gemini-analyzer.ts` — `analyzePhotoWithGemini(imageUrl)` → `ExtendedPhotoAnalysis`. Gemini 3 Flash primary, gemini-2.5-flash fallback on model-not-found. Emits: `motion_headroom` (push_in / pull_out / orbit / parallax / drone_push_in / top_down), `motion_headroom_rationale`, `camera_height`, `camera_tilt`, `frame_coverage`, plus existing PhotoAnalysisResult fields 1:1. Inline base64 image input. ~0.25¢/photo at Gemini 3 Flash pricing. |
| Migration 030 | `photos.analysis_json jsonb` + `photos.analysis_provider text`. Typed columns (`room_type`, `aesthetic_score`, etc.) still populated for ergonomic queries. Applied to dev Supabase `vrhmaeywqsohlztoouxu` 2026-04-21. |
| Prod pipeline | `lib/pipeline.ts::runAnalysis` runs Gemini per-photo in parallel. Claude Sonnet 4.6 batched as fallback (cost_event `scope='prod_photo_eyes_fallback'`). `runScripting` surfaces camera-state to director. |
| Lab pipeline | `lib/prompt-lab-listings.ts::analyzeListingPhotos` mirror of prod. Exports `mapCameraMovementToHeadroomKey()` for the DA.3 validator. |
| Director (DA.2) | `lib/prompts/director.ts` — `DIRECTOR_SYSTEM` adds "HARD MOVEMENT BANS FROM MOTION HEADROOM" section mapping each `camera_movement` verb to the `motion_headroom` key it requires; don't-do examples; `feature_closeup` fallback. `buildDirectorUserPrompt` renders `camera_height` / `camera_tilt` / `frame_coverage` / `motion_headroom` / `motion_headroom_rationale` per photo row. |
| Validator (DA.3) | After the director returns JSON, a deterministic validator in both `runScripting` (prod) and `directListingScenes` (Lab) checks each scene's `camera_movement` against the source photo's `motion_headroom`. Violations are overridden to `suggested_motion` if in-headroom, else `feature_closeup`. No re-prompt round-trip. Violation count logged. |
| Cost tracking | New `provider='google'` in `recordCostEvent` enum. Per-photo cost_event written on both Gemini path (`scope='prod_photo_eyes'` / `'lab_listing_photo_eyes'`) and Claude-fallback path (`scope='..._fallback'` + `gemini_error` metadata). Reconciliation line added to `scripts/cost-reconcile.ts`. |
| Tests | `scripts/test-gemini-analyzer.ts` (one-photo probe; verified on aerial + bathroom — bathroom correctly `orbit=F drone_push_in=F`). `scripts/test-gemini-director-e2e.ts` (3 photos → Gemini → `buildDirectorUserPrompt`; all 5 new fields present in assembled prompt; transcript to `/tmp/director-prompt-e2e-*.md`). No renders executed. |
| Known gaps (not blocking landing) | (1) `mapCameraMovementToHeadroomKey('drone_push_in')` returns only `drone_push_in`, not both `push_in` and `drone_push_in` — edge case where `push_in=false, drone_push_in=true` photo would slip past validator. (2) SDK warns when both `GEMINI_API_KEY` and `GOOGLE_API_KEY` are set; harmless. (3) Gemini marks non-overhead aerials `top_down=true` (can rise further to overhead) — semantically correct per system prompt wording; may want stricter tuning. |

---

## 2026-04-20 — Back-on-track execution

Spec: `docs/superpowers/specs/2026-04-20-back-on-track-design.md`. Five phases shipped in one day on branch `feature/back-on-track`, merged to `main`.

### Phase A — Lab UX "next-action spine"

| Item | Detail |
|---|---|
| `NextActionBanner` | Colored per state; one-click advances the next stuck scene (commits: `14bdfed`, `858577c`) |
| Per-scene status chips in `ShotPlanTable` | `needs_rating / failed / iterating / needs_first_render / rendering / done / archived`; rows priority-sorted |
| Pure resolvers | `src/lib/labSceneStatus.ts` + `src/lib/labNextAction.ts`; 17 unit tests (`d6c57a0`) |
| Optimistic mutations | Rate + scene-archive mutations in `LabListingDetail.tsx` (`7818cfd`, `9995657`) |
| `SceneCard` | Added `data-scene-id` for scroll-to behavior |
| Resolver patch | "iterating" triggers when all iterations are rated but none hit 4★+ (vs falling through to needs_rating) |
| Done color | Changed from emerald → slate (grey) to distinguish from teal "rate" action |

### Phase M.1 — Director-prompt trace audit

New scripts: `scripts/trace-director-prompt.ts` + `scripts/trace-director-prompt.impl.ts`

- Reconstructs the director's user message for any listing or property
- Runs retrieval RPCs live; writes transcript + audit checklist to `/tmp/director-trace-<id>.md`

**Verdict: WORKING WITH GAPS**

| Finding | Detail |
|---|---|
| Learning chain | Rating → embedding → retrieval → director-injection is wired end-to-end |
| Rated legacy Lab iterations | 108 actively feeding retrieval |
| Lab→prod promotion | NEVER used — 0 overrides ever promoted |
| Prod scene embeddings | 7/24 populated (partial) |

Full report: `docs/ML-AUDIT-2026-04-20.md`. Raw traces: `docs/traces/`.

### Phase DQ — Director concise prompts

| Item | Detail |
|---|---|
| `DIRECTOR_SYSTEM` rewrite | New PROMPT STYLE section: ≤120 chars single-image, ≤250 paired, single-sentence. Banned phrases: "Motion is fluid", "Emphasize X", "Camera moves steadily…", em-dash trajectories, trailing qualifiers. Legacy 5★ examples as patterns. Guardrail: "exemplars are CONTENT patterns not LENGTH permission". |
| `CAMERA_STABILITY_PREFIX` | Now gated to `kling-v3-*` only. v2.x and o3 no longer receive 180 chars of fluff; Atlas `negative_prompt` still carries shake mitigation. |
| Paired-scene auto-routing | `scene.use_end_frame && end_image_url` auto-routes to `kling-v2-1-pair` unless caller explicitly picks models via `body.models[]` (Compare flow). |
| Default model | Changed `kling-v3-pro` → `kling-v2-6-pro` for new listings. |
| `lib/refine-prompt.ts` | New helper; uses Sonnet 4.6 to rewrite `scene.director_prompt` incorporating `refinement_notes`, replacing the previous raw `ADDITIONAL USER DIRECTIVES…` concat at render time. |

### Phase DM — Dev / Legacy merge

| Item | Detail |
|---|---|
| `lib/sanitize-prompt.ts` | Strips `LOCKED-OFF CAMERA…` variants from any prompt string. Called on every `update_director_prompt` tool write AND at render time. |
| Scene Editor system prompt | Haiku 4.5 now carries same PROMPT STYLE rules as DQ.1 (char limits, banned phrases, GOOD/BAD examples, "DO NOT include LOCKED-OFF CAMERA"). |
| UI demotions | "Compare models" → `More ▾` dropdown on SceneCard. Submit has `window.confirm()` with dollar total. Primary Render button shows SKU + cost inline (e.g. `Render v2.6 Pro $0.60`). "Render all" shows true multi-SKU total. |
| Native Kling added | `kling-v2-native` added to model registry — first in picker. Routes via `lib/providers/kling.ts` using Oliver's pre-paid credits. On 402/credit-exhaustion auto-failovers to Atlas `kling-v2-master`. Cost events logged with `provider='kling', billing='prepaid_credits'`. |
| `lib/providers/dispatch.ts` | New — `pickProvider(modelKey)` + `isNativeKling(modelKey)`. |
| Legacy Lab UI retired | `/dashboard/development/prompt-lab/*` redirects to `/dashboard/development/lab`. `PromptLab.tsx` + `PromptLabRecipes.tsx` dead code (not imported). Data preserved — legacy tables still feed retrieval. |

### Phase CI — Cost Integrity (CI.1–CI.4 shipped; CI.5 pending)

| Sub-phase | What shipped |
|---|---|
| **CI.1** Claude model-aware pricing | `computeClaudeCost(usage, model)` — rate tables for Opus 4.x / Sonnet 4.x / Haiku 4.5. All call sites now pass model. Scene chat, iteration chat, rule mining, listings director, refine-prompt all log `cost_events`. Haiku 4.5 no longer billed at Sonnet rates. |
| **CI.2** OpenAI embedding tracking | `embedText` returns `usage: { totalTokens, costCents }`. 5 call sites now log `cost_events` with `provider='openai', unit_type='tokens', stage='embedding'`. |
| **CI.3** Shotstack per-minute pricing | `shotstackCostCents(durationSeconds)` = `ceil(minutes) × SHOTSTACK_CENTS_PER_MINUTE` (default 20¢/min). Replaces flat `SHOTSTACK_CENTS_PER_RENDER=10`. Uses API-returned duration; falls back to summed clip durations. |
| **CI.4** Failed-render cost policy | Atlas failed renders log full SKU cost with `metadata.render_outcome='failed'` (over-attribute; reconcile vs invoice). Native Kling failed renders log $0 with `metadata.billing='prepaid_credits_failed_refunded'`. |
| **Atlas v2.6-pro pricing correction** | Observed bill $0.60/clip (was estimated $0.30). `ATLAS_MODELS` updated: `priceCentsPerSecond: 12, priceCentsPerClip: 60`. 12 historical rows backfilled. Listing `dd552c89` now shows $30.20 (was $4.80). |
| **`scripts/cost-reconcile.ts`** | Dumps `cost_events` + iteration costs by provider/SKU for a date range. Run weekly. Output to `/tmp/cost-reconcile-*.md`. |
| **Bug: Atlas cost two compounding bugs** | (1) `checkStatus` returned default model's price regardless of SKU; (2) `priceCentsPerClip` was set to per-second rate. Both fixed (commit `124adfc`). |

**Cost-tracking first-class directive**: every API call logs `cost_events` (even $0 ones). No null/0 cost fields on finalized renders. Saved to memory at `feedback_cost_tracking_first_class.md`.

### New helper libs / scripts added 2026-04-20

| File | Purpose |
|---|---|
| `lib/sanitize-prompt.ts` | Strip `LOCKED-OFF CAMERA…` stability prefix variants |
| `lib/refine-prompt.ts` | Sonnet 4.6 prompt rewrite at render time incorporating refinement_notes |
| `lib/providers/dispatch.ts` | `pickProvider(modelKey)` + `isNativeKling(modelKey)` |
| `scripts/trace-director-prompt.ts` | CLI entry point for director-prompt trace audit |
| `scripts/trace-director-prompt.impl.ts` | Implementation: retrieval RPCs, transcript + audit checklist writer |
| `scripts/cost-reconcile.ts` | Cost reconciliation dump by provider/SKU for a date range |

---

## Product

**Listing Elevate** is a real estate AI video automation pipeline. Agents upload 10–60 property photos; the system produces cinematic walkthrough clips via Claude vision analysis + shot planning + multi-provider generation (Kling / Runway / Luma). Individual clips are the deliverable today; Shotstack assembly is wired in and active when `SHOTSTACK_API_KEY` is set.

- **Live URL:** `https://www.listingelevate.com` (Vercel custom domain)
- **Legacy URLs:** `reelready-eight.vercel.app` (works), historic: Real Estate Pipeline, ReelReady, Key Frame
- **Repo:** `theolivercollins/reelready` on GitHub (rename pending, doesn't block)
- **Local path:** `/Users/oliverhelgemo/real-estate-pipeline`
- **Primary user:** Oliver (`oliver@recasi.com`, `user_profiles.role='admin'`). Sole admin. Agent signup via magic link exists; no approval gate yet.

## Communication preferences

Oliver wants plain language, bottom-line answers, no jargon, direct action. Things flagged as annoying:
- Long responses with headers and bullet lists when a sentence would do
- Presenting A/B/C options when one has a clear vote
- Restating a plan before executing it
- Emotional adjectives in status updates
- Asking "do you want me to…" when he already said go

**New rule (2026-04-14):** Do not push to GitHub or deploy to Vercel without explicit permission in the same turn. Local commits are fine. Wait for "push", "deploy", "ship it", etc.

---

## Pipeline stages (main product — unchanged this session)

`lib/pipeline.ts` `runPipeline(propertyId)` runs in order:

1. **Stamp `pipeline_started_at`** — cron uses this for timing, not `properties.created_at`
2. **Prompt revision snapshot** — hashes every system prompt, inserts `prompt_revisions` row if changed
3. **Intake** — verify ≥5 photos
4. **Analysis** — Claude Sonnet 4.6 vision per photo: room, quality, aesthetic, depth, key_features, composition, video_viable, suggested_motion
5. **Style guide** — built and stored on `properties.style_guide` but NOT injected into director (bloat regression)
6. **Scripting** — director picks 10–16 scenes. PAST GENERATIONS block (winners ≥4, losers ≤2, last 30 days) injected as in-context learning
7. **Generation SUBMIT** — fire-and-forget. Submits to provider, persists `provider_task_id`, exits in ~30s
8. **Cron finalize** — `/api/cron/poll-scenes` every minute: downloads clips, records cost, flips property to complete. Shotstack stitches if key is set.

Preflight QA and inline QC were deleted on 2026-04-14 AM. They were regressing output.

### Camera vocabulary (11 verbs + 8 cinematographer sub-variants)

Active: `push_in · pull_out · orbit · parallax · dolly_left_to_right · dolly_right_to_left · reveal · drone_push_in · drone_pull_back · top_down · low_angle_glide · feature_closeup`

Banned (not emitted): `tilt_up · tilt_down · crane_up · crane_down · slow_pan · orbital_slow`. Vertical-only motions don't map to real-estate shot types.

Sub-variants (prompt-level styles within an existing verb): Straight Push, Straight Push Curve, Straight Push with Rise, Orbiting Detail Rise and Drop, Cowboy Lift, PTF Orbit, Detail Slider, Top Down Detail.

### Reveal hardening (shipped 2026-04-14 PM)

`lib/prompts/director.ts`: reveal prompts must name a foreground that appears verbatim in the photo's `key_features`. A reveal whose foreground is invented (e.g. "reveal past the kitchen island corner" when the photo has no island) is banned. Director falls back to push_in or dolly.

### Scene allocation quotas

Kitchen 2–3 (hard min 2, pick 3 with 3+ viable photos w/ depth=high or aesthetic≥8), living_room 2 (hard min 2), master_bedroom 2 (hard min 2), dining 1, pool 2 (if present), lanai 1, bathroom 1–2, exterior_front 2–3, aerial 1–2, bedrooms 1–2 each, extras 1–2 total.

### Router

Movement first, room type as tiebreaker. `lib/providers/router.ts`.

- Runway: `push_in · pull_out · feature_closeup · drone_* · top_down · orbit (exterior)`
- Kling: `dolly_* · parallax · reveal · low_angle_glide · orbit (interior)`

---

## Phase 2.8 — Prompt Lab Listings (shipped 2026-04-20 evening; refined same day)

A second-generation Lab at `/dashboard/development/lab`. The legacy Lab at `/dashboard/development/prompt-lab` has been retired — routes redirect here. Legacy tables (`prompt_lab_sessions`, `prompt_lab_iterations`, `prompt_lab_recipes`) are preserved and feed unified retrieval. Listings group multiple photos, the director plans a shot sequence (scenes), and each scene carries iterations rendered via Atlas Cloud or native Kling.

**Changes from back-on-track phases (DQ/DM/CI):**
- Default model: `kling-v3-pro` → **`kling-v2-6-pro`** (better motion, lower cost)
- `CAMERA_STABILITY_PREFIX` now gated to `kling-v3-*` only (was prepended to all renders)
- Paired scenes (`use_end_frame && end_image_url`) auto-route to `kling-v2-1-pair`
- `lib/refine-prompt.ts` rewrites the prompt at render time instead of raw concat
- `lib/sanitize-prompt.ts` strips any residual stability-prefix artifacts on write + render
- Scene Editor (Haiku 4.5) carries full PROMPT STYLE rules (char limits, banned phrases)
- Native Kling (`kling-v2-native`) first in model picker, routes through pre-paid credits

### Hierarchy

`Listing → Photos → Scenes → Iterations`

- **Listing** — one real-estate property. Carries a name, default model, status, notes, archived flag, and a total cost rollup.
- **Photo** — one uploaded image. Gets analyzed by Claude (room type, aesthetic, depth, key features, composition, suggested motion). Embedding stored on the row.
- **Scene** — director-planned shot. `photo_id` (start) + optional `end_photo_id` (pair). Carries `director_prompt`, `director_intent` (model-agnostic structured intent), `refinement_notes` (accumulated directives), `chat_messages` JSONB, `use_end_frame` toggle, `archived` flag.
- **Iteration** — a single render of a scene. One per model when you "Generate all". Carries `director_prompt` (snapshot at render time), `model_used`, `provider_task_id`, `clip_url`, `rating`, `rating_reasons` (tag array), `user_comment`, `chat_messages` JSONB (legacy — now uses scene chat), `archived`, `cost_cents`.

### Provider: Atlas Cloud (replaces Kling/Runway/Luma for Lab)

Atlas Cloud is a multi-model aggregator. One API key, one endpoint, six Kling SKUs registered:

| Key | Slug | Price | End-frame | Notes |
|---|---|---|---|---|
| `kling-v3-pro` | `kwaivgi/kling-v3.0-pro/image-to-video` | $0.095 | yes | Selectable; known shake issue on single-image |
| `kling-v3-std` | `kwaivgi/kling-v3.0-std/image-to-video` | $0.071 | yes | Cheap exploration |
| `kling-v2-6-pro` | `kwaivgi/kling-v2.6-pro/image-to-video` | $0.060 | yes | **Default** (changed 2026-04-20 based on rated-iteration signal). HOT-tagged, smoother motion |
| `kling-v2-1-pair` | `kwaivgi/kling-v2.1-i2v-pro/start-end-frame` | $0.076 | yes | Purpose-built for paired scenes |
| `kling-v2-master` | `kwaivgi/kling-v2.0-i2v-master` | $0.221 | **no** | Premium; single-frame only |
| `kling-o3-pro` | `kwaivgi/kling-video-o3-pro/image-to-video` | $0.095 | yes | Newest generation |

Wan 2.7 registered briefly, removed 2026-04-20 evening. `lib/providers/atlas.ts::ATLAS_MODELS` is the server-side source of truth; `src/lib/labModels.ts` mirrors it for the UI.

### Lifecycle + crons

Fire-and-forget does not survive Vercel lambda termination, so the listings Lab runs on two crons:

1. `/api/cron/poll-listing-lifecycle` (every minute, `maxDuration=300`)
   - Picks up listings at `status='analyzing'` (limit 3/tick) — runs `analyzeListingPhotos` (Claude vision per photo, parallel, stores embedding)
   - Picks up listings at `status='directing'` (limit 5/tick) — runs `directListingScenes` (Sonnet 4.6 with recipe + exemplar + loser retrieval), flips to `status='ready_to_render'`
   - Failures mark listing `status='failed'` so the UI stops spinning
2. `/api/cron/poll-listing-iterations` (every minute) — polls Atlas for rendering iterations, downloads clip URL, flips to `rendered`, logs cost to `cost_events` (property_id=null, scope='lab_listing')

### Director (lists listings) — recipe-driven (restored 2026-04-20)

`lib/prompt-lab-listings.ts::directListingScenes` injects three retrieval blocks into the Sonnet user prompt alongside `buildDirectorUserPrompt`:

1. **Recipe match** — top matching `prompt_lab_recipes` by cosine distance (<0.35) per photo, deduped across photos, capped at 5. Gives the director curated templates from past promoted winners.
2. **Past winners** — top 4★+ iterations from `v_rated_pool` (unified Lab sessions + prod ratings + listing iterations), capped at 5.
3. **Past losers** — bottom 2★ iterations, capped at 3.

Retrieval is best-effort; a failing RPC logs and continues. Photo embedding is read off `prompt_lab_listing_photos.embedding` (parsed with `fromPgVector`).

### End-frame pairing

Director returns `end_photo_id` per scene when it wants a pair. `resolveSceneEndFrame` returns the URL if resolvable, else null (no more center-crop fallback — dropped 2026-04-20). Scene carries `use_end_frame` boolean; backfilled `false` for existing scenes where `end_photo_id IS NULL`. UI has a per-scene on/off toggle.

Director prompt explicitly tells Claude that single-image i2v is the right default for push-ins, top-downs, and feature closeups — don't force a pair.

### Shake mitigation (Kling v3 issue)

Kling v3.0-pro renders visibly shakier than v2. Two levers:

- **Positive prefix** (`CAMERA_STABILITY_PREFIX`) — injected by render.ts for `kling-v3-*` models only (NOT v2.x or o3). Was previously added to every render; gated 2026-04-20 (Phase DQ.2). Residual stability prefixes sanitized from persisted prompts by `lib/sanitize-prompt.ts`.
- **Negative prompt** field on `AtlasSubmitBody`: `"shaky camera, handheld, wobble, vibration, jitter, camera shake, rolling shutter, unstable motion"` — still applied on every Atlas request as a belt-and-braces measure.

### Rating + reasons

Rating remains 1–5★ on iterations. Clicking a star opens `RatingReasonsModal` — user picks structured tags from a fixed taxonomy (`lib/rating-taxonomy.ts`):

- **Positive (4–5★)**: good_pacing, clean_motion, on_brand, excellent_composition, accurate_to_photo, cinematic_energy
- **Negative (1–3★)**: camera_shake, too_fast, too_slow, boring_motion, hallucinated_geometry, hallucinated_objects, warped_text, flicker, jumpy, overexposed, underexposed, color_cast, bad_framing, subject_drift, end_frame_lurch
- **other** (escape hatch, rely on comment for detail)

Reasons persist to `prompt_lab_listing_scene_iterations.rating_reasons TEXT[]`. Rendered as pill chips on the iteration card. Intended to feed retrieval/autonomous iterator with richer signal than stars alone.

### Unified scene chat (Haiku 4.5 + streaming + two tools)

`POST /api/admin/prompt-lab/listings/:id/scenes/:sceneId/chat` — SSE stream. Haiku 4.5 sees the full scene state: director prompt, refinement notes, every iteration's model / prompt / rating / reasons / comment / archive state. User can reference iterations by # naturally.

Two tools:
- **`save_future_instruction(instruction)`** — appends to `scene.refinement_notes`. Concatenated onto the prompt at next render.
- **`update_director_prompt(new_prompt)`** — rewrites `scene.director_prompt` directly. UI surfaces the change via a dismissible "Director prompt rewritten" banner and triggers a reload.

Stream events: `text` (delta), `saved_instruction`, `prompt_updated`, `done`, `error`. Client consumer in `src/lib/labListingsApi.ts::chatSceneStream`.

Per-iteration chat still works but the SceneCard no longer surfaces a button for it (single scene thread is the primary flow).

### Scene + iteration archive

- `prompt_lab_listing_scenes.archived` BOOLEAN (migration 027) — ShotPlanTable hides by default with "Show archived scenes (N)" toggle; archived scenes skipped by Render-all
- `prompt_lab_listing_scene_iterations.archived` BOOLEAN (migration 026) — iteration list hides by default; "Show archived (N)" per-scene toggle; archived stays in DB so rating signal survives

### UI: master-detail layout

`src/pages/dashboard/LabListingDetail.tsx`:

- **Header**: listing name + status chip + model chip + notes + stats strip (scenes rendered/total, iterations, cost w/ per-model breakdown, photos count w/ show/hide, created date)
- **ShotPlanTable**: one compact row per non-archived scene (thumbnail + # + room + movement + iteration count + best rating + total cost + status chip). Click a row to focus that scene.
- **Focused SceneCard**: full interaction surface for the selected scene. Newest iteration auto-expanded; all older iterations rendered as one-line `IterationCollapsed` rows, click to expand into `IterationExpanded` (video + actions + comment + rating reasons).

### Generate all models + side-by-side compare

`GenerateAllModal` (scene card → "Generate all" button) — checkboxes per model, running cost total, warns when pair-incompatible models are selected with end-frame on. Calls `POST /render` with `models: string[]` → one iteration per model in a single request.

`CompareModal` (appears when scene has ≥2 playable iterations) — side-by-side video grid labeled A/B/C... Click stars to rate inline.

### Data model additions (migrations 023–027)

- **`prompt_lab_listings`** — id, name, created_by, model_name, notes, status ('analyzing' | 'directing' | 'ready_to_render' | 'rendering' | 'failed'), archived, total_cost_cents, created_at
- **`prompt_lab_listing_photos`** — id, listing_id, photo_index, image_url, image_path, analysis_json, embedding vector(1536), created_at
- **`prompt_lab_listing_scenes`** — id, listing_id, scene_number, photo_id, end_photo_id, end_image_url, room_type, camera_movement, director_prompt, director_intent JSONB, refinement_notes TEXT, chat_messages JSONB, use_end_frame BOOLEAN, archived BOOLEAN, created_at
- **`prompt_lab_listing_scene_iterations`** — id, scene_id, iteration_number, director_prompt, model_used, provider_task_id, clip_url, rating, tags, user_comment, rating_reasons TEXT[], cost_cents, status, render_error, chat_messages JSONB, archived BOOLEAN, embedding, created_at
- **`v_rated_pool`** view extended with a 3rd UNION branch so new listing iterations flow into unified retrieval alongside legacy Lab sessions and prod ratings.

### Listings Lab key files

| File | Purpose |
|---|---|
| `lib/providers/atlas.ts` | Atlas provider + ATLAS_MODELS registry + negative prompt + end-frame routing |
| `lib/prompt-lab-listings.ts` | Lifecycle helpers: `analyzeListingPhotos`, `directListingScenes` (w/ recipe + exemplar + loser retrieval), `resolveSceneEndFrame`, `createListingWithPhotos` |
| `lib/services/end-frame.ts` | (legacy — crop fallback no longer called) |
| `lib/rating-taxonomy.ts` | Fixed positive/negative rating reasons list |
| `lib/prompts/director-intent.ts` | `DirectorIntent` zod schema — model-agnostic structured scene intent |
| `api/admin/prompt-lab/listings/index.ts` | GET list, POST create listing with photos |
| `api/admin/prompt-lab/listings/[id].ts` | GET full listing + photos + scenes + iterations, PATCH archive/name/notes |
| `api/admin/prompt-lab/listings/[id]/direct.ts` | Manual re-director trigger |
| `api/admin/prompt-lab/listings/[id]/render.ts` | Submit one/many renders; accepts `scene_ids`, `model_override`, `models[]`, `source_iteration_id`; prepends stability prefix; passes refinement_notes |
| `api/admin/prompt-lab/listings/[id]/scenes/[sceneId].ts` | PATCH director_prompt / use_end_frame / archived |
| `api/admin/prompt-lab/listings/[id]/scenes/[sceneId]/chat.ts` | SSE streaming scene chat (Haiku 4.5) w/ save_future_instruction + update_director_prompt tools |
| `api/admin/prompt-lab/listings/[id]/scenes/[sceneId]/clear-chat.ts` | Reset scene.chat_messages |
| `api/admin/prompt-lab/listings/[id]/scenes/[sceneId]/pin-instruction.ts` | Append instruction OR replace refinement_notes; marks a specific chat_messages[idx].pinned=true when iteration_id + message_index supplied |
| `api/admin/prompt-lab/listings/[id]/iterations/[iterId]/index.ts` | DELETE iteration |
| `api/admin/prompt-lab/listings/[id]/iterations/[iterId]/rate.ts` | rating, tags, comment, rating_reasons, archived |
| `api/admin/prompt-lab/listings/[id]/iterations/[iterId]/chat.ts` | SSE streaming iteration chat (still functional; UI no longer surfaces it) |
| `api/admin/prompt-lab/listings/[id]/iterations/[iterId]/clear-chat.ts` | Reset iteration.chat_messages |
| `api/cron/poll-listing-lifecycle.ts` | Advance listings through analyzing → directing → ready_to_render |
| `api/cron/poll-listing-iterations.ts` | Finalize renders from Atlas, insert cost_events |
| `src/pages/dashboard/LabListingDetail.tsx` | Master-detail view: header + ShotPlanTable + focused SceneCard |
| `src/pages/dashboard/LabListings.tsx` | Listings list page |
| `src/pages/dashboard/LabListingNew.tsx` | Create listing + upload photos |
| `src/components/lab/SceneCard.tsx` | Full scene interaction: pair viz, prompt editor, refinement notes panel, iterations list w/ collapse, unified ChatPanel, Generate-all + Compare buttons |
| `src/components/lab/ShotPlanTable.tsx` | Compact scene list |
| `src/components/lab/ChatPanel.tsx` | Shared streaming chat component (used by scene chat) |
| `src/components/lab/RatingReasonsModal.tsx` | Rating-reason tag picker |
| `src/components/lab/GenerateAllModal.tsx` | Multi-model confirmation + cost tally |
| `src/components/lab/CompareModal.tsx` | A/B/C side-by-side grid with inline rating |
| `src/components/lab/PairVisualization.tsx` | Start → end thumbnail preview |
| `src/lib/labListingsApi.ts` | Client API: types, authedFetch, streaming SSE consumer, all helpers |
| `src/lib/labModels.ts` | UI-side model metadata (mirror of ATLAS_MODELS) |

---

## Prompt Lab — legacy single-photo subsystem (shipped 2026-04-14 PM, still live)

An admin-only iterative prompt-refinement workbench at `/dashboard/development/prompt-lab`. Separate from production — changes here do not touch `lib/pipeline.ts` or production director output. Superseded by Phase 2.8 listings for multi-photo workflows but preserved because its recipes and rated history feed the unified retrieval pool that the listings director now reads.

### Why

Only 7 rated scenes in prod (0 kitchen, 0 living). Can't tune director prompts from data that doesn't exist. Lab generates that data on-demand without running a full property.

### Capabilities

**Upload & generate:** drag-drop multi-file upload on the list page. Each image becomes a session; with auto-analyze on, `PHOTO_ANALYSIS_SYSTEM` + `DIRECTOR_SYSTEM` run per session in parallel. Result: the proposed camera_movement + prompt for every uploaded photo in one shot.

**Batches:** sessions can carry a `batch_label` (e.g. "Smith property"). List view groups by batch. Session cards are draggable — drop on another batch header to move, drop on the "create new batch" zone at the bottom to make a new group. Click a batch title to rename all its sessions at once.

**Filter chips per batch:** All / Need to start / In progress / Completed. "Need to start" means no admin feedback yet (no rating, tag, comment, or refinement). "Completed" means any iteration rated 4★+ OR any iteration became the source of a recipe.

**Card states on the list view:**
- `Rendering` amber pill over thumbnail while any iteration has `provider_task_id` set + no `clip_url` + no error
- `Generation approval needed` sky blue banner when latest iteration has a rendered clip with no rating
- `Iteration approval needed` teal banner when latest iteration has a director prompt but no clip yet
- `✓ Completed` emerald badge (top-right) when any iteration rated 4★+ or promoted to recipe
- Auto-refreshes every 15s when any session is active (visibility-gated)
- **Card sorting within batches** by priority: Generation approval needed → Iteration approval needed → Rendering → rest → Completed

Banners are based on the LATEST iteration per session (not the union of all iterations). Fixes false "generation approval" when user has moved past old unrated clips to new iterations.

**Detail view (`/dashboard/development/prompt-lab/:sessionId`):** click-to-edit label in header; iteration stack with newest on top. Latest iteration has 2px foreground border + "Latest · active" pill. Older iterations muted. Each iteration card shows analysis summary, director prompt, retrieval chips ("Based on N similar wins" / "Recipe · archetype"), render controls on latest, rating widget + chat.

**Render (async — shipped 2026-04-14 PM, concurrency guard 2026-04-15):** fire-and-forget. Render endpoint submits to Kling/Runway and stores `provider_task_id`. `/api/cron/poll-lab-renders` runs every minute in two phases: Phase 1 submits queued renders when a slot opens, Phase 2 finalizes in-flight renders (downloads clips, uploads to Supabase Storage `property-videos/prompt-lab/<session>/<iteration>.mp4`, sets `clip_url`). Safe to navigate away mid-render. Provider picker (Auto / Kling / Runway) on each render control.

**Kling concurrency guard (shipped 2026-04-15):** `countKlingInFlight()` checks Lab + prod in-flight Kling jobs against 4-concurrent cap. Auto mode falls back to Runway when Kling is full. Explicit Kling selection queues the render (`render_queued_at` column, migration 012). Queued renders auto-submit when a slot opens; 30-min expiry. Violet "Queued — waiting for slot" UI indicator.

**Re-render with different provider (shipped 2026-04-17):** "Try with: Kling / Runway" buttons on iterations with clips. Endpoint `api/admin/prompt-lab/rerender.ts` clones the iteration and submits to the specified provider. Each provider attempt gets its own iteration with its own rating, so recipes capture the winning provider.

**Rating on any iteration (fixed 2026-04-15):** rating widget no longer gated on `isLatest` — can rate older iterations. "Ready for approval" banner clears once any iteration in a session has feedback.

**Save rating** button (separate from Refine) persists rating + tags + comment without forcing a new iteration.

**Refine from any iteration (shipped 2026-04-20):** Refine controls (chat + "Refine → new iteration" button) no longer gated on `isLatest`. Can branch from any older iteration; label says "(will branch from this iteration)".

**4★ backup recipes (shipped 2026-04-20):** Rating 4★ auto-promotes to recipe as a "backup" (archetype prefixed `backup_`, `rating_at_promotion=4`). 4★+ marks session as completed (was 5★ only). Manual "Promote to recipe" button shows on 4★+ iterations. Both primary (5★) and backup (4★) recipes feed retrieval.

**Organize mode + archive (shipped 2026-04-17):** "Organize" button toggles multi-select mode with checkboxes on session cards. Selection actions: group into batch, move to batch, archive, unarchive. Collapse chevrons on batch headers hide/show card grids. Sessions filtered out when archived; "Show archived" toggle. Grey "Archived" badge on archived cards. Migration 013: `archived boolean` on `prompt_lab_sessions`.

### Learning loop (the ML part — shipped 2026-04-14 PM, extended 2026-04-15+)

Three layered mechanisms. Retrieval now pulls from a unified pool of Lab + production ratings.

**1. Similarity retrieval (few-shot)** — every iteration's analysis gets embedded via OpenAI `text-embedding-3-small` (1536 dim) and stored in `prompt_lab_iterations.embedding`. Production scenes also embed on insert via `embedScene(sceneId)` in `lib/db.ts`. On each new analyze, the new photo's embedding queries `match_rated_examples` RPC (unified — pools Lab iterations + prod `scene_ratings` with `rating >= 4` and rating-weighted cosine distance). Top-5 exemplars (with tags/comment/refinement) are injected into the director user message as a "PAST WINNERS ON STRUCTURALLY SIMILAR PHOTOS" block. Same retrieval runs on Refine. The old `match_lab_iterations` RPC still exists in DB but is unused.

**Negative signal (shipped 2026-04-15):** `match_loser_examples` RPC pools low-rated (<=2★) Lab iterations + prod scene_ratings. `retrieveSimilarLosers` + `renderLoserBlock` inject an "AVOID THESE PATTERNS" block into the director user prompt alongside winners. Both analyze.ts and refine.ts call loser retrieval in parallel with winner retrieval. Rose-colored "Avoiding N losers" chip in Lab UI.

**"DO NOT REPEAT" block (shipped 2026-04-15–19):** when re-analyzing a session, all prior non-5★ prompts are injected as a "DO NOT REPEAT" block so the director avoids repeating failed approaches.

**2. Recipe library** — `prompt_lab_recipes` table keyed by archetype + room_type + camera_movement. Auto-populated on rating=5 unconditionally (dedup removed 2026-04-17 — every 5★ now promotes). Rating=4 also auto-promotes as backup recipe (archetype prefixed `backup_`, `rating_at_promotion=4`; shipped 2026-04-20). Manual "Promote to recipe" button pre-fills `room_camera_YYMMDD-slug` archetype pattern. Green success banner for auto-promote confirmation. When a new photo's embedding matches a recipe within distance 0.35 on the same room_type, director gets a "VALIDATED RECIPE MATCH" block instructing it to use the template verbatim after feature substitution. `times_applied` increments per use. Recipes UI at `/dashboard/development/prompt-lab/recipes`: list, edit, archive, delete.

**3. Rule mining + proposals** — `/dashboard/development/proposals` page. "Run rule mining" aggregates rated Lab iterations by (room × movement × provider) bucket, passes winners + losers + evidence to Claude with `DIRECTOR_PATCH_SYSTEM`, which returns a unified diff + per-change citations. Admin reviews (diff + bucket evidence), clicks Apply → new `lab_prompt_overrides` row. Lab's director resolves the override at call time; production director does NOT consult overrides. Reject is one click, audit-logged on the proposal row.

### Data model

- **`prompt_lab_sessions`** — id, created_by, image_url, image_path, label, archetype, batch_label, archived (boolean, migration 013), created_at
- **`prompt_lab_iterations`** — id, session_id, iteration_number, analysis_json, analysis_prompt_hash, director_output_json, director_prompt_hash, clip_url, provider, provider_task_id, render_submitted_at, render_queued_at (migration 012), render_error, cost_cents, rating, tags, user_comment, refinement_instruction, embedding vector(1536), embedding_model, retrieval_metadata, created_at
- **`scenes`** — (production) now includes `embedding vector(1536)` + HNSW partial index (m=16, ef_construction=64, where not null) via migration 009
- **`prompt_lab_recipes`** — id, archetype, room_type, camera_movement, provider, composition_signature, prompt_template, source_iteration_id, rating_at_promotion, promoted_by, promoted_at, times_applied, embedding vector(1536), status
- **`lab_prompt_overrides`** — prompt_name, body, body_hash, is_active (UNIQUE partial index on active rows)
- **`lab_prompt_proposals`** — prompt_name, base_body_hash, proposed_diff, proposed_body, evidence JSONB, rationale, status, reviewed_at, reviewed_by
- **`dev_session_notes`** — session_date, objective, accomplishments (for the Development dashboard working log)

RPC helpers: `match_rated_examples` (unified retrieval), `match_loser_examples` (negative signal), `match_lab_recipes`, `recipe_exists_near`. Legacy: `match_lab_iterations` (unused).

### Lab key files

| File | Purpose |
|---|---|
| `lib/prompt-lab.ts` | Core helpers: analyze, direct, refine, submit/finalize render, retrieve exemplars/recipes, resolve override |
| `lib/embeddings.ts` | OpenAI text-embedding-3-small wrapper |
| `lib/prompts/director-patch.ts` | DIRECTOR_PATCH_SYSTEM meta-prompt for rule mining |
| `api/admin/prompt-lab/sessions.ts` | List + create (with batch_label) |
| `api/admin/prompt-lab/[sessionId].ts` | Detail + PATCH (label, archetype, batch_label) + DELETE |
| `api/admin/prompt-lab/analyze.ts` | Run analyze + director with retrieval injection |
| `api/admin/prompt-lab/refine.ts` | Save feedback + generate refined iteration |
| `api/admin/prompt-lab/render.ts` | Submit provider job (async) |
| `api/admin/prompt-lab/rate.ts` | Save rating; auto-promote 5★ to recipe if novel |
| `api/admin/prompt-lab/recipes.ts` | GET list + POST promote + PATCH edit + DELETE |
| `api/admin/prompt-lab/rerender.ts` | Clone iteration + submit to specified provider (NEW 2026-04-17) |
| `api/admin/prompt-lab/mine.ts` | Aggregate evidence, run DIRECTOR_PATCH_SYSTEM, store proposal |
| `api/admin/prompt-lab/proposals.ts` | List + apply/reject |
| `api/cron/poll-lab-renders.ts` | Phase 1 submit queued + Phase 2 finalize in-flight (rewritten 2026-04-15) |
| `scripts/backfill-scene-embeddings.ts` | One-shot: embed existing prod scenes (ran, 7 scenes) |
| `scripts/trace-director-prompt.ts` | CLI: reconstruct + audit director user message for any listing/property (NEW 2026-04-20) |
| `scripts/trace-director-prompt.impl.ts` | Implementation for trace script — retrieval RPCs, transcript writer (NEW 2026-04-20) |
| `scripts/cost-reconcile.ts` | Dump cost_events by provider/SKU for a date range; run weekly (NEW 2026-04-20) |
| `src/pages/dashboard/PromptLab.tsx` | Main Lab UI (list + detail) |
| `src/pages/dashboard/PromptLabRecipes.tsx` | Recipe library UI |
| `src/pages/dashboard/PromptProposals.tsx` | Rule-mining proposals UI |
| `src/pages/dashboard/Development.tsx` | Landing page: session notes, links, changelog |

---

## Dashboard nav (reorg shipped 2026-04-14 PM)

TopNav sub-nav now: Overview · Pipeline · Listings · Logs · Finances · **Development** (dropdown) · Settings.

Development dropdown: Overview · Learning · Prompt Lab · Recipes · Proposals · **Rating ledger**.

Legacy routes `/dashboard/learning` and `/dashboard/prompt-lab` 404 — all moved under `/dashboard/development/*`.

Development landing (`/dashboard/development`) shows:
- Session notes — per-session objective + accomplishments log (CRUD via `/api/admin/dev-notes`)
- Quick-link cards to Learning, Prompt Lab, Recipes, Proposals
- Prompt revision changelog summary (latest version per prompt)
- Static "How it works" reference: pipeline stages, router, vocabulary, key tables

### Rating ledger (shipped 2026-04-21, Window C)

`/dashboard/rating-ledger` is a read-only unified view of every rating Oliver has ever given: legacy Prompt Lab iterations, Phase 2.8 Listings Lab iterations, and production `scene_ratings`. `api/admin/rating-ledger.ts` normalizes the three surfaces into one paginated JSON with filters (`surface`, `sku`, `min_rating`, `has_comment`) and attaches the active recipe via `prompt_lab_recipes.source_iteration_id`. Each row shows image thumb → clip preview → SKU chip → stars → reasons + comment → surface chip → retrieval-status chip (green/amber/red indicating whether the rating is actually wired into director retrieval). Built to satisfy criterion #1 (no HITL) via transparency — Oliver can audit every rating linked back to image + clip + SKU + retrieval readiness.

Round 2 (2026-04-21) added a bucket-progress scoreboard on top of the ledger: a 5-card strip across the 5 quota-high (room × movement) buckets (kitchen/push_in, living_room/push_in, master_bedroom/push_in, exterior_front/push_in, aerial/drone_push_in) that auto-refreshes every 30s (Page Visibility API pauses polling when the tab is hidden). Clicking a card filters the ledger to that bucket via new `?room_type=` + `?camera_movement=` params on `/api/admin/rating-ledger`, and a clear-filter pill reverts. Progress comes from a new `GET /api/admin/bucket-progress` endpoint — winner rule is ≥3 iterations on one SKU AND ≥80% rated 4★+, tiebreak higher avg_rating then cheaper `priceCentsPerClip`. SKU-level signal counts Phase 2.8 only; legacy Lab + prod contribute to `total_iter` / `total_rated_4plus`. The 5 buckets are defined once in a `BUCKETS` const at the top of the endpoint file.

- `api/admin/rating-ledger.ts` — GET admin endpoint, unified ledger
- `src/pages/dashboard/RatingLedger.tsx` — page UI
- `src/lib/ratingLedgerApi.ts` — typed fetch helper
- `api/admin/bucket-progress.ts` — GET admin endpoint, per-bucket progress + winner rule (NEW 2026-04-21, R2)
- `src/components/ledger/BucketProgressStrip.tsx` — 5-card scoreboard with 30s auto-poll + click-to-filter (NEW 2026-04-21, R2)
- `src/lib/bucketProgressApi.ts` — typed fetch helper (NEW 2026-04-21, R2)

---

## Providers (credit status 2026-04-20)

| Provider | Status | Notes |
|---|---|---|
| **Atlas Cloud** | Active (Lab listings) | 6 Kling SKUs registered (v2.6-pro default, v3-pro, v3-std, v2.1-pair, v2-master, o3-pro). Env: `ATLASCLOUD_API_KEY`, `ATLAS_VIDEO_MODEL` (default `kling-v2-6-pro`). Accepts `negative_prompt` + `cfg_scale` per request. Per-SKU pricing: v3-pro/o3-pro $0.095, v3-std $0.071, **v2.6-pro $0.060** ($0.60/clip at Atlas billing), v2.1-pair $0.076, v2-master $0.221. |
| **Kling (native)** | Active (Lab listings) | Oliver's pre-paid Kling credits via native API. Model key `kling-v2-native`. Routes through `lib/providers/kling.ts`. On 402/credit-exhaustion auto-failovers to Atlas `kling-v2-master`. Cost logged with `provider='kling', billing='prepaid_credits'`. Variable cost = $0. |
| Runway | Active (legacy + prod) | URL-based image input. Fallback when Kling is full |
| Kling (legacy) | Active (legacy + prod) | 4-concurrent cap, auto-fallback to Runway, explicit queues with 30-min expiry |
| Luma | Coded, not wired | |
| Higgsfield | Scaffolded, deferred — see `docs/HIGGSFIELD-INTEGRATION.md` | |
| Shotstack | Active if key set. Stage + prod keys exist in `.env`. Per-minute pricing: `SHOTSTACK_CENTS_PER_MINUTE=20` (Ingest plan). | |
| OpenAI | Embeddings for Lab + prod scene retrieval (unified pool). `OPENAI_API_KEY` live in Vercel prod + preview. Costs tracked in `cost_events` since CI.2. |
| Anthropic | Sonnet 4.6 (director, refine-prompt), Haiku 4.5 (scene chat, streaming SSE). Model-aware pricing since CI.1. |

---

## Cost tracking

`cost_events` table, `recordCostEvent` helper in `lib/db.ts`. Every API call logs a cost event — even $0 ones — for audit. No null/0 cost fields on finalized renders.

| What | How |
|---|---|
| Claude | `computeClaudeCost(usage, model)` — model-aware rate tables (Opus 4.x / Sonnet 4.x / Haiku 4.5). Every call site passes its model. |
| Atlas renders | Per-SKU pricing from `ATLAS_MODELS.priceCentsPerSecond`. Failed renders still log full cost (`render_outcome='failed'`). |
| Native Kling | $0 variable cost; `billing='prepaid_credits'`. Failed renders log $0 (`billing='prepaid_credits_failed_refunded'`). |
| Runway | `RUNWAY_CENTS_PER_CREDIT`. |
| Shotstack | `shotstackCostCents(durationSeconds)` = `ceil(minutes) × SHOTSTACK_CENTS_PER_MINUTE`. |
| OpenAI embeddings | `embedText` returns `usage.costCents`; all 5 call sites log events with `provider='openai', stage='embedding'`. |
| Reconciliation | `scripts/cost-reconcile.ts` — run weekly before high-volume sessions. |

Lab iterations include analysis + director + render cost in `prompt_lab_iterations.cost_cents` (rounded to int — fractional cents caused a 500 early in the Lab build). Atlas v2.6-pro real billing: $0.60/clip (12¢/sec). Historical rows backfilled 2026-04-20.

---

## Known bugs / gotchas

- **Runway ignores non-push motion** — router avoids sending those to Runway now; fallback path could still misroute.
- **Production pipeline base64 image input** — 4 places in `lib/pipeline.ts` still use base64 instead of URL. Lab is fixed; prod is not.
- **File-revert mystery** — unresolved. All Shotstack MVP files + the entire Lab build survived multiple sessions; probably dormant or specific to certain paths.
- **Prompt QA dead code** — `lib/prompts/prompt-qa.ts` + body of `runPreflightQA` in pipeline.ts still present. Never called. Prune later.

### Fixed 2026-04-20 (back-on-track phases)

- **Atlas cost off by 5–7×** — two compounding bugs: (1) `checkStatus` returned default model's price regardless of SKU rendered; (2) `priceCentsPerClip` was set to per-second value, not per-clip. Both fixed. Listing `dd552c89` dashboard: $4.80 → $30.20 (12 historical rows backfilled).
- **Scene Editor writing verbose trajectories** — Haiku 4.5 system prompt was generating 400+ char prompts with `LOCKED-OFF CAMERA…` prefix baked in. Fixed on 3 layers: system prompt PROMPT STYLE rules, `lib/sanitize-prompt.ts` on write, render-time sanitizer.
- **`CAMERA_STABILITY_PREFIX` polluting v2/o3 prompts** — prefix was prepended on every render regardless of model. Now gated to `kling-v3-*` only.

### Fixed since last refresh (2026-04-19 production-readiness merge)

- **`scene_ratings` cascade on rerun** — migration 014: denorm columns backfilled, FK switched to ON DELETE SET NULL, RPCs rebuilt with coalesce fallback. Oliver's "lost 7+ ratings" bug is fixed.
- **Failover too aggressive** — `lib/providers/errors.ts` classifies errors as permanent/capacity/transient/unknown. Only permanent errors trigger failover; capacity + transient retry same provider.
- **Shotstack cost not in `cost_events`** — migration 017 widened CHECK constraints for shotstack + openai providers. `recordCostEvent` now logs Shotstack renders.
- **Stale `needs_review` scenes (production)** — `api/scenes/[id]/resubmit.ts` provides manual single-scene resubmission with prompt editing + provider forcing. Dashboard resubmit buttons on PropertyDetail + Pipeline pages.
- **Refiner rationale contaminating losers retrieval** — migration 015: `refiner_rationale` column split from `user_comment`.
- **Lab→prod promotion flow missing** — BUILT. `api/admin/prompt-lab/promote-to-prod.ts` + `lib/prompts/resolve.ts` (`resolveProductionPrompt`). Migration 016: readiness view, promotion audit columns, source tracking on prompt_revisions.

### Fixed earlier (2026-04-15 through 2026-04-19)

- **Lab analyze >5MB photos** — `analyzeSingleImage` switched from base64 to URL-based Claude vision input.
- **Lab render >5MB photos** — `GenerateClipParams` extended with `sourceImageUrl`; Runway + Kling prefer URL over base64.
- **Rating on any iteration** — rating widget no longer gated on `isLatest`.
- **"Ready for approval" persists after rating** — fixed; banner clears once any iteration in a session has feedback.
- **Director repeats prompts** — new "DO NOT REPEAT" block injected with all prior non-5★ prompts when re-analyzing a session.

---

## What shipped 2026-04-20 (evening session — Phase 2.8 Lab Listings)

### Atlas Cloud + 6 Kling SKUs, Wan removed
- `lib/providers/atlas.ts::ATLAS_MODELS` registers kling-v3-pro, kling-v3-std, kling-v2-6-pro, kling-v2-1-pair (start-end-frame SKU), kling-v2-master, kling-o3-pro. Wan 2.7 dropped.
- `AtlasSubmitBody` carries `negative_prompt` + `cfg_scale`; `ATLAS_DEFAULT_NEGATIVE_PROMPT` applied every render.
- `AtlasModelDescriptor.endFrameField` gates end-frame support per-model (master i2v is null, all others `end_image`).
- Atlas output URL parser extended to handle `outputs: ["url"]` (array of strings) in addition to `Array<{url}>`; earlier version failed every completed render with "finished without an output URL".

### Listings Lab (migration 023)
- Multi-photo listing → scenes → iterations hierarchy. Director plans shots for the whole property in one pass.
- Cron-based lifecycle: `poll-listing-lifecycle` advances `analyzing → directing → ready_to_render`. `poll-listing-iterations` finalizes Atlas renders + logs cost_events (property_id=null, scope='lab_listing').
- Listing GET returns photos + scenes + iterations in one shot.

### Scene chat + iteration chat (migration 024, 026)
- Streaming SSE via Haiku 4.5. Two tools: `save_future_instruction` (appends to scene.refinement_notes), `update_director_prompt` (rewrites scene.director_prompt). User-facing "Pin" on user messages also appends to refinement_notes.
- `ChatPanel` shared component, used at scene level. Dismissable "Director prompt rewritten" banner. Enter to send, Shift+Enter for newline.
- System prompt sees every iteration's prompt / rating / reasons / comment — can pattern-match across iterations ("what worked in #1 and #4").
- Per-iteration chat endpoint still active for backward compat but UI no longer surfaces it.

### Rating reasons taxonomy (migration 026)
- `rating_reasons TEXT[]` on iterations.
- Fixed taxonomy in `lib/rating-taxonomy.ts`: 6 positive + 15 negative + "other".
- `RatingReasonsModal` opens on star click; polarity-appropriate tag list + optional comment.
- Reasons render as colored pills on iteration cards and feed into scene chat context.

### Scene + iteration archive (migrations 026, 027)
- Scene-level and iteration-level `archived` flags.
- ShotPlanTable hides archived scenes with "Show archived (N)" toggle; "Render all" skips them.
- IterationRow per-scene toggle for archived iterations; archived stays in DB so rating signal survives.

### End-frame toggle + stop auto-cropping (migration 025)
- Scene.`use_end_frame` BOOLEAN. Backfilled `false` for scenes where `end_photo_id IS NULL` (so existing crop-fallback scenes stop rendering with them).
- `resolveSceneEndFrame` no longer calls the crop fallback — unpaired → null endImageUrl.
- render.ts only passes endImageUrl when `use_end_frame && end_image_url`.
- Per-scene "End frame: on/off" chip in SceneCard.

### Kling v3 shake fix
- `CAMERA_STABILITY_PREFIX` prepended to every effective prompt in render.ts: `"LOCKED-OFF CAMERA on a gimbal-stabilized Steadicam rig. Smooth motorized dolly motion only. Zero camera shake..."`. Idempotent.
- `ATLAS_DEFAULT_NEGATIVE_PROMPT` on every request: `"shaky camera, handheld, wobble, vibration, jitter, camera shake, rolling shutter, unstable motion"`.

### Recipe + exemplar retrieval restored in listings director
- Phase 2.8 director was running rulebook-only — no retrieval from `prompt_lab_recipes` or `v_rated_pool`. Fixed.
- Per-photo: parse stored embedding → `retrieveMatchingRecipes` + `retrieveSimilarIterations` (4★+) + `retrieveSimilarLosers` (≤2★) → dedupe across photos → render blocks + append to `buildDirectorUserPrompt`.
- `renderRecipeBlock`, `renderExemplarBlock`, `renderLoserBlock` exported from `lib/prompt-lab.ts`. `fromPgVector` added to `lib/embeddings.ts`.
- Retrieval is best-effort; failures log and continue.

### Per-iteration actions (parity with legacy Lab)
- Regenerate (new iteration with this iteration's exact prompt — skips refinement_notes concat).
- Show full prompt (expand to see what actually rendered).
- Copy prompt to clipboard.
- Archive iteration (soft-hide, keeps signal).
- Delete iteration (permanent).
- Render endpoint accepts `source_iteration_id` for regenerate.

### Generate-all + Compare modals
- `GenerateAllModal` (scene card → "Generate all") — per-model checkboxes, live cost total, pair-incompatible warning. `POST /render` accepts `models: string[]`.
- `CompareModal` (auto-shows when ≥2 playable iterations) — side-by-side video grid labeled A/B/C... with inline star rating.

### Master-detail layout
- `LabListingDetail.tsx` rebuilt: header w/ stats strip → `ShotPlanTable` → focused `SceneCard`.
- Newest iteration auto-expanded; older iterations collapsed to one-line rows (click to expand).
- Photos gallery collapsed by default, toggled from the header.
- Dropped the vertical stack of N SceneCards that made navigation slow.

### Bug fixes
- Listing stuck at "analyzing" forever — fire-and-forget in POST /listings didn't survive Vercel lambda termination → replaced with cron-based lifecycle advancer.
- Director failing on Lab listings — user prompt was a raw JSON dump of analysis_json → switched to production's `buildDirectorUserPrompt` + injected retrieval blocks.
- Atlas renders marked failed with "finished without an output URL" — parser expected `Array<{url}>`, Atlas returns `Array<string>`. Extractor handles both shapes now.

---

## What shipped 2026-04-20 (morning — legacy Lab)

### Banner system overhaul
- "Ready for approval" renamed to **"Generation approval needed"** (sky blue)
- New **"Iteration approval needed"** banner (teal) — shows when latest iteration has a director prompt but no clip yet
- Banners now based on the LATEST iteration per session, not the union of all iterations. Fixes false "generation approval" when user has moved past old unrated clips to new iterations
- Card sorting within batches by priority: Generation approval needed → Iteration approval needed → Rendering → rest → Completed

### 4★ backup recipes
- Rating 4★ auto-promotes to recipe as a "backup" (archetype prefixed `backup_`, `rating_at_promotion=4`)
- 4★+ marks session as completed (was 5★ only)
- Manual "Promote to recipe" button shows on 4★+ iterations
- Both primary (5★) and backup (4★) recipes feed retrieval

### Refine from any iteration
- Refine controls (chat + "Refine → new iteration" button) no longer gated on `isLatest`
- Can branch from any older iteration; label says "(will branch from this iteration)"

### Recipe dedup fully removed
- Dropped `prompt_lab_recipes_source_iteration_unique` index from migration 015
- Every 5★ (and now 4★) creates a new recipe unconditionally

### Production readiness merge (from claude/review-listing-elevate-docs-NkMzb branch)
- Migration 014: scene_ratings denormalization (ratings survive property rerun, FK → ON DELETE SET NULL, denorm columns backfilled, RPCs rebuilt with coalesce fallback). Fixed: `rated_photo_key_features` type corrected from `text[]` to `jsonb`
- Migration 015: Lab ML integrity (refiner_rationale split from user_comment, completeness view)
- Migration 016: Lab→prod promotion (override readiness view, audit columns, source tracking on prompt_revisions)
- Migration 017: cost_events CHECK widened for shotstack + openai
- `lib/providers/errors.ts` — error classification (permanent/capacity/transient)
- `lib/prompts/resolve.ts` — resolveProductionPrompt reads Lab-promoted revisions
- `api/scenes/[id]/resubmit.ts` — manual scene resubmission
- `api/admin/prompt-lab/promote-to-prod.ts` — Lab→prod promotion endpoint
- `lib/pipeline.ts` — smart failover loop, Shotstack cost tracking, Lab-promoted director
- Dashboard UI: resubmit buttons on PropertyDetail + Pipeline

### Bug fixes (2026-04-20)
- Duplicate recipe 500 on double-click — wrapped in try/catch (then fully removed dedup)
- SyntaxError in sessions.ts from conflict resolution — fixed typeof expression

---

## What shipped 2026-04-15 through 2026-04-19 — reverse chronological

### Production-readiness merge (2026-04-19, commit 65dcc7d)
- **Migration 014: scene_ratings denormalization** — denorm columns (rated_prompt, rated_camera_movement, rated_room_type, rated_provider, rated_photo_key_features, rated_embedding, etc.), backfill from live join, FK→ON DELETE SET NULL, RPCs rebuilt with coalesce fallback. `rated_photo_key_features` typed as `jsonb` to match `photos.key_features`.
- **Migration 015: Lab ML integrity** — `refiner_rationale` column split from `user_comment` (stops contaminating losers retrieval), unique index on recipes per `source_iteration_id`, `prompt_lab_iterations_complete` convenience view.
- **Migration 016: Lab→prod promotion** — `lab_prompt_override_readiness` view (≥10 renders, avg ≥4★, winners ≥2× losers), promotion audit columns on `lab_prompt_overrides`, `source` + `source_override_id` on `prompt_revisions`.
- **Migration 017: cost_events widened** — CHECK constraints accept shotstack + openai providers and 'renders' unit_type.
- **`lib/providers/errors.ts`** — classifies provider errors as permanent/capacity/transient/unknown. Only permanent triggers failover; capacity + transient retry same provider.
- **`lib/prompts/resolve.ts`** — `resolveProductionPrompt(promptName, baseline)` reads Lab-promoted revisions from `prompt_revisions`. Production DIRECTOR_SYSTEM no longer hardcoded.
- **`api/scenes/[id]/resubmit.ts`** — manual single-scene resubmission with prompt editing + provider forcing.
- **`api/admin/prompt-lab/promote-to-prod.ts`** — GET lists overrides with readiness stats, POST promotes override to production `prompt_revisions`.
- **`lib/pipeline.ts`** — smart failover loop in `runGenerationSubmit` (permanent→failover, capacity/transient→retry), Shotstack cost tracking via `recordCostEvent`, `resolveProductionPrompt` for director.
- **Dashboard UI** — resubmit buttons on PropertyDetail + Pipeline pages for `needs_review` scenes.

### Organize mode + archive (2026-04-17)
- "Organize" button toggles multi-select mode with checkboxes on session cards
- Selection actions: group into batch, move to batch, archive, unarchive
- Collapse chevrons on batch headers — hide/show card grids
- Migration 013: `archived boolean` on prompt_lab_sessions
- Sessions filtered out when archived; "Show archived" toggle; grey "Archived" badge

### Re-render with different provider (2026-04-17)
- `api/admin/prompt-lab/rerender.ts`: clones iteration, submits to specified provider
- "Try with: Kling / Runway" buttons on iterations with clips
- Each provider attempt gets own iteration → own rating → recipe captures winning provider

### Recipe improvements (2026-04-17)
- Dedup removed: every 5★ now promotes to recipe unconditionally
- Auto-fill archetype: manual promote pre-fills `room_camera_YYMMDD-slug` pattern
- Green success banner for auto-promote confirmation (was using red error channel)

### Kling concurrency guard + render queue (2026-04-15)
- `countKlingInFlight()` checks Lab + prod in-flight Kling jobs
- Auto mode: falls back to Runway when Kling is full
- Explicit Kling: queues the render (migration 012: `render_queued_at`)
- Cron `poll-lab-renders.ts` rewritten with Phase 1 (submit queued) + Phase 2 (finalize in-flight)
- Queued renders auto-submit when slot opens, 30-min expiry
- Violet "Queued — waiting for slot" UI indicator

### Negative signal / losers retrieval (2026-04-15)
- Migration 011: `match_loser_examples` RPC — pools low-rated (<=2★) Lab iterations + prod scene_ratings
- `retrieveSimilarLosers` + `renderLoserBlock` — "AVOID THESE PATTERNS" block in director prompt
- Rose-colored "Avoiding N losers" chip in Lab UI

### Unified embeddings (2026-04-15)
- Migration 009: `scenes.embedding vector(1536)` + HNSW partial index
- Migration 010: Extended `match_rated_examples` to return tags/comment/refinement
- `embedScene(sceneId)` in lib/db.ts — embeds each scene on insert
- Backfill script `scripts/backfill-scene-embeddings.ts` — ran, 7 prod scenes embedded
- Lab retrieval switched from `match_lab_iterations` to `match_rated_examples` — unified pool of Lab + prod ratings

### Bug fixes (2026-04-15 through 2026-04-19)
- Lab analyze >5MB photos: switched to URL-based Claude vision input
- Lab render >5MB photos: Runway + Kling prefer URL over base64
- Rating on any iteration: no longer gated on `isLatest`
- "Ready for approval" persists after rating: fixed — banner clears on feedback
- Director repeats prompts: new "DO NOT REPEAT" block with prior non-5★ prompts

### Design docs (2026-04-15)
- Spec: `docs/superpowers/specs/2026-04-15-spatial-grounding-design.md` — spatial grounding + unified embeddings (spatial half PAUSED)
- Plan: `docs/superpowers/plans/2026-04-15-unified-embeddings.md` — executed, complete
- Plan: `docs/superpowers/plans/2026-04-15-spatial-grounding.md` — PAUSED, annotated

---

## What shipped 2026-04-14 PM — reverse chronological

### Prompt Lab learning loop + async renders
- **Rendering state on list cards**: amber spinner over thumbnail, "Ready for approval" sky banner when clip exists but not rated, auto-refresh 15s when active.
- **Completed = any 5★ iteration OR recipe-promoted**. Was previously only recipe-promoted — dedup skips meant 5★ could stay "Ready for approval" indefinitely.
- **Latest iteration highlight**: 2px foreground border + pill; older iterations muted + opacity 0.8.
- **"Need to start" redefined**: means no admin feedback (rating/tag/comment/refinement), not "no iterations". Auto-analyzed-only sessions count as Need to start.
- **Per-batch filter chips**: All · Need to start · In progress · Completed with live counts.
- **Completed badge** on card thumbnails.
- **Drag-drop batches**: session cards draggable between batch headers; bottom drop-zone creates a new batch on drop; click batch title to rename all.
- **Multi-file upload + real file dropzone** on the new-session panel.
- **Batch label** field on sessions; grouped list view.
- **Auto-promote 5★ to recipe** with cosine-distance dedup (0.2 threshold).
- **Rating-weighted retrieval** — 5★ rank 15% closer than 4★ at same cosine distance.
- **Save rating** button (no forced refine).
- **Render persistence** — downloads provider CDN URL + re-uploads to Supabase Storage so clips survive CDN expiry + CORS.
- **Fire-and-forget render + cron finalizer** — render endpoint submits + returns; `/api/cron/poll-lab-renders` every minute downloads completed + sets clip_url. 30-min hard timeout.
- **Render UI**: provider picker (Auto/Kling/Runway), pending badge, render_error display, "open in new tab" link.
- **Rule-mining system** (M-L-4): DIRECTOR_PATCH_SYSTEM meta-prompt, mine endpoint, proposals page with diff + evidence buckets, apply → `lab_prompt_overrides` that Lab's director resolves at call time (prod untouched).
- **Recipe library** (M-L-3): table + promote button + UI at `/recipes`. Archetype matching in analyze.
- **Similarity retrieval** (M-L-2): pgvector + HNSW + `match_lab_iterations`/`match_lab_recipes` RPCs. "Based on N similar wins" / "Recipe · archetype" chips.
- **pgvector + embeddings** (M-L-1): enabled extension, added embedding columns, OpenAI wrapper, backfill script.

### Development dashboard
- New nav reorg: **Development** dropdown replaces separate Learning + Prompt Lab entries.
- New `/dashboard/development` landing page with **session notes** (working log, CRUD).
- `dev_session_notes` table, `/api/admin/dev-notes` endpoint.

### Prompt Lab core (earlier in the day)
- Initial M-Lab-1 through M-Lab-4 scaffolding: sessions + iterations tables, analyze + direct + refine + render endpoints, upload flow, iteration UI, rating widget, PromoteRecipeControl, Development page.

### Director prompt
- **M2B**: reveal hardening — foreground element must appear in photo's `key_features`, bans hallucinated reveals.

---

## Migrations applied

| # | Name | What |
|---|---|---|
| 002 | `prompt_lab` | sessions + iterations tables + admin RLS |
| 003 | `dev_session_notes` | Development working-log table |
| 004 | `lab_learning` | pgvector, embedding columns, recipes + overrides + proposals |
| 005 | `voyage_embeddings` | briefly swapped to Voyage (1024 dim) |
| 006 | `openai_embeddings` | reverted to OpenAI text-embedding-3-small (1536 dim) |
| 007 | `batches_and_weighted_retrieval` | batch_label + rating-weighted `match_lab_iterations` + `recipe_exists_near` |
| 008 | `lab_render_async` | provider_task_id + render_error + render_submitted_at |
| 009 | `scene_embeddings` | `scenes.embedding vector(1536)` + HNSW partial index + `match_rated_examples` RPC |
| 010 | `match_rated_extended` | `match_rated_examples` returns tags/comment/refinement |
| 011 | `match_loser_examples` | RPC for low-rated (<=2★) Lab + prod retrieval |
| 012 | `render_queued_at` | `render_queued_at` column on prompt_lab_iterations |
| 013 | `session_archived` | `archived boolean` on prompt_lab_sessions |
| 014 | `scene_ratings_denorm` | Denorm columns on scene_ratings, FK→ON DELETE SET NULL, RPCs rebuilt with coalesce fallback. Fixes "lost ratings on rerun" bug |
| 015 | `lab_ml_integrity` | `refiner_rationale` column (split from user_comment), ~~unique index on recipes per source_iteration_id~~ (dropped 2026-04-20), `prompt_lab_iterations_complete` view |
| 016 | `director_prod_promotion` | `lab_prompt_override_readiness` view (≥10 renders, avg ≥4★, winners ≥2× losers), promotion audit columns on lab_prompt_overrides, source + source_override_id on prompt_revisions |
| 017 | `cost_events_shotstack` | CHECK constraints widened for shotstack + openai providers; unit_type widened for 'renders' |
| 018 | `judge_tables` | (Phase 1) Claude rubric judge infrastructure |
| 019 | `knowledge_map` | (Phase 2) Knowledge Map dashboard (168-cell grid) |
| 020 | `vocab_expansion` | (Phase 2.5) Rooms +10 (office, laundry, closet, basement, deck, powder_room, stairs, media_room, gym, mudroom); verbs −2 (pull_out, drone_pull_back) +1 (rack_focus) |
| 022 | `end_frame` | (Phase 2.7) end_image_url + end_photo_id on prod scenes for Atlas end-frame pairing |
| 023 | `lab_listings` | (Phase 2.8) 4 new tables: prompt_lab_listings, prompt_lab_listing_photos, prompt_lab_listing_scenes, prompt_lab_listing_scene_iterations. v_rated_pool extended with 3rd UNION branch |
| 024 | `iteration_chat` | iteration.chat_messages JSONB; scene.refinement_notes TEXT |
| 025 | `scene_use_end_frame_toggle` | scene.use_end_frame BOOLEAN (backfill false for end_photo_id IS NULL) |
| 026 | `scene_chat_archive_reasons` | scene.chat_messages JSONB; iteration.archived BOOLEAN; iteration.rating_reasons TEXT[] |
| 027 | `scene_archived` | scene.archived BOOLEAN |

SQL files in `supabase/migrations/` for record; MCP `apply_migration` is the live path.

---

## Immediate next actions (start here next session)

1. **CI.5 cost dashboard drill-down** — in progress, not yet shipped. Per-listing and per-batch cost breakdown UI with provider/SKU breakdown; links to `cost_events` rows.
2. **Phase M.2 — ML consolidation + SKU signal capture**
   - M.2a–c: backfill prod scene embeddings (7/24 → 24/24), stop writing deprecated capture fields (`tags`, `refinement_instruction`), add UI nudge when Lab overrides become promotable.
   - M.2d: migration 028 adds `model_used` to `prompt_lab_recipes`; retrieval extended to surface winning SKU to the director.
3. **Phase B — model head-to-head** — scope narrowed by Window D Round 1 audit (2026-04-21, `docs/audits/router-coverage-2026-04-21.md`). Existing 170 rated iterations yield **zero** (room × movement × SKU) buckets passing the winner rule (>=3 iter, >=80% 4★+). Root cause: only 32% of ratings are SKU-granular (Phase 2.8 Lab); legacy Lab + prod scene_ratings carry provider only. Revised plan: a minimal targeted grid on the quota-high buckets (kitchen, living_room, master_bedroom, exterior_front, aerial) rather than a full fresh listing. `scripts/build-router-table.ts` is a regression-guard for re-running the aggregation as ratings land. Draft `lib/providers/router-table.draft.ts` is committed but empty — `lib/providers/router.ts` stays on intuition-based routing until real signal arrives.
4. **Phase C — production end-to-end**
   - Router swap: Atlas + native Kling + Runway in prod pipeline
   - **Production base64→URL fix** — 4 places in `lib/pipeline.ts` still use base64. Lab fixed; prod not yet.
   - Duration-aware director: 15s → 4 scenes, 30s → 6–8, 60s → 12

---

## Files that matter most

| File | Purpose |
|---|---|
| `lib/pipeline.ts` | Production pipeline orchestrator |
| `lib/prompts/photo-analysis.ts` | Per-room vocab, video_viable rules, suggested_motion |
| `lib/prompts/director.ts` | 11-verb + 8 sub-variant vocab, exterior hard rules, reveal foreground rule (HARDENED 2026-04-14 PM) |
| `lib/prompts/director-patch.ts` | Meta-prompt for Lab rule mining |
| `lib/prompts/style-guide.ts` | Property style guide (built, not injected) |
| `lib/prompt-lab.ts` | Lab core helpers (NEW) |
| `lib/embeddings.ts` | OpenAI embeddings wrapper (NEW) |
| `lib/providers/router.ts` | Camera-movement-first routing |
| `lib/providers/errors.ts` | Error classification: permanent/capacity/transient/unknown (NEW) |
| `lib/providers/runway.ts` / `kling.ts` | Generation providers |
| `lib/providers/dispatch.ts` | `pickProvider(modelKey)` + `isNativeKling(modelKey)` (NEW 2026-04-20) |
| `lib/providers/shotstack.ts` | Assembly provider (active if key) |
| `lib/sanitize-prompt.ts` | Strip `LOCKED-OFF CAMERA…` stability prefix from any prompt string (NEW 2026-04-20) |
| `lib/refine-prompt.ts` | Sonnet 4.6 rewrite of director_prompt incorporating refinement_notes (NEW 2026-04-20) |
| `lib/prompts/resolve.ts` | `resolveProductionPrompt` — reads Lab-promoted revisions at runtime (NEW) |
| `lib/db.ts` | DB helpers including recordCostEvent, upsertSceneRating, fetchRatedExamples, recordPromptRevisionIfChanged |
| `api/pipeline/[propertyId].ts` | Production pipeline entrypoint |
| `api/cron/poll-scenes.ts` | Production cron backstop |
| `api/cron/poll-lab-renders.ts` | Lab render cron (NEW) |
| `api/scenes/[id]/resubmit.ts` | Manual single-scene resubmission with prompt editing + provider forcing (NEW) |
| `api/admin/prompt-lab/promote-to-prod.ts` | Lab→prod promotion: readiness stats + promote override to prompt_revisions (NEW) |
| `api/admin/prompt-lab/*` | Lab endpoints |
| `api/admin/dev-notes.ts` | Development dashboard session notes |
| `api/admin/rating-ledger.ts` | Unified rating ledger (legacy Lab + Listings Lab + prod scene_ratings); filters + retrieval-status per row (NEW 2026-04-21; R2 added `room_type` + `camera_movement` filters/fields) |
| `api/admin/bucket-progress.ts` | Per-bucket progress + winner rule for the 5 quota-high (room × movement) buckets; feeds scoreboard on /dashboard/rating-ledger (NEW 2026-04-21, R2) |
| `src/pages/dashboard/PromptLab.tsx` | Main Lab UI |
| `src/pages/dashboard/PromptLabRecipes.tsx` | Recipe library |
| `src/pages/dashboard/PromptProposals.tsx` | Rule-mining proposals |
| `src/pages/dashboard/Development.tsx` | Dev landing page |
| `src/pages/dashboard/RatingLedger.tsx` | Rating ledger page at `/dashboard/rating-ledger` (NEW 2026-04-21; R2 hosts bucket-progress strip + click-to-filter state) |
| `src/lib/ratingLedgerApi.ts` | Typed fetch helper for rating ledger (NEW 2026-04-21; R2 adds roomType + cameraMovement params) |
| `src/components/ledger/BucketProgressStrip.tsx` | 5-card bucket-progress scoreboard with 30s auto-poll + click-to-filter (NEW 2026-04-21, R2) |
| `src/lib/bucketProgressApi.ts` | Typed fetch helper for bucket-progress endpoint (NEW 2026-04-21, R2) |
| `src/components/TopNav.tsx` | Global sticky nav with Development dropdown |
| `docs/PROJECT-STATE.md` | This file |
| `docs/PROMPT-LAB-PLAN.md` | Lab design + milestone status |
| `docs/TODO.md` | Current open work |
| `docs/superpowers/specs/2026-04-15-spatial-grounding-design.md` | Spatial grounding design (PAUSED) |
| `docs/superpowers/plans/2026-04-15-unified-embeddings.md` | Unified embeddings plan (COMPLETE) |

---

## One-liner for next session

> Read `docs/PROJECT-STATE.md` first. **Back-on-track execution (2026-04-20)**: Phases A (Lab UX spine — banner, status chips, optimistic mutations), M.1 (director-prompt trace audit — WORKING WITH GAPS), DQ (director concise prompts — ≤120 char, banned phrases, v3-only stability prefix, paired auto-routing, default → v2.6-pro), DM (dev/legacy merge — native Kling revived, legacy Lab UI retired, sanitize-prompt, scene editor hygiene), CI.1–4 (model-aware Claude + OpenAI embedding + Shotstack per-minute + failed-render cost policy; Atlas cost tracking was off 5–7×, now fixed). Next: CI.5 cost dashboard → Phase M.2 ML consolidation + SKU capture → Phase B model head-to-head → Phase C prod end-to-end (base64→URL fix, router swap, duration-aware director).
