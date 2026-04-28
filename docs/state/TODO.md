# TODO

Last updated: 2026-04-28

See also:
- [../HANDOFF.md](../HANDOFF.md) — current next action + shipping log
- [PROJECT-STATE.md](./PROJECT-STATE.md) — authoritative project state
- [../plans/back-on-track-plan.md](../plans/back-on-track-plan.md) — active roadmap
- [../plans/FUTURE-PLANS.md](../plans/FUTURE-PLANS.md) — post-mastery backlog

(The legacy Prompt Lab roadmap has been archived at `../archive/superseded-docs/PROMPT-LAB-PLAN.md` — the new listings Lab is the active surface.)

## 2026-04-28 — opened by ledger-driven system update + cost-tracking fix

- [ ] **Review pending proposal `c0708a98-dd6f-4f99-9741-817726180243`** at `/dashboard/development/proposals` and promote the patches you trust (6 director-system patches mined from 196 ratings). Promotion mutates production director on next render via `resolveProductionPrompt`.
- [ ] **Bump `api/admin/prompt-lab/mine.ts` `max_tokens` 8192 → 32768** (or batch evidence by bucket). Today's prod-endpoint run would silently truncate at scale; the one-off `scripts/oneoff/run-mine-now.ts` already uses 32k as a workaround.
- [ ] **Re-run mine + `refresh-router-bucket-stats.ts --write` in ~2 weeks** once more manual ratings accumulate. Diff today's proposed changes vs new ones to confirm the loop is converging, not oscillating.
- [ ] **When ready to flip on the Gemini judge:** `vercel env add JUDGE_ENABLED true production` AND flip `system_flags.judge_cron_paused = false` via System Status UI. Both gates currently OFF by design.

## Critical (blocking quality)

- [ ] **Production pipeline base64→URL fix** — 4 places in `lib/pipeline.ts` still send base64. Lab is fixed (URL-based); prod needs the same treatment. Tracked as Phase C scope.

## High priority

- [ ] **CI.5 cost dashboard drill-down** — per-listing + per-batch breakdown UI with provider/SKU detail and links to `cost_events` rows. In progress.
- [ ] **Phase M.2a–d — ML consolidation + SKU capture**
  - M.2a: backfill prod scene embeddings (7/24 → 24/24)
  - M.2b: stop writing deprecated capture fields (`tags`, `refinement_instruction`)
  - M.2c: UI nudge when Lab overrides become promotable
  - M.2d: migration 028 — `model_used` on `prompt_lab_recipes`; retrieval surfaces winning SKU to director
- [ ] **Phase B — model head-to-head** — one fresh listing, Generate-all across all SKUs, rate every iteration; cost tracking now reliable.
- [ ] **Phase C — production end-to-end** — router swap (Atlas + native Kling + Runway), production base64→URL fix, duration-aware director (15s=4 scenes, 30s=6–8, 60s=12)

## Phase 3 prerequisites (autonomous iterator foundations)

- [ ] **Expanded v_rated_pool usage** — autonomous iterator will need it for scene-level decisions (which model performs best on kitchens, etc.). Build `rated-pool-analytics.ts` helpers.
- [ ] **Budget + stop conditions** — per-listing and per-scene spend caps, stop at 4★+ reached or N iterations. Needed before enabling any autonomous loop.
- [ ] **Scene prioritization logic** — which scene does the iterator tackle first? Lowest best-rating? Most variance across iterations? Oldest unreviewed?

## Medium priority

- [ ] **Spatial grounding** — designed in `docs/superpowers/specs/2026-04-15-spatial-grounding-design.md`. Coordinate-level composition awareness for motion planning. Plan at `docs/superpowers/plans/2026-04-15-spatial-grounding.md`. PAUSED.
- [ ] **Shotstack assembly for Lab listings** — listings Lab produces standalone iterations only. Wire in a "Assemble listing" action composing top-rated iteration per scene into a final walkthrough.
- [ ] **Client-side photo compression** — resize to 2048px / JPEG 85 before upload to cut transfer + storage cost.
- [ ] **Delete legacy iteration chat UI path** — endpoint + DB column still exist but unused. Once confident, remove.

