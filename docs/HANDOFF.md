# Listing Elevate — Handoff

Last updated: 2026-05-06

See also:
- [README.md](./README.md) — folder guide + session hygiene
- [state/PROJECT-STATE.md](./state/PROJECT-STATE.md) — authoritative state
- [plans/back-on-track-plan.md](./plans/back-on-track-plan.md) — condensed roadmap
- [specs/2026-05-05-listing-elevate-consolidation-design.md](./specs/2026-05-05-listing-elevate-consolidation-design.md) — repo + 3-tier deploy + governance overhaul
- [specs/2026-04-20-back-on-track-design.md](./specs/2026-04-20-back-on-track-design.md) — full roadmap spec
- [audits/ML-AUDIT-2026-04-20.md](./audits/ML-AUDIT-2026-04-20.md) — Phase M.1 verdict
- [sessions/](./sessions/) — per-session notes
- `../CLAUDE.md` — session-start brief; read this before doing anything

## Right now

**2026-05-10: Portal Phase 2 implementation landed on `feat/portal-deliverables` — pay-on-approval, deliverables, review page. 24 commits, tsc clean, 229/230 vitest pass (1 preexisting flake in MarketComparison.test.tsx, unrelated). NOT yet promoted: staging smoke required before `dev → staging → main`.**

Spec: [`specs/2026-05-10-portal-deliverables-phase-2-design.md`](./specs/2026-05-10-portal-deliverables-phase-2-design.md). Plan: [`plans/2026-05-10-portal-deliverables-phase-2.md`](./plans/2026-05-10-portal-deliverables-phase-2.md). Style guide: [`DESIGN_STYLE.md`](./DESIGN_STYLE.md).

**What shipped (commits `0b14488` … `ef7da91`):**

- **Migration 050** — added `awaiting_delivery` to `portal_orders.status` CHECK, `approved_at` timestamp, `upload_status` on versions (pending/uploaded/failed) + index. Storage bucket `deliverables` created (private).
- **State machine** — `lib/portal/state.ts` exports `computeNextOrderStatus(current, event)` as the single source of truth. 12 vitest cases cover every legal + illegal transition.
- **Storage helpers** — `lib/portal/storage.ts` for signed upload / stream / download URLs + object path. Direct browser → Supabase uploads via signed URL (bypasses Vercel function body limits).
- **Phase 1 surgery** — onboarding POST no longer creates a PaymentIntent; orders now flip to `awaiting_delivery` after billing details land. Frontend stripped of Payment Element / Elements / `loadStripe`. **Existing success-view copy preserved per Oliver's instruction** (still says "A receipt from Recasi Media is on its way…" — see Known issues below).
- **Owner-side API** — `POST .../deliverables`, `POST .../versions` (returns signed upload URL), `POST .../versions/[vid]/finalize`, `DELETE .../deliverables/[did]`. All gated by new `requireOwner(req, supabase, orderId)` helper in `lib/portal/auth.ts`.
- **Owner-side UI** — `OrderDetail` grew three tabs (Overview / Deliverables / Activity). Deliverables tab has an Add modal + per-card upload widget (XHR progress) + copy-review-link button. Activity tab pulls `portal_notifications` for the order.
- **Review-page API** — `GET /api/portal/review/[token]` (data + auto delivered→in_review), per-version stream URL, comments GET+POST with revision_request state transition, **POST approve** (writes approval row, creates Stripe PaymentIntent with `metadata.flow='approve_pay'`, idempotency-keyed on `portal-approve-<order_id>`), status (for polling), download (302 to signed URL), magic-link sign-in.
- **Review-page UI** — `/review/:token` route. Responsive hybrid layout: sidebar on ≥1024 px, theater stack on mobile. ReviewPlayer with video + timeline + comment dots + version selector. CommentsRail with optional "Pin to current moment" toggle. ActionBar: Request revision (modal with required note) / Approve & pay $X / Download (post-payment). SignInPanel (password OR magic link). PaymentPanel mounts Stripe Payment Element inline.
- **Stripe webhook** — `payment_intent.succeeded` disambiguates on `metadata.flow`. `approve_pay` → flip `awaiting_payment` → `paid`, set `paid_at`, email client receipt with download link, notify owner. Legacy onboarding-flow path untouched (drains out).
- **Notifications** — `lib/portal/notifications.ts` writes in-app rows and fires Resend templates. New email templates: `deliverable_ready_v1`, `deliverable_ready_vn`, `comment_added`, `revision_requested`, `approval_received`, `onboarding_completed_owner`, `payment_receipt`.

