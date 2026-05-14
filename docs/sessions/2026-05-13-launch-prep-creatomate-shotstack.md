# 2026-05-13 — Launch-prep cascade: order-form persistence + Creatomate buildout + Shotstack port

**Status:** ✅ LIVE on listingelevate.com (5 PRs merged through dev → staging → main).

**Starting state:** an order on production produced 7–12 raw clip URLs and nothing else. No assembled MP4, no delivery. The pipeline's `runAssembly` function was dead code (sat after an early `return;` in `runPipeline`) and the cron `poll-scenes.ts` finalize block marked properties `complete` without ever calling it. 9 order-form fields (package / duration / voiceover / etc.) were collected by the UI and discarded on submit. Neither `CREATOMATE_API_KEY` nor `SHOTSTACK_API_KEY` were set in Vercel.

**Ending state:** a real order on production now produces a fully assembled MP4 via Creatomate's Just Listed #01 template. Order-form fields persist. Cron invokes `runAssembly`. Two providers (Creatomate + Shotstack) wired in parallel, switchable via `ASSEMBLY_PROVIDER` env var without code changes.

---

## Five-minute summary

1. Diagnosed and closed the "orders don't actually deliver a video" gap. Three orthogonal problems: form fields dropped, `runAssembly` dead-coded, no assembly API key configured.
2. Built five new modules under `lib/assembly/` (scene ordering, duration fit, branding, music selection, Creatomate template modifications + resolver) backed by 48 vitest cases.
3. Added `assembleFromTemplate` + `getTemplate` to `CreatomateProvider`, bumped endpoint to `/v2/renders`. Wired Oliver's Just Listed #01 template via env var.
4. After deciding Shotstack might be a better fit, *also* ported the Just Listed layout into a code-defined Shotstack timeline using HTML clips for full styling control. Both providers now compose with the same Phase 2–6 pipeline.
5. Cascaded dev → staging → main. Production pipeline is functional.

## Workstream timeline

### Order-form persistence (PR #37 → `cada6c2`)

- Migration 054: added 9 columns to `properties` with CHECK constraints (`duration IN (15,30,60)`, `orientation IN ('vertical','horizontal','both')`, `package IN ('just_listed','just_pended','just_closed','life_cycle')`).
- 5 plumbing touchpoints: `Upload.tsx` → `src/lib/api.ts` → `api/properties/index.ts` → `lib/db.ts` → `lib/types.ts`. Duration string `"15s"/"30s"/"60s"` normalized to int at the API boundary.
- Migration applied to prod Supabase via MCP; CHECK constraints verified rejecting bad duration (45) + bad orientation (`square`); valid full-payload roundtrip clean.

### Creatomate buildout (PR #38 → `a2fcaf3`)

#### Cron-assembly wire

- Exported `runAssembly` from `lib/pipeline.ts` (was private).
- In `poll-scenes.ts`: when all scenes settle with `finalStatus === 'complete'`, dynamic-import `runAssembly` and invoke it instead of the inline status update.
- Added `'assembling'` to cron's terminal-status skip list so the next-minute tick doesn't race a second assembly job.
- Wrapped invocation in `try/catch`; on throw, flips property to `failed` rather than getting stuck at `assembling`.
- Removed the lying comment + dead `await runAssembly()` call in `runPipeline`.

#### Phase 2 — deterministic walkthrough ordering

