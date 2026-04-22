# Listing Elevate — Handoff

Last updated: 2026-04-22

See also:
- [README.md](./README.md) — folder guide + session hygiene
- [state/PROJECT-STATE.md](./state/PROJECT-STATE.md) — authoritative state
- [plans/back-on-track-plan.md](./plans/back-on-track-plan.md) — condensed roadmap
- [specs/2026-04-20-back-on-track-design.md](./specs/2026-04-20-back-on-track-design.md) — full roadmap spec
- [audits/ML-AUDIT-2026-04-20.md](./audits/ML-AUDIT-2026-04-20.md) — Phase M.1 verdict
- [sessions/](./sessions/) — per-session notes

## Right now

**P1 V1 Foundation landed on main (2026-04-22).** V1 Prompt Lab is now the daily-driver iteration surface. Lab renders route through AtlasCloud with `kling-v2-6-pro` default. Every iteration captures its SKU via migration 031 (`model_used` + `sku_source`). Migration 032 widens `cost_events.provider` to include `atlas`/`google`/`higgsfield` so Lab cost tracking lands cleanly. IterationCard has per-iteration SKU selector + cost chip + "Try another SKU" shortcut. TopNav renamed "Prompt Lab (legacy)" → "Prompt Lab"; Listings Lab (V2 paired-image) hidden from nav but direct URLs preserved. Canonical V1 vs V2 reference at [`state/MODEL-VERSIONS.md`](./state/MODEL-VERSIONS.md). Program spec for the next 2 weeks (P2–P7) at [`specs/2026-04-22-v1-primary-tool-and-ml-roadmap-design.md`](./specs/2026-04-22-v1-primary-tool-and-ml-roadmap-design.md) — supersedes the M.1-era back-on-track plan for all V1/ML work.

**2026-04-22 offline-session pre-cook (Oliver offline ~3h; coordinator advanced P2/P3/P5 skeletons on branches):**
- `session/p5-s1-implementation-draft` (`4ceb580`) — Thompson math kernel + migration 038 + 20/20 tests passing. Fully implementable (pure TS, no API surface). P5 S1 wires `pickArm` into router.
- `session/p2-s1-implementation-draft` (`171c260`) — Migration 033 + rubric module + validator (10/10 tests) + Gemini provider SKELETON (binding stubbed behind `JUDGE_ENABLED`). P2 S1 fills TODO block.
- `session/p3-s1-implementation-draft` (`255d265`) — Migration 034 + image-embed wrapper SKELETON + backfill script + 7/7 tests. Gemini binding stubbed behind `ENABLE_IMAGE_EMBEDDINGS`. P3 S1 fills TODO block.
- See [`sessions/2026-04-22-offline-work-questions.md`](./sessions/2026-04-22-offline-work-questions.md) for the full review queue.

**Pre-cooked design artifacts on parked branches (ready for integration at phase-scheduled sessions):**
- `session/p2-rubric-design` — P2 Gemini auto-judge rubric (JUDGE-RUBRIC-V1.md, 7 Qs resolved). Integrates at P2 S1 2026-04-23.
- `session/p3-embedding-preflight` — P3 image-embedding provider decision (Gemini 768-dim, 5 Qs resolved). Integrates at P3 S1 2026-04-25.
- `session/p5-thompson-design` — P5 Thompson router design (528-line spec, 6 Qs resolved). Integrates at P5 S1 2026-04-30.

**Migrations 031 + 032 committed on main but NOT yet applied to the Supabase DB.** Apply before next V1 render (P1 Task 12 smoke-render prerequisite + before any user hits the Lab, else render writes fail on missing columns / provider CHECK). Question Q-A1 in the offline-questions doc.

**Not pushed:** all 2026-04-22 commits are local. `origin/main` is 14 commits behind `main`. Push pending explicit approval (Q-A2/Q-A4).

## Plan state

Phases of the back-on-track plan (full spec at [`specs/2026-04-20-back-on-track-design.md`](./specs/2026-04-20-back-on-track-design.md)):