**Tooling fix:** vitest pinned to `^3.2.4` — vitest 4 silently broke under vite 5 (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Pinning restored the suite. Commit `757823a`.

**Known issues — fix before promotion to staging:**

1. **Download CTA breaks under bearer-token auth.** `api/portal/review/[token]/download.ts` requires `Authorization: Bearer <token>` in the request header. The in-page Download `<a href>` and the email-receipt CTA `${reviewUrl}/download` both navigate as plain GETs without the header — 401. Fix path: either (a) drop the bearer requirement and gate by token + `paid` status alone (token is the secret; safe), OR (b) have the Download button issue a `fetch()` with the bearer, read the 302 Location, then `window.location.href = url`. Recommend (a) for the email-link case — receipt CTAs must be plain hrefs.

2. **Receipt email URL uses frontend path.** Email links `${reviewUrl}/download` which would resolve to the Vite frontend router — no route exists there. After fixing (1) the link should be `${baseUrl}/api/portal/review/<token>/download`.

3. **Form copy on `Onboard.tsx` is now stale.** Submit button says "Continue to payment" and the form footer says "Payment is processed by Stripe. We never see your card." Per Oliver's instruction this copy was not changed — but it now lies about what submit does (submit now just records billing details and moves to `awaiting_delivery`). Worth touching up the button label and removing the Stripe footer line; the success-view copy remains intact.

4. **Receipt copy in success view is now stale.** The post-onboarding success view still says "A receipt from Recasi Media is on its way to your inbox" but no receipt is generated at onboarding any more (the receipt fires after payment on the review page). Per Oliver's instruction, this copy was preserved as-is. Worth rewriting when Oliver is ready.

5. **`stripe_payment_intent_id` is dead in `api/portal/onboard/[token].ts:45` SELECT.** No longer read in the file. Trivial cleanup.

6. **Preexisting test flake:** `MarketComparison.test.tsx` (v2 landing component, unrelated to portal) fails on `expect(screen.getByText(/Sell faster/i)).toBeTruthy()`. Not introduced by Phase 2.

7. **Vercel CLI is outdated** (50.18.2 → 53.3.2). Session-start hook flagged it. Upgrade: `npm i -g vercel@latest` or `pnpm add -g vercel@latest`.

**Promotion path (when ready):**
1. Manual staging smoke per Task 25 of the plan: create a new order in `dev` → onboard a test customer → upload a test mp4 → review page → comment + request revision → approve & pay with Stripe test card `4242…` → verify webhook flips order to `paid` → click Download (after fixing #1/#2 above).
2. PR `feat/portal-deliverables → dev` (`git merge --no-ff`), then `dev → staging`, then `staging → main`.
3. Append a one-line entry to "Recent shipping log" below at each promotion.

---

**2026-05-06 PM: judge calibration program PAUSED after 3 failed lever attempts. Cost-fix + harness improvements promoted; product focus shifts.** Full session notes: [`sessions/2026-05-06-judge-calibration-v1.4-pro.md`](./sessions/2026-05-06-judge-calibration-v1.4-pro.md) (AM) and [`sessions/2026-05-06-pm-judge-calibration-v1.5-fewshot.md`](./sessions/2026-05-06-pm-judge-calibration-v1.5-fewshot.md) (PM).

**Lever scoreboard (best Pearson achieved: +0.048; threshold to ship: +0.30):**

| Variant | n | Pearson | Verdict |
|---|---:|---:|---|
| v1.1 baseline (Flash, zero-shot) | 150 | −0.103 | constant-output ~4.21 |
| v1.3-anchored (Flash, prompt-tuning) | 189 | −0.150 | regression |
| v1.4-pro (Pro, model swap) | 31 | +0.048 | direction flip; trivial |
| v1.5-fewshot down-only (Flash, 38 ex) | 25 | −0.066 | unlocked 1-2★ but global down-shift |
| v1.5-fewshot-balanced (38 down + 18 up) | 24 | −0.452 | regression — up-corrections noisy |
| v1.6-minaxes-fewshot (TS aggregation) | 25 | −0.271 | per-axis output also miscalibrated |

**Four failed lever attempts. Same constant-output disease persists across prompt × model × few-shot × TS-aggregation variants.** Path A (minimal-judge with TS aggregation) tested 2026-05-06 PM and confirmed the per-axis output is also miscalibrated — judge gave human=5★ clips motion ratings of 2 routinely. **Calibration program is closed.** Re-opening would require path C (different evaluator architecture: fine-tune, Sonnet vision, or multi-stage flag-only classifier).

- **Standing cost-tracking bug FIXED + 249 missed rows backfilled** (AM session). `recordCostEvent.propertyId` now accepts null; three Lab callsites updated. Live in prod.
- **Durable harness improvements** (AM + PM): `judgeVersionFor(model)`, `geminiCostCents(model)`, harness auto-loads `loadCalibrationFewShot` per call (mirrors prod cron), `--no-fewshot` + `--tag <s>` CLI flags for separable A/B buckets. Useful regardless of which calibration approach we eventually pick up.
- **Judge stays paused** — `JUDGE_ENABLED=false` + `system_flags.judge_cron_paused=true`.
- **Calibration data in prod** (judge paused so no behavior change): 38 down-correction + 18 up-correction rows in `judge_calibration_examples`. The 18 up-corrections are noisy (some rows are accurate judge calls on clips Oliver rated leniently for non-motion reasons) — do not rely on them without manual review.
- **SDK telemetry caveat:** `@google/genai` reports `promptTokenCount=0` for video inputs, so per-row `cost_cents` hits 1¢ Math.ceil floor. Real spend is higher; reconcile against Google Cloud invoice.

**Next session — pivot to product gaps (path B).** Path A tested + failed. Per the documented gaps in memory:
- Voiceover + voice clone — charged but no code paths
- Brokerage logo + brand colors — captured in `user_profiles`, never rendered
- Music — not captured on form, not in pipeline (videos would be silent)
- Duration enforcement — 15/30/60s priced but director plans ~12 scenes regardless
- Order-form persistence — `selected_package`, `selected_duration`, `selected_orientation`, `days_on_market`, `sold_price`, `add_voiceover`, `add_voice_clone`, `add_custom_request`, `custom_request_text` captured in React state but never persisted to DB

Pick highest-ROI gap (probably order-form persistence — unblocks downstream data) and start there. Path C (different evaluator architecture) deferred indefinitely.

---

**2026-05-05: Consolidation overhaul shipped — repo renamed, 3-tier deploy live, governance system installed.**

Phase summary (full spec at [`specs/2026-05-05-listing-elevate-consolidation-design.md`](./specs/2026-05-05-listing-elevate-consolidation-design.md)):

- **Repo renamed:** `theolivercollins/reelready` → `theolivercollins/listing-elevate`. Local: `~/real-estate-pipeline` → `~/listing-elevate`. Vercel project was already `listingelevate`. GitHub keeps the redirect from old URL.
- **3-tier deployment live:** `dev` and `staging` long-lived branches off `main`. URLs: `listingelevate-git-{dev,staging}-recasi.vercel.app`. Promotion path: `feat/* → dev → staging → main`, every step via PR + `git merge --no-ff`. Crons fire on production only.
- **Cost decision:** skipped a separate staging Supabase ($120/yr saved). All 3 envs share prod Supabase. App-layer isolation via `VERCEL_ENV === 'production'` checks at every destructive write path — convention to enforce in code reviews going forward.
- **Cleanup:** branches 24→3 local, 14→3 remote. Worktrees 16→1. Sister folders (`real-estate-pipeline-{ui,finances}`) gone (they were git worktrees, not separate repos). 14 stale doc files archived under `docs/archive/superseded-docs/`. 10 `archive/*` tags created as a lossless safety net before any branch deletion.
- **Governance installed:** `CLAUDE.md` at root (auto-loaded each session). `.claude/settings.json` hooks: SessionStart (orientation), PreToolUse on `git push` (blocks main pushes that didn't update HANDOFF.md), Stop (turn-end uncommitted-work warning). `pnpm run doctor` (`scripts/doctor.ts`) surfaces stale worktrees, merged-but-undeleted branches, doc rot, inactive feature branches. `/le-status` slash command bundles doctor + git status + commit log + lineage in one shot.
- **File-revert ghost (2026-04-13 incident):** confirmed gone. Phase 0 canary held; full folder rename completed without incident.
- **Open follow-ups:** First trip through promotion path = THIS work going `chore/consolidation-2026-05-05 → dev → staging → main`. Phase 6 (delete unreferenced `lib/providers/{higgsfield,runway,luma}.ts` after grep audit) deferred — pick up next session.

---

**2026-04-28: Ledger-driven system update + lab cost-tracking bug fix shipped to main (commit `cd242fc`).** Triggered after Oliver flagged "prompts aren't improving from my ratings". Investigation (full trail in [`sessions/2026-04-28-lab-cost-tracking-fix.md`](./sessions/2026-04-28-lab-cost-tracking-fix.md)) confirmed the rating loop *is* working post-fix `140c8f4`, but the latent ledger had never been crystallized into hard rules and a bigger bug was masking all lab cost telemetry.

- **Pending proposal `c0708a98-…`** — mined 196 rated iterations across 23 buckets into 6 concrete `DIRECTOR_SYSTEM` patches. Review at `/dashboard/development/proposals` and promote what looks right; promoted patches mutate the production director on the next render via `resolveProductionPrompt`.
- **Recipe pool 84 → 115** — backfilled 27 winners (4★+) that pre-dated the auto-promote logic. Pure DB op via `scripts/oneoff/backfill-recipes.ts`.
- **Thompson router 0 → 41 arms** — `router_bucket_stats` was empty, so SKU choice was always falling through to default. `npx tsx scripts/refresh-router-bucket-stats.ts --write` populated α/β posteriors from the rated ledger; router now starts steering SKU choice toward proven cells.
- **Cost-tracking bug fixed** (migration 045 + commit `cd242fc`). `cost_events.property_id` was `NOT NULL` with FK to `properties.id`, but every Lab cost-event insert (mine, embedding, recipe promote, listing director, listing chat, lab generation) sent `property_id: null` inside a `try/catch`. Two-layer mask: Supabase JS returns `{error}` rather than throwing (catch never fired) + the unused `console.error` had no audience. Audit before fix: 378 lab iterations created in 30d, only 17 lab-stage `cost_events` rows. Dropped the NOT NULL constraint + replaced every try/catch with explicit `{error: costErr}` checks at 10 insert sites. Today's $0.31 rule-mining cost backfilled. Going forward, every lab API call writes a cost row.
- **P2 Gemini auto-judge** is fully wired on main and dormant by design. Two-gate kill-switch: `JUDGE_ENABLED !== "true"` env var (poll-judge.ts:23) + `system_flags.judge_cron_paused = true` (DB row, paused 2026-04-24 by operator). Stays off until Oliver finishes manual rating runway.
- **One-off scripts** (kept under `scripts/oneoff/`): `run-mine-now.ts` (replicates `mine.ts` handler with service-role + streaming + 32k max_tokens — 8k cap truncated the response on 196 ratings × 23 buckets) and `backfill-recipes.ts` (reusable for future winner backfills).

---

**2026-04-24 (later): Iteration order-id system shipped (migration 041).** Every Lab iteration — past and future — now has a human-readable order number of the form `V{n}-{seq:05}`.

- **Scheme (durable convention):** V1 = `prompt_lab_iterations` (268 rows backfilled V1-00001..V1-00268), V2 = `prompt_lab_listing_scene_iterations` (98 rows backfilled V2-00001..V2-00098). V3+ reserved for future lab surfaces; add a new sequence + trigger when a new table is introduced.
- **Enforcement:** `order_id text NOT NULL UNIQUE` on each table; `BEFORE INSERT` trigger pulls the next value from `v{n}_iteration_seq` so application code cannot forget. Insert test confirmed: omitting `order_id` from an insert auto-assigns `V1-00269`.
- **Surfaced in UI:** Rating Ledger card shows the order_id under the SKU chip; PromptLab iteration card shows it next to "Iteration N". Ledger API adds `order_id` field to `LedgerRow` (null on prod surface — prod scene_ratings do not use the scheme).

**2026-04-24: Rating Ledger "atlas" SKU-leak fix merged to main (commit `4d868bd`).** `fetchLegacyLab` in `api/admin/rating-ledger.ts` was surfacing the Atlas provider name in the SKU slot whenever model_used was populated — the SELECT never pulled the column. Fix: new shared `lib/ledger/formatSku.ts` formatter (single source of truth for how ledger rows derive SKU), routed through every surface; local `providerToSku` deleted. Migration 040 applied to prod adds `CHECK (clip_url IS NULL OR model_used IS NOT NULL OR sku_source = 'unknown')` on `prompt_lab_iterations` — any future write path that marks a render complete without a SKU is rejected with `check_violation` at the DB layer. 146 pre-P1 rows grandfathered via `sku_source='unknown'`. Verified with synthetic negative-test insert + legacy-row UPDATE + full test suite (141 + 8 new = 149 green).

**2026-04-23 session shipped P2 Session 2 + P3 Session 1 retrieval-fusion completion.** Judge chip + Override panel live in IterationCard. Rating Ledger now shows human vs judge side-by-side with agreement color coding. Retrieval RPCs fuse text + image embeddings at 0.4/0.6 default weights. Audit on 5 queries showed **48% top-5 exemplar turnover** and rating-average improvements on 2/5 queries — the fusion is doing real work. Provider dropdown UX simplified (Advanced ▸ collapse).

**Cumulative across 2026-04-22 + 2026-04-23:** P1 Foundation, P2 S1+S2 (judge wired + UI + calibration loop), P3 S1 full (embeddings backfilled + retrieval fused), P5 dry-run wired. Live at www.listingelevate.com.

**What's live:**
- **V1 Prompt Lab** is the daily-driver iteration surface. Atlas routing, `kling-v2-6-pro` default, per-iteration SKU selector + corrected cost chip (~$0.36–$1.11/clip) + "Try another SKU" shortcut. TopNav renamed; Listings Lab hidden from nav but direct URLs preserved.
- **Gemini auto-judge is LIVE (`JUDGE_ENABLED=true` on Vercel prod).** Every new Lab render that finalizes triggers a fire-and-forget `judgeLabIteration` call (gemini-2.5-flash, ~21s latency, ~2¢/clip) that watches the clip + source photo and writes a structured 5-axis rubric (motion_faithfulness, geometry_coherence, room_consistency, hallucination_flags, confidence + overall) to `prompt_lab_iterations.judge_rating_json`. Verified end-to-end 2026-04-22 on iteration `1aecff42` — judge correctly caught "too slow push-in, missed curve left" as a motion defect (overall 4, motion_faithfulness 2, flags: `too_slow` + `other_motion_defect`).
- **Thompson router is ARMED BUT OFF (`USE_THOMPSON_ROUTER` unset).** Math kernel + migration 038 + `resolveDecisionAsync` + `router_shadow_log` inserts on every render all live. With the flag off, every render silently logs `{ sku, reason: "flag_off" }` alongside `{ static_sku }` — dry-run data accumulating for the P5 Session 2 (2026-04-30) A/B audit. Flipping `USE_THOMPSON_ROUTER=true` activates auto-routing (but there's <3 trials per bucket today, so it'd fall back to static for all buckets anyway).
- **Image embeddings backfilled + fused into retrieval.** 95 images (42 photos + 53 sessions) have `gemini-embedding-2` 768-dim vectors. Migration 035 updated `match_rated_examples` / `match_loser_examples` / `match_lab_recipes` to accept optional `query_image_embedding` + `text_weight`/`image_weight` (0.4/0.6 defaults, env-overridable via `IMAGE_EMBEDDING_TEXT_WEIGHT`/`IMAGE_EMBEDDING_IMAGE_WEIGHT`). Callers in `lib/prompt-lab.ts` + `lib/judge/neighbors.ts` now load the query session's image embedding and pass it. Listing branch stays text-only (no photo_id linkage on listing_scenes — P3 S2 task). Audit `docs/audits/retrieval-fusion-2026-04-23.md` verdict: "Image fusion IS surfacing different exemplars."
- **Judge chip + Override panel in IterationCard.** Every iteration with `judge_rating_overall` populated shows "🔍 Judge 4/5 · Motion 2 · Geom 5 · Room 5 · ⚠ flags · conf 5 [Override]" as a muted row. Override opens inline panel (sliders + flag checkboxes + reasoning/correction textareas, pre-filled from current judge output) that writes a `judge_calibration_examples` row. Next judge call in that same (room × movement) bucket loads up to 10 recent overrides as few-shot context — closes the calibration loop.
- **Rating Ledger side-by-side.** `/dashboard/rating-ledger` has a new Judge column with delta-based color coding (grey ≤1, amber 2, red ≥3) + "Show only disagreements" filter. Useful for spotting where the judge needs calibration.
- **Provider dropdown simplified.** Daily Lab view now shows SKU + cost only; Kling-native / Runway escape hatches hidden behind an "Advanced ▸" toggle.

**Migrations applied via Supabase MCP (all in prod):** 031 (SKU capture), 032 (cost_events provider widen), 033 (judge columns + calibration_examples table), 034 (image_embedding + HNSW), 035 (retrieval RPCs with image-fusion), 038 (router_bucket_stats + router_shadow_log), 040 (SKU-required-at-finalize CHECK), 041 (iteration order_id + per-version sequences + trigger).

**Pre-cooked design branches (FINAL, integrated into shipped code today; branches preserved for reference):**
- `session/p2-rubric-design` — judge rubric (7 Qs resolved)
- `session/p3-embedding-preflight` — embedding provider decision (5 Qs resolved)
- `session/p5-thompson-design` — Thompson design (6 Qs resolved)

**What's NOT done yet (scheduled):**
- P3 Session 2 (2026-04-26): hybrid retrieval (dense + BM25 sparse + image, 3-way fused) + RetrievalPanel UI with match-percentage
- P3 Session 3 (2026-04-27): cross-encoder reranker pass on top of hybrid
- P4 (2026-04-28 → 29): scale hardening (per-photo Gemini enrichment on legacy, MMR diversity, hallucination-risk propagation)
- P5 Session 2 (2026-04-30 → 05-01): flip `USE_THOMPSON_ROUTER=true`, A/B audit, prod rollout decision
- P6 (2026-05-02): active learning + pairwise UX
- P7 (ongoing ~2026-05-05): promote-to-prod runbook

**Known carry-overs:**
- Pre-existing `/api/cron/poll-listing-iterations` error firing every minute for 48h+ (unrelated to any 2026-04-22 work; standing bug worth investigating).
- JUDGE_MODEL env can override `gemini-2.5-flash` back to `gemini-3-flash-preview` if that tier opens up.
- Full V1 smoke render (P1 Task 12) not explicitly run — judge verification on iteration 1aecff42 exercised the full pipeline path downstream of clip delivery, which is equivalent.

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
| **P2 — Gemini auto-judge (S1)** | ✅ shipped (2026-04-22) | Migration 033 applied; gemini-judge.ts binding live on gemini-2.5-flash; finalize-with-judge endpoint + fire-and-forget hook in finalizeLabRender; JUDGE_ENABLED=true in Vercel prod. Live test on iter 1aecff42 returned overall=4 with correct too_slow flag. S2 (UI chip + Override button) scheduled 2026-04-23 |
| **P3 — Retrieval upgrade (S1)** | ✅ shipped (2026-04-22) | Migration 034 applied; embeddings-image.ts binding live; 95 images backfilled (42 photos + 53 sessions, 100% coverage, $0.01). S2 hybrid retrieval + reranker + RetrievalPanel UI scheduled 2026-04-26–27 |
| P4 — Scale hardening | per spec | Scheduled 2026-04-28–29 (2 sessions) |
| **P5 — Thompson router (S1 dry-run)** | ✅ shipped (2026-04-22, flag off) | Migration 038 applied; resolveDecisionAsync + pickArm wired behind USE_THOMPSON_ROUTER env flag (default off); router_shadow_log writes on every render capturing Thompson-vs-static decisions. S2 A/B audit + flag-flip scheduled 2026-04-30–05-01 |
| P6 — Active learning + pairwise | per spec | Scheduled 2026-05-02 |
| P7 — Promote-to-prod flywheel | per spec | Ongoing runbook; activates ~2026-05-05 |

## Recent shipping log

(Newest on top. Append one line per push to `main`.)

- 2026-05-06 — `0fd591b` — judge calibration program CLOSED after 4 failed lever attempts (v1.6 minaxes also failed); next session pivots to product gaps
- 2026-05-06 — `6c711e0` — v1.5-fewshot harness auto-loads few-shot + populate scripts
- 2026-05-06 — `7955cda` — v1.4-pro calibration harness + standing cost_events FK fix + 249-row cost backfill
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