## Medium priority

- [ ] **Supabase Realtime subscriptions** — dashboard polls every 5s (listing detail while analyzing/directing/rendering). Switch to Realtime for cheaper live updates.
- [ ] **daily_stats aggregation cron** — table exists, nothing populates it.
- [ ] **Hourly throughput stats endpoint** — Overview dashboard chart.
- [ ] **Settings page backend** — persist to DB (currently React state only).
- [ ] **Recipe analytics for listings Lab** — surface which recipes have highest hit rate on listings (times_applied count already exists).
- [ ] **Iteration-chat history viewer** — data still in `prompt_lab_listing_scene_iterations.chat_messages`; no UI surfaces it since scene chat is primary.

## Deferred / Phase 2 post-mastery

- [ ] **Shotstack reverse clips** — push_in/pull_out rhythm in assembled videos. Discussed; not built.
- [ ] **Email delivery (Resend)** — notify submitting agent when a video is complete.
- [ ] **Order form persistence** — agent order form saves to DB.
- [ ] **Eleven Labs voiceover** — AI narration track on assembled videos.
- [ ] **Brokerage branding** — logo + brand colors per brokerage, overlaid on video.
- [ ] **Feature shots** — dedicated hero-clip generation for standout features (pool, view, kitchen island).
- [ ] **Music pipeline** — beat detection, licensed track selection, sync transitions to beat.
- [ ] **Full automated QC (production)** — frame extraction needs FFmpeg. Options: Vercel Sandbox, external frame API, self-hosted worker.
- [ ] **Additional providers** — Pika, Seadance. Higgsfield deferred permanently.
- [ ] **Smart vertical cropping** — subject-aware offset for 9:16.
- [ ] **Auth upgrade** — agent accounts, operator accounts, API keys.
- [ ] **Visual-embedding option for Lab** — embed the IMAGE not just the analysis text. Higher fidelity, more cost.
- [ ] **Clean up `match_lab_iterations` RPC** — unused since unified embeddings shipped. Still in DB.

## Done 2026-04-20 (back-on-track phases A / M.1 / DQ / DM / CI)

### Phase A — Lab UX next-action spine
- [x] `NextActionBanner` component — colored per state, one-click advances next stuck scene (`14bdfed`, `858577c`)
- [x] Per-scene status chips in `ShotPlanTable` (`needs_rating / failed / iterating / needs_first_render / rendering / done / archived`), rows priority-sorted (`eff932a`)
- [x] Pure resolvers `src/lib/labSceneStatus.ts` + `src/lib/labNextAction.ts` — 17 unit tests (`ae1bfa6`, `53c7c4b`, `d6c57a0`)
- [x] Optimistic rate + scene-archive mutations in `LabListingDetail.tsx` (`7818cfd`, `9995657`)
- [x] `SceneCard` `data-scene-id` attribute for scroll-to behavior
- [x] Resolver patch: "iterating" triggers when all iterations rated but none hit 4★+
- [x] Done color changed emerald → slate (grey) to distinguish from teal "rate"

### Phase M.1 — Director-prompt trace audit
- [x] `scripts/trace-director-prompt.ts` + `scripts/trace-director-prompt.impl.ts` — reconstructs director user message, runs retrieval RPCs live, writes `/tmp/director-trace-<id>.md`
- [x] Verdict: WORKING WITH GAPS — 108 rated legacy iterations feeding retrieval; Lab→prod promotion never used (0 promoted); prod scene embeddings 7/24 partial
- [x] Full report at `docs/ML-AUDIT-2026-04-20.md`; raw traces at `docs/traces/`