| Phase | Status | What |
|---|---|---|
| A — Lab UX spine | shipped | `NextActionBanner`, priority chips, optimistic updates |
| M.1 — Director-prompt trace audit | shipped | Learning loop verified working-with-gaps; full audit at [`audits/ML-AUDIT-2026-04-20.md`](./audits/ML-AUDIT-2026-04-20.md) |
| DQ — Director concise prompts | shipped | `DIRECTOR_SYSTEM` enforces ≤120/≤250 char prompts, stability prefix `kling-v3-*`-only, paired auto-route to `kling-v2-1-pair`, default model flipped to `kling-v2-6-pro` |
| DM — Dev/Legacy merge | shipped | One unified Lab UI, native Kling provider added (Oliver's pre-paid credits), Compare demoted, legacy Lab routes retired |
| CI — Cost integrity | shipped (CI.1–CI.5) | Model-aware Claude pricing, OpenAI embedding tracking, Shotstack per-minute, failed-render policy, dashboard drill-down |
| C — Production end-to-end | shipped | Router `ProviderDecision`, base64 → URL, duration-aware director, lazy failover Kling → Atlas |
| M.2 — ML consolidation | ✅ shipped | SKU capture, dead code removal, prod embedding backfill |
| B — Model head-to-head | superseded by 2026-04-22 V1 program | Phase B static-router approach replaced by P5 Thompson sampling (docs/specs/p5-thompson-router-design.md). Existing Window D Round 1/2 work parked on `session/router-2026-04-21`; v3-strip intent migrated into `V1_ATLAS_SKUS` allow-list. No fresh manual rating grid required — P5 bootstraps from organic V1 ratings |
| **P1 — V1 Foundation** | ✅ shipped (2026-04-22) | V1 Lab becomes daily driver: Atlas routing (kling-v2-6-pro default), SKU capture (migration 031), cost_events widened (migration 032), SKU selector + cost chip + try-another-SKU UI, TopNav rename, V1 trace mode, deferred UX plan |
| P2 — Gemini auto-judge | pre-cooked design (branch `session/p2-rubric-design`) | Rubric + 10-shot calibration pool ready. Implementation scheduled 2026-04-23 S1 + 2026-04-24 S2 |
| P3 — Retrieval upgrade | pre-cooked provider decision (branch `session/p3-embedding-preflight`) | Gemini gemini-embedding-2 768-dim. Implementation scheduled 2026-04-25–27 (3 sessions) |
| P4 — Scale hardening | per spec | Scheduled 2026-04-28–29 (2 sessions) |
| P5 — Thompson router | pre-cooked design (branch `session/p5-thompson-design`) | Bandit math + cold-start + rollout gate final. Implementation scheduled 2026-04-30–05-01 |
| P6 — Active learning + pairwise | per spec | Scheduled 2026-05-02 |
| P7 — Promote-to-prod flywheel | per spec | Ongoing runbook; activates ~2026-05-05 |

## Recent shipping log

(Newest on top. Append one line per push to `main`.)

- 2026-04-22 — `255d265` — **(branch `session/p3-s1-implementation-draft`)** feat(p3): image embeddings skeleton (migration 034, embedImage wrapper, backfill script, 7/7 tests). Binding stubbed behind ENABLE_IMAGE_EMBEDDINGS.
- 2026-04-22 — `171c260` — **(branch `session/p2-s1-implementation-draft`)** feat(p2): Gemini judge skeleton (migration 033, rubric module, validator 10/10 tests, stub provider). Binding stubbed behind JUDGE_ENABLED.
- 2026-04-22 — `4ceb580` — **(branch `session/p5-s1-implementation-draft`)** feat(p5): Thompson-sampling SKU router pure-logic module (migration 038, bandit math, 20/20 tests, refresh script). Fully implementable; wiring is P5 S1.
- 2026-04-22 — `5eb7fd4` — feat(p1): V1 Lab SKU selector + cost chip + try-another-SKU (tasks 15-16)
- 2026-04-22 — `133e058` — docs(state): P1 V1 Foundation closeout — HANDOFF + PROJECT-STATE
- 2026-04-22 — `ad63c6a` — migration 032: widen cost_events.provider CHECK for atlas/google/higgsfield (unblocks P1 cost-event emission)
- 2026-04-22 — `55491f0` — spec: V1 Prompt Lab UX plan (deferred, synthesized from Task 14 audit)
- 2026-04-22 — `3e9bf1d` — audit: kling v2-master vs v2-6-pro verdict — Validate-day-1
- 2026-04-22 — `15f0ec3` — audit: V1 Prompt Lab UX friction points (6 quick + 5 medium wins)
- 2026-04-22 — `3a56001` — ui(nav) + docs: rename "Prompt Lab (legacy)" → "Prompt Lab"; add MODEL-VERSIONS.md
- 2026-04-22 — `286b697` — feat(p1): V1 backend SKU threading + cost_events (submitLabRender sku param, AtlasProvider ctor arg, render/rerender endpoints, finalizeLabRender cost_events) — 80/80 tests
- 2026-04-22 — `8fcaaf9` — router: relocate V1 SKU constants to atlas.ts (co-located with ATLAS_MODELS)
- 2026-04-22 — `01d907f` — router(v1): SKU-aware resolveDecision + V1_DEFAULT_SKU = kling-v2-6-pro (+ 6 vitest tests)
- 2026-04-22 — `f3682e7` — migration(031): capture SKU + provenance on prompt_lab_iterations
- 2026-04-22 — `4a7f203` — docs(plan): V1 primary tool + ML roadmap spec (P1–P7 program) + P1 implementation plan + 2026-04-22 Window A coordinator handoff
- 2026-04-22 — `9322e55` — docs(sessions): park notes for ledger + router branches (v3-strip disposition noted; intent migrated into V1_ATLAS_SKUS)
- 2026-04-22 — `504e4ce` — docs(closeout): Window B session notes + render log from 2026-04-21
- 2026-04-21 — `d8ee57e` — Round 2 regression-diff HANDOFF/PROJECT-STATE/memory updates (Window B Round 2, 3/3)
- 2026-04-21 — `e023ff9` — DA.1 regression-diff verdict doc — NECESSARY BUT NOT SUFFICIENT pending Oliver rating (Window B Round 2, 2/3)
- 2026-04-21 — `bfc7eed` — Round 2 regression-diff render harness (Window B Round 2, 1/3)
- 2026-04-21 — `1653606` — Window C Rating Ledger UI: `/dashboard/rating-ledger` + `/api/admin/rating-ledger` (unified legacy Lab + Listings Lab + prod scene_ratings, with retrieval-status chip)
- 2026-04-21 — `6c7cc6d` — DA.1 smoke tests + cost-reconcile note + STACK update (Window B, 5/5)
- 2026-04-21 — `47010d4` — DA.1 Gemini-first prod + Lab analysis + DA.3 motion_headroom validator (Window B, 4/5)
- 2026-04-21 — `921c3dd` — DA.2 director motion_headroom hard bans + camera-state block (Window B, 3/5)
- 2026-04-21 — `ae25541` — DA.1 Gemini 3 Flash analyzer with motion_headroom + @google/genai dep (Window B, 2/5)
- 2026-04-21 — `9fae141` — DA.1 migration 030 photos.analysis_json + analysis_provider (Window B, 1/5)
- 2026-04-21 — Window D Round 1: router-table audit — existing signal insufficient for SKU routing (32 buckets, 0 winners, 32% SKU-granular); draft file empty, not wired; coverage report at `docs/audits/router-coverage-2026-04-21.md`
- 2026-04-21 — `5b07ce3` — M.2 backfill script widened to all unembedded scenes (17/24 embedded)
- 2026-04-21 — `f1bf53a` — M.2b removed dead match_lab_iterations RPC + prompt-qa dead code
- 2026-04-21 — `1938317` — M.2d exemplar/recipe/loser blocks now surface model_used SKU to director
- 2026-04-21 — `90a00cb` — M.2d SKU capture in recipes + retrieval (migration 028 applied)
- 2026-04-21 — `7a7dc6e` — DM.6 legacy Lab UI routes recommit (missed in d9e6f1f)
- 2026-04-21 — `dc27158` — docs consolidation; new canonical `docs/` structure; archive folder; session hygiene written into [`README.md`](./README.md)
- 2026-04-20 — `9283260` — Phase C production end-to-end (router swap, base64 → URL, duration-aware director)
- 2026-04-20 — `0b020f3` — CI.5 cost dashboard drill-down
- 2026-04-20 — `82fec7c` — docs update (PROJECT-STATE / TODO / STACK)
- 2026-04-20 — `3c392cf` — CI.3 + CI.4 Shotstack per-minute + failed-render cost tracking
- 2026-04-20 — `2079822` — CI.2 OpenAI embedding cost tracking
- 2026-04-20 — `464f25d` — CI.1 model-aware Claude pricing
- 2026-04-20 — `8a06b66` — DM.3 + DM.4 native Kling routing with Atlas failover
- 2026-04-20 — `d9e6f1f` — DM.6 retire legacy Prompt Lab UI routes
- 2026-04-20 — `1e8893f` — DQ.2/3/5 stability-prefix gating, paired auto-route, notes rewrite
- 2026-04-20 — `734afa9` — DQ.1 director concise-prompt rewrite
- 2026-04-20 — `6fceb2c` — DQ.4 default new listings to `kling-v2-6-pro`
- 2026-04-20 — `124adfc` — Atlas cost tracking fix (per-SKU × duration)
- 2026-04-20 — `41e4290` + `6b5da62` — Phase M.1 audit verdict recorded
- 2026-04-20 — `858577c` / `d6c57a0` / `9995657` / `7818cfd` — Phase A (Lab UX spine)

## Known gotchas

- **File-revert mystery in this repo** — during one session in 2026-04-13, file edits got silently reverted by an unknown process. Dormant since but watch for it. Commit often; keep a memory backup of in-flight work.
- **Production `properties.selected_duration` column does not exist yet.** Phase C pipeline reads optimistically with `maybeSingle()` and logs a warn + defaults to 60s until the order-form persistence work lands.
- **Atlas pricing** for `v2.6-pro` was initially miscalibrated at 2× under. Now `$0.60/clip` confirmed. Other SKUs may still need invoice verification — see [`specs/2026-04-20-back-on-track-design.md`](./specs/2026-04-20-back-on-track-design.md) Phase CI notes.
- **Kling v3 shake issue** on single-image shots. Stability prefix (`CAMERA_STABILITY_PREFIX`) is applied only for `kling-v3-*` models after DQ; Atlas negative prompt is always applied.
- **Lab → prod promotion has never been used** — 0 overrides ever promoted per Phase M.1 audit. Signal is there but no one is turning recipes into active router directives. M.2 and B close this.
- **Prod scene embeddings** — all 24/24 scenes embedded after M.2 backfill (2026-04-21). Backfill script widened to all prod scenes (not just rated ones).

## Oliver's standing preferences

- Plain language, bottom-line, no jargon.
- **No git push / no Vercel deploy without explicit in-turn permission for destructive operations.** Blanket "direct-to-main" granted for routine current work — still ask on anything destructive (force push, rebase pushed history, column drops, file deletion outside the `archive/` pattern).
- Higher models (Opus) for design/audit tasks; Sonnet for implementation; Haiku only for trivial mechanical work.
- Cost tracking is first-class — every API call logs a `cost_event`, even $0 ones. Don't ship with null/0 cost fields on finalized renders.
- Efficient execution. Minimal questions. Pick the best path and proceed.

## Cross-repo state

Three working copies exist on disk, all pointing at the same GitHub repo (`theolivercollins/reelready`) on different branches:

| Path | Branch | Status |
|---|---|---|
| `/Users/oliverhelgemo/real-estate-pipeline` | `main` | **active** — all work lands here |
| `/Users/oliverhelgemo/real-estate-pipeline-finances` | `finances-tab` | stale side-branch clone — do NOT push. Latest commit `66135be` (finances-tab work, mid-April). Useful only as reference. |
| `/Users/oliverhelgemo/real-estate-pipeline-ui` | `ui-redesign` | stale side-branch clone — do NOT push. Latest commit `e54b2f2`. Older than main. |

Snapshots of the stale forks' `docs/` live under [`archive/forks/`](./archive/forks/) for historical record.

## Next session checklist

When you pick this up:
1. Read [`README.md`](./README.md) → this file → [`state/PROJECT-STATE.md`](./state/PROJECT-STATE.md) → [`plans/back-on-track-plan.md`](./plans/back-on-track-plan.md).
2. Confirm with Oliver whether Phase M.2 is re-dispatched or skipped before starting implementation.
3. Any push to `main` → append a line to "Recent shipping log" above AND update "Right now" if the next action changed.
4. Use the `superpowers` plugin for planning + execution. Don't freelance.