- `lib/assembly/scene-ordering.ts` + 11 vitest cases.
- Slot order: aerial → exterior_front → foyer → living_room → dining → kitchen → master_bedroom → bedroom → bathroom → powder_room → office → media_room → gym → laundry → mudroom → basement → closet → garage → hallway → stairs → deck → pool → exterior_back → uncategorized.
- Within a slot, ascending `scene_number` (director's original choice).
- `runAssembly` hydrates `room_type` from `photos` table before ordering.

#### Phase 3 — duration enforcement

- `lib/assembly/duration-fit.ts` + 10 vitest cases.
- Reads `properties.selected_duration` (15/30/60); null = use natural sum (legacy path).
- Allocates `target / N` per clip, floored at 2.5s, capped at min(5s, source length).
- If even allocation drops below 2.5s, drops scenes by highlight tier until allocation ≥ MIN. Tier 1 always-keep: aerial, exterior_front, living_room, kitchen, master_bedroom, exterior_back. Tier 2 keep-if-room: dining, bedroom, bathroom, pool, deck. Tier 3 filler. Tier 4 uncategorized.
- Walkthrough order preserved within survivors.

#### Phase 4 — brokerage logo + brand color

- `lib/assembly/branding.ts`.
- Resolves logo + colors via `properties.submitted_by` → `user_profiles.brokerage / logo_url / colors (jsonb)`.
- Falls back through layers: user_profile → property.brokerage text → emerald (`#10b981`) + white defaults.
- Logo renders as top-right corner watermark; primary color tints the closing accent bar.
- `colors` JSONB validated with hex regex; bad values fall back to defaults silently.

#### Phase 5 — music library

- `lib/assembly/music.ts` + 6 vitest cases.
- Migration 055: `music_tracks` table + 5 seed rows + `properties.music_track_id` FK.
- Operator-pinned (`properties.music_track_id`) wins, else auto-pick by package mood.
- Mood map: `just_listed → upbeat`, `just_pended → cinematic`, `just_closed → celebratory`, `life_cycle → warm`, else `neutral`.
- **Seed URLs are SoundHelix placeholders.** Replace with real royalty-free MP3s in Supabase Storage before launch.

#### Creatomate template-mode

- `lib/providers/creatomate.ts`:
  - `assembleFromTemplate(templateId, { modifications, width, height, renderScale })` — uses `/v2/renders` with `template_id + modifications` body shape. Forces `render_scale: 1` to override the account's draft default.
  - `getTemplate(id)` — fetches metadata from `/v1/templates/:id` for placeholder introspection.
- `lib/assembly/template-modifications.ts` + 13 vitest cases.
  - Maps `AssembleVideoParams + branding + package` → modification dict.
  - Splits address on last comma (`"123 Waymay Dr, Punta Gorda FL"` → `["123 Waymay Dr", "Punta Gorda FL"]`).
  - Package label: `just_listed → "Just Listed"`, etc.
  - Writes 5 text fields + optional `Clip-1.source` … `Clip-N.source` (hyphenated per Just Listed #01 convention) + optional `LogoImage.source` + `MusicTrack.source` when present.
- `lib/assembly/template-resolver.ts` + 8 vitest cases.
  - Resolution priority: `properties.template_id` override > `CREATOMATE_TEMPLATE_ID_<PKG>` env > `_DEFAULT` env > null.
  - When null, `runAssembly` falls back to code-generated `buildCreatomateTimeline`.
- `runAssembly` branches at the provider call: template id resolved → `assembleFromTemplate(... width: 1920, height: 1080, renderScale: 1)` (or 1080×1920 for vertical); else → code-generated path.
- Migration 056: `properties.template_id text`.

#### Mid-session bugs found + fixed

- **`processing_time_ms` int4 overflow** on weeks-old properties (`pipeline.ts`). The smoke property was created 30+ days ago, so `Date.now() - new Date(property.created_at).getTime()` exceeded `2^31-1`. Now reads `pipeline_started_at` first; clamps to int4 max as a safety belt.
- **`assembly-router.ts` `require()` imports broke ESM/tsx runtime.** Original WIP used `require("./creatomate.js")` inside an async function, which works under some Node CJS modes but throws `require is not defined` under tsx ESM. Converted to top-level static imports. (Both modules are tiny; eager import has no cost.)
- **Creatomate `/v2/renders` source-mode returned JPG thumbnails / 5-second drafts.** Two root causes:
  1. The request body wrapped the RenderScript as `{ source: renderScript }` — that's the v1 convention. `/v2/renders` silently falls back to a default placeholder when the body is wrapped this way. Fix: spread the RenderScript at the top level alongside `render_scale: 1`.
  2. `buildCreatomateTimeline` didn't set top-level `duration` on the RenderScript. `/v2/renders` defaults to a 5-second clip when this is omitted regardless of how long the elements actually play. Fix: explicit `duration: totalDuration`.
- **Template clip-slot naming mismatch.** Oliver's Just Listed #01 template uses `Clip-1` … `Clip-8` (hyphenated); the modifications mapper was writing `Clip1` … `ClipN`. Creatomate silently ignored the unknown keys; clips disappeared from output. Fix: switched mapper to `Clip-${i+1}` naming.

### Shotstack parallel port (PR #38, second half)

- Decision point: Oliver flagged Creatomate's UX as frustrating and proposed switching to Shotstack. I initially pushed back (incorrectly claiming Shotstack had no visual editor); Oliver corrected me + asked me to fact-check via Gemini. Gemini's web search confirmed: Shotstack Studio is real, with merge-field templates and a Studio SDK for white-labeling.
- Updated take: both platforms can do what we need. Creatomate is "designer-friendly" with richer creative tooling (keyframes, blend modes, responsive scaling). Shotstack is "developer-first" with a code-friendly Edit API.
- Oliver chose: keep both wired in parallel for A/B comparison, no full migration.
- Port: `lib/providers/shotstack.ts::buildShotstackJustListedTimeline` mirrors the Creatomate Just Listed layout using Shotstack HTML clips for full Inter+CSS styling control. 8 clip slots back-to-back, hard cuts, opening overlay (category title + street + city/state + accent line), closing overlay (agent + brokerage + accent line). No Shotstack Studio template required — layout lives in code.
- `assembly-router.ts` gains a new `ASSEMBLY_PROVIDER` env var. When set to `"creatomate"` or `"shotstack"`, forces `runAssembly` to that provider regardless of the default Creatomate-first priority. Throws if the requested provider's API key is missing.
- Vercel envs set across all 3 environments: `SHOTSTACK_API_KEY`, `SHOTSTACK_ENV=production`.

### Cascade dev → staging → main (PRs #40, #41, #42)

- PR #40 (`cd1f25c`): dev → staging. Merge conflict on `docs/HANDOFF.md` resolved in branch.
- PR #41 (`4328d1c`): staging → main. **Production live.**
- PR #42: HANDOFF shipping-log entry per CLAUDE.md ship-gate rule.

## Smoke results

Real Kling clips from prop `6f508e16` ("Smoketest Lane"), 7 qc_pass clips totaling 25s of natural footage:

| Path | Output |
|---|---|
| Creatomate source-mode 15s tier | 1920×1080 @ 30fps, 15.0s full duration, 8.0 MB ✓ |
| Creatomate source-mode 30s tier | 1920×1080 @ 30fps, 25.0s (capped at source length), 13.6 MB ✓ |
| Creatomate template-mode (Just Listed #01) | 1280×720 (template canvas) @ 24fps, full 27.8s, 7.95 MB ✓ |
| Shotstack code-defined Just Listed | 1920×1080, 25s, MP4 ✓ |
| `runAssembly` end-to-end against real DB property | status `qc → assembling → complete`, both URLs populated, 2 `cost_events` rows with `provider='creatomate'`, 76¢ each ✓ |

## Migrations applied

All applied to prod Supabase via MCP, verified via `information_schema` queries.

- **053** `properties.assembly_timeline jsonb` + `assembly_timeline_version int` + `assembly_provider text DEFAULT 'shotstack'`. `video_revisions` table for the future revision-chatbot history. `cost_events_provider_check` widened to include `'creatomate'`. (Original WIP migration dropped the CHECK constraint without re-adding it — caught and fixed before apply.)
- **054** 9 order-form columns on `properties` with CHECK constraints.
- **055** `music_tracks` table + 5 seed rows + `properties.music_track_id` FK.
- **056** `properties.template_id text` per-property override.

## Vercel env vars set (production / preview / development)

- `CREATOMATE_API_KEY`
- `CREATOMATE_TEMPLATE_ID_JUST_LISTED=2f634180-1e85-4f11-b500-2bb57b277581`
- `SHOTSTACK_API_KEY`
- `SHOTSTACK_ENV=production`

## What an order on listingelevate.com produces now

1. Form submit → 9 order-form fields persist to `properties` ✓
2. Pipeline runs: analysis (Gemini 3 Flash) → style guide → scripting (Sonnet) → generation submit
3. Cron `poll-scenes.ts` polls Kling, collects clips, when all settled invokes `runAssembly`
4. `runAssembly` hydrates room_type → orders walkthrough → fits to `selected_duration` → pulls branding → picks music → resolves template_id (just_listed → Just Listed #01)
5. `assembleFromTemplate` runs once for 16:9 + once for 9:16
6. `horizontal_video_url` + `vertical_video_url` + `assembly_timeline` + `thumbnail_url` populated; 2 `cost_events` rows recorded; status → `complete`

## Known caveats live in prod (none blocking functionality)

- **Just Listed #01 template canvas is 1280×720** → output is 720p, not 1080p. Editor bump still pending on Oliver's side.
- **Template has 8 clip slots, pipeline targets 12** — if a listing has 12 qc_passed scenes, 4 get silently dropped. Either bump the template or accept truncation.
- **Template has no `MusicTrack` or `LogoImage` slots** — music auto-picked + logo auto-pulled but neither renders in the current template. The modifications mapper sends the data; template ignores unknown keys.
- **Only `just_listed` has a template wired.** `just_pended` / `just_closed` / `life_cycle` orders fall back to the code-generated `buildCreatomateTimeline` path (basic intro/outro layout).
- **No delivery notification.** Agent sees `complete` in the dashboard but gets no email / SMS — that's a separate workstream (#3 Eleven Labs already on the list, plus a delivery pipeline yet to be designed).

## Files changed (final state on `main`)

```
api/cron/poll-scenes.ts                          + cron-assembly wire
api/properties/index.ts                          + 9 order-form fields
docs/HANDOFF.md                                  + Right now + shipping log
lib/assembly/branding.ts                         NEW
lib/assembly/duration-fit.ts                     NEW (+ test, 10 cases)
lib/assembly/music.ts                            NEW (+ test, 6 cases)
lib/assembly/scene-ordering.ts                   NEW (+ test, 11 cases)
lib/assembly/template-modifications.ts           NEW (+ test, 13 cases)
lib/assembly/template-resolver.ts                NEW (+ test, 8 cases)
lib/db.ts                                        widened createProperty + recordCostEvent
lib/pipeline.ts                                  runAssembly export + Phase 2-6 wire + bug fixes
lib/providers/assembly-router.ts                 selectAssemblyProvider + ASSEMBLY_PROVIDER override
lib/providers/creatomate.ts                      NEW (template-mode + source-mode + getTemplate)
lib/providers/shotstack.ts                       buildShotstackJustListedTimeline + HTML clip type
lib/types.ts                                     Property + 9 order-form columns
lib/video-editor/types.ts                        NEW (revision-engine types)
src/lib/api.ts                                   createProperty client signature widened
src/pages/Upload.tsx                             handleSubmit passes 9 fields
supabase/migrations/053_video_revisions.sql      NEW
supabase/migrations/054_properties_order_form.sql NEW
supabase/migrations/055_music_tracks.sql         NEW
supabase/migrations/056_properties_template_id   (applied via MCP only — no file in repo)
scripts/smoke-runassembly.ts                     NEW
scripts/test-creatomate.ts                       NEW
scripts/test-creatomate-template.ts              NEW
scripts/test-real-property.ts                    NEW
scripts/test-shotstack-just-listed.ts            NEW
scripts/test-template-with-clips.ts              NEW
.env.example                                     + Creatomate / Shotstack / ASSEMBLY_PROVIDER docs
.gitignore                                       + .superpowers/ + le-1/
```

## Commits on `feat/creatomate-buildout` (PR #38 timeline)

```
91ce14e  feat(assembly): Shotstack Just Listed port + ASSEMBLY_PROVIDER override
2efc47d  revert(template-mods): keep agent + brokerage as separate fields
f29bcf2  feat(template-mods): combine agent + brokerage into single centered line   (reverted)
823982c  fix(template-mods): hyphenated Clip-N naming + smoke with real clips
36ec083  fix(creatomate): unblock /v2 source-mode — drop `source:` wrapper + set duration
9f05fa3  feat(assembly): Phase 2-6 + Creatomate template-mode
b91be48  feat(assembly): Creatomate provider + cron-wire runAssembly + migration 053
afa198a  fix(pipeline): wire runAssembly into poll-scenes cron
```

## Post-launch action items (Oliver, none blocking)

1. **Bump Just Listed #01 template canvas to 1920×1080** in the Creatomate editor.
2. **Add `Clip-9` … `Clip-12` slots** to the template.
3. **Build Just Pended / Just Closed / Life Cycle template variants** + set their IDs as Vercel env vars (`CREATOMATE_TEMPLATE_ID_JUST_PENDED`, etc.).
4. **Replace `music_tracks` seed rows** (SoundHelix placeholders) with real royalty-free MP3s in Supabase Storage.
5. **Rotate the Shotstack API key** — was visible in chat history this session.

## Remaining pre-launch blockers from Oliver's 5

- ✅ **#2 Creatomate / template-driven assembly** — shipped
- ⏳ **#1 post-gen QC AI** — unblocked (we have `assembly_timeline` JSON to reason over)
- ⏳ **#3 Eleven Labs voiceover**
- ⏳ **#4 Music library** (placeholders in place; real tracks TBD)
- ⏳ **#5 Owner dashboard**

## Migration drift (still standing)

Repo migrations 050–052 (blog phase 5 + templates + AI) remain unapplied to prod. Remote has `portal_deliverables` / `portal_orders_checkout_session` / `050_portal_pay_on_approval` / `portal_orders_order_number_v2` with no migration files in the repo. Worth a dedicated audit before the next big push.