### Phase DQ — Director concise prompts
- [x] `DIRECTOR_SYSTEM` rewritten: PROMPT STYLE section (≤120 chars single-image, ≤250 paired), banned phrases, legacy 5★ examples as patterns, "exemplars are CONTENT patterns not LENGTH permission" guardrail
- [x] `CAMERA_STABILITY_PREFIX` gated to `kling-v3-*` only (DQ.2) (`1e8893f`)
- [x] Paired scenes auto-route to `kling-v2-1-pair` unless caller picks models (DQ.3) (`1e8893f`)
- [x] Default model changed `kling-v3-pro` → `kling-v2-6-pro` (DQ.4) (`6fceb2c`)
- [x] `lib/refine-prompt.ts` — Sonnet 4.6 prompt rewrite incorporating refinement_notes at render time (DQ.5) (`1e8893f`)

### Phase DM — Dev / Legacy merge
- [x] `lib/sanitize-prompt.ts` — strips `LOCKED-OFF CAMERA…` variants on write + render
- [x] Scene Editor Haiku 4.5 system prompt: PROMPT STYLE rules (char limits, banned phrases, GOOD/BAD examples, "DO NOT include LOCKED-OFF CAMERA")
- [x] "Compare models" demoted to `More ▾` dropdown; Submit has `window.confirm()` dollar total; Render button shows SKU + cost inline; Render-all shows multi-SKU total
- [x] Native Kling (`kling-v2-native`) added — first in picker, routes via `lib/providers/kling.ts`, pre-paid credits, auto-failover to Atlas v2-master on 402 (`8a06b66`)
- [x] `lib/providers/dispatch.ts` — `pickProvider(modelKey)` + `isNativeKling(modelKey)` (`8a06b66`)
- [x] Legacy Lab UI retired: `/dashboard/development/prompt-lab/*` redirects to lab; `PromptLab.tsx` + `PromptLabRecipes.tsx` dead code (`d9e6f1f`)

### Phase CI — Cost Integrity (CI.1–CI.4)
- [x] CI.1: `computeClaudeCost(usage, model)` — rate tables Opus 4.x / Sonnet 4.x / Haiku 4.5; all call sites pass model; scene/iteration chat, rule mining, director, refine-prompt log `cost_events` (`464f25d`)
- [x] CI.2: `embedText` returns `usage.costCents`; 5 call sites log `cost_events` with `provider='openai', stage='embedding'` (`2079822`)
- [x] CI.3: `shotstackCostCents(durationSeconds)` = ceil(minutes) × 20¢; replaces flat 10¢ constant; uses API-returned duration (`3c392cf`)
- [x] CI.4: Atlas failed renders log full SKU cost (`render_outcome='failed'`); native Kling failed renders log $0 (`prepaid_credits_failed_refunded`) (`3c392cf`)
- [x] Atlas v2.6-pro pricing correction: $0.60/clip (was $0.30); `priceCentsPerSecond: 12, priceCentsPerClip: 60`; 12 historical rows backfilled (`124adfc`)
- [x] `scripts/cost-reconcile.ts` — dump cost_events by provider/SKU for date range
- [x] Bug fix: Atlas cost two compounding bugs fixed (SKU lookup + per-clip vs per-second rate) (`124adfc`)
- [x] Bug fix: Scene Editor writing 400+ char verbose trajectories with stability prefix — fixed on 3 layers

## Done 2026-04-20 (evening — Phase 2.8 Listings Lab)

- [x] Atlas Cloud integration — 6 Kling SKUs registered (v3-pro, v3-std, v2.6-pro, v2.1-pair, v2-master, o3-pro); Wan 2.7 removed
- [x] Atlas output-URL parser fix — handles `outputs: string[]` (Atlas actual shape) in addition to `Array<{url}>`. All prior "finished without an output URL" iterations recovered.
- [x] Migration 023 — 4 new tables for listings Lab; `v_rated_pool` extended with 3rd UNION branch
- [x] Migration 024 — iteration.chat_messages, scene.refinement_notes
- [x] Migration 025 — scene.use_end_frame; backfill `false` for end_photo_id IS NULL
- [x] Migration 026 — scene.chat_messages, iteration.archived, iteration.rating_reasons
- [x] Migration 027 — scene.archived
- [x] Cron-based listing lifecycle — `poll-listing-lifecycle` + `poll-listing-iterations` (fire-and-forget doesn't survive Vercel)
- [x] Scene-level streaming chat (Haiku 4.5) with `save_future_instruction` + `update_director_prompt` tools
- [x] Rating reasons modal + fixed taxonomy (6 positive / 15 negative / other)
- [x] Scene archive (hide from shot plan) + iteration archive (soft hide, keeps signal)
- [x] End-frame toggle; stop auto-cropping on unpaired scenes
- [x] Shake mitigation — stability prefix + negative_prompt on every Atlas render
- [x] Recipe + exemplar + loser retrieval restored in listings director (reads `prompt_lab_recipes`, `v_rated_pool`)
- [x] Per-iteration actions — Regenerate, Show prompt, Copy, Archive, Delete
- [x] Generate-all-models modal + A/B/C/D Compare modal
- [x] Master-detail UI — ShotPlanTable + focused SceneCard; newest iteration auto-expanded, others collapsed
- [x] Per-scene end-frame chip, Render-all skips archived scenes
- [x] LabListingNew default-model picker — all 6 Kling options with prices

## Done 2026-04-20 (morning — legacy Lab)

- [x] Banner system overhaul — "Generation approval needed" (sky blue) + "Iteration approval needed" (teal), based on latest iteration only; card sorting by priority within batches
- [x] 4★ backup recipes — auto-promote 4★ as backup (`backup_` archetype prefix, `rating_at_promotion=4`); 4★+ marks session completed
- [x] Refine from any iteration — refine controls ungated from `isLatest`; can branch from older iterations
- [x] Recipe dedup fully removed — dropped `prompt_lab_recipes_source_iteration_unique` index; every 4★+ promotes unconditionally
- [x] Production readiness merge — migrations 014–017, error classification, resolveProductionPrompt, resubmit endpoint, promote-to-prod endpoint, smart failover, Shotstack cost tracking, dashboard resubmit buttons
- [x] Bug fix: duplicate recipe 500 on double-click
- [x] Bug fix: SyntaxError in sessions.ts from conflict resolution

## Done 2026-04-19 (production-readiness merge, commit 65dcc7d)

- [x] scene_ratings denormalization — migration 014
- [x] Failover error classification — `lib/providers/errors.ts`
- [x] Shotstack cost tracking — migration 017
- [x] Retry-scene endpoint (production) — `api/scenes/[id]/resubmit.ts`
- [x] Lab→prod promotion flow — `promote-to-prod.ts` + `resolveProductionPrompt` + migration 016
- [x] Refiner rationale split — migration 015
- [x] Migrations 014–017

## Done 2026-04-15 through 2026-04-19

- [x] Unified embeddings — `scenes.embedding` + HNSW + `match_rated_examples` + backfill
- [x] Negative signal — `match_loser_examples` + "AVOID THESE PATTERNS" block
- [x] "DO NOT REPEAT" block — prior non-5★ prompts injected on re-analyze
- [x] Kling concurrency guard — `countKlingInFlight()`, auto-fallback, render queue
- [x] Re-render with different provider — `rerender.ts`
- [x] Recipe improvements — dedup removed, auto-fill archetype, green success banner
- [x] Organize mode + archive — multi-select, batch move, archive/unarchive
- [x] Lab analyze + render >5MB photos — URL-based input
- [x] Rating on any iteration — ungated from `isLatest`
- [x] Migrations 009–013

## Done 2026-04-14 PM

- [x] Director: reveal foreground must appear in key_features (M2B)
- [x] Prompt Lab core (M-Lab-1 through M-Lab-4)
- [x] Prompt Lab learning loop — pgvector + similarity retrieval + auto-promote recipes + rule mining
- [x] Async Lab renders + cron finalizer
- [x] Drag-drop batches + filter chips + Completed badge + Ready for approval state
- [x] Development dashboard + session notes + nav reorg

## Done earlier

See `docs/PROJECT-STATE.md` "What shipped" sections for full history.
