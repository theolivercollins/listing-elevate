# Plan A — Conversational Telegram Refine Agent (Studio-grade)

**Date:** 2026-07-01 · **Branch:** `worktree-telegram-conversational-refine` (off `origin/main` @ f147298)
**Ask (verbatim):** "fix the telegram bot to be conversational using claude so i can just chat with it and it has fully capability e.g. i want music changed, i want pics ordered changed, etc."
**Oliver's fork decision:** Studio-grade / full power.

## Goal
Oliver chats with the Listing Elevate Telegram bot in natural language; it actually executes refinements on his auto-generated listing videos — swap/AI-generate music, reorder photos/clips, regenerate individual clips (best-of-two), flip A/B winner, change voice/script, edit listing details, **resolve auto-run stalls**, and re-render — replying conversationally throughout.

## Architecture decision (locked)
Route Google-Drive/Telegram intake through the Operator Studio **delivery pipeline** (`delivery_runs` + `auto_run=true`) instead of the lighter customer pipeline, so every auto-generated video lands on the rich, refine-able surface. The conversational agent operates on that surface via the real `lib/delivery/*` functions.

## Verified facts (against `origin/main`)
- 12-stage machine (`lib/delivery/state.ts`): intake, scraping, photo_selection, generating, judging, checkpoint_a, details, voiceover, music, assembling, checkpoint_b, delivered.
- Auto-run gate-resolver (`lib/delivery/auto-run.ts`) driven by cron `/api/cron/auto-run-sweep` (every minute) headless-drives a run to a **rendered horizontal** video, **pausing** at 6 gates: photo_selection (<6 photos), checkpoint_a (any judge margin <0.15), **details** (missing price/beds/baths — `!d[field]` treats 0 as missing), voiceover, music, checkpoint_b (quality <0.7). Pauses set `paused_reason` via `pauseForHuman`.
- `createRun({property_id, client_id, video_type, duration_seconds, auto_run})` inserts at stage 'intake'. `order_mode='operator'` is set on the **property** (by `manualIngest`), NOT via createRun; column defaults 'customer'.
- Delivery pipeline does NOT self-generate scenes; `runPipeline` drives intake→analysis→**pause at photo_selection** (gated on the run **existing**, not on order_mode). The auto-run sweep then takes over.
- Operator StudioNew = 3 calls: ingest(`manualIngest`+`createRun`) → `runPipeline` → scrape(`runScrapeStage`, populates `run.listing_details`). `approveIntake` today = createProperty + photos + `runPipeline` (no run, no scrape).
- Default output **horizontal only**; vertical needs `properties.selected_orientation='both'` AND a 9:16 Creatomate template (else silently skipped).
- Final URLs → `properties.horizontal_video_url`/`vertical_video_url`. In-flight job tokens → `delivery_runs.assembly_h_job`/`assembly_v_job`.
- `pollResults` (`lib/drive/detect.ts`) keys on `properties.status IN ('complete','delivered')` — fires at **assembly**, BEFORE checkpoint_b. Must switch to `delivery_runs.stage='delivered'` + a separate `paused_reason` path.
- Non-prod write guard: auto-run resolvers no-op unless `VERCEL_ENV==='production'` or `LE_ALLOW_NONPROD_WRITES==='true'`; crons disabled off-prod → **E2E proof happens on prod**.
- `delivery_runs` partial unique `(property_id, video_type) WHERE stage<>'delivered'` → `regenerateIntake` must revert/reuse the existing run or create-new only after delivered.
- LLM convention: no `lib/openrouter.ts` on main; ~20 files use `new Anthropic()` (`@anthropic-ai/sdk ^0.39.0`) + `computeClaudeCost` (`lib/utils/claude-cost.ts`) + `recordCostEvent`. New agent follows the same.
- Design template to **port, not merge**: `feat/listing-autopilot`'s `lib/autopilot/refine-agent.ts` `planRefinement` (Haiku, forced tool-call, re-validate against ctx) + `refine-execute.ts` (DI executor, batch→one re-render, server-side plan persistence + opaque-id confirm). Stale (173 commits), Slack, incomplete action set.

## Waves

### Wave A — Route intake through delivery pipeline (prerequisite)
- **A1** `lib/drive/orchestrate.ts` `approveIntake()`: after createProperty + insertPhotos, before `runPipeline`: set `properties.order_mode='operator'`; `createRun({property_id, client_id:null, video_type: map→'just_listed', duration_seconds:30, auto_run:true})`; fire `runScrapeStage(runId)`. Keep `runPipeline(propertyId)`. `setStatus('generating')`. Guarded by feature flag.
- **A2** `regenerateIntake()`: reconcile with the `(property_id,video_type)` unique constraint — revert/reuse the existing non-delivered run (or create-new after delivered). Prefer routing regen through the conversational refine path.
- **A3** `pollResults()`: done-detection → `getRunByProperty(property_id).stage==='delivered'` → "✅ ready: {url}"; add `paused_reason` watch → "⏸️ paused for review: {reason} — reply and I'll handle it."
- **A4** Feature flag `DRIVE_INTAKE_USE_DELIVERY_PIPELINE` (safe rollback to current customer path).

### Wave B — Conversational refine agent (core)
- **B1** `lib/telegram/refine-agent.ts` `planRefinement(freeText, ctx, history)`: Claude Haiku 4.5, forced tool-call. System prompt = decisive listing-video editor + full RefineAction vocabulary + decision rules (batch changes, ask for missing info, confirm expensive ops). Context: run stage, scenes (ids/room_type/order), current music/voice/order, available tracks + voices, listing_details, paused_reason, conversation history. Output `{actions, summary, reply, needsConfirm, unsupported?}`. **Re-validate** every action vs ctx (scene ids exist; reorder = full permutation; music_track_id in catalog; voice_id in VOICES).
  - RefineAction union: `set_music{music_track_id}` · `generate_music` · `music_feedback{track_id,verdict,comment?}` · `reorder{scene_order}` · `regenerate_clip{sceneId,model?}` · `flip_winner{sceneId}` · `set_voice{voice_id}` · `generate_script{note?}` · `set_script{text}` · `generate_audio` · `edit_details{price?,beds?,baths?,sqft?,description?}` · `resume` · `add_vertical` · `regenerate_all`.
- **B2** `lib/telegram/refine-execute.ts` `executeRefinement(runId, actions, deps)`: DI over real `lib/delivery/*` funcs. Records `ml_events` (existing vocab + `source:'telegram_refine'`). Cost: `computeClaudeCost`+`recordCostEvent` for the planner call. **Batch** actions → drive run to 'assembling' → one re-render. Returns `{applied, summary, rerendering}`.
- **B3** Unit tests: planner intent→action + validation rejects; executor per-action dispatch + batching + cost recorded.

### Wave C — Telegram conversational UX + confirm + state
- **C1** Conversation state per intake — proposal: new `drive_intake.chat_messages jsonb` (migration 098, additive) fed to the planner for multi-turn. (Alt: reuse `feedback_notes`, no migration.)
- **C2** `api/telegram/webhook.ts` `handleFreeText` rewrite: resolve active intake for owner chat (most-recent awaiting_approval|rendered|paused; ask if ambiguous) → `getRunByProperty` → load history → `planRefinement`:
  - missing info → reply asking, store history, no execution;
  - accumulation → stage changes, "got it — anything else? say 'go' to render";
  - explicit "go" OR expensive single op → persist plan (`drive_intake.pending_plan jsonb` + opaque id) → reply summary + inline `[✅ Apply & re-render | ✏️ Adjust | ❌ Cancel]`.
  - callback `apply:<planId>` → reload plan → re-validate → `claimForRegenerate` (CAS) → `executeRefinement` → "applied, re-rendering — ping you when ready."
- **C3** Completion notify via A3 (`delivered` → "✅ updated video ready: {url}"; `paused` → "⏸️ {reason}").
- **C4** Auth unchanged (owner-chat allowlist + webhook secret); single-operator.

### Wave D — Review + test + deploy + prove
code-reviewer (spec+quality) + security-auditor (webhook auth, plan-injection, tenant data, money, prompt-injection via listing text) + cross-model review of the diff; test-runner green; merge→prod auto-deploy; prod E2E (real Telegram round-trip, screenshots); qa-verifier vs verbatim ask; docs + memory update.

## Open questions for reviewers
1. **Confirm-flow granularity** — cheap/immediate vs expensive/confirm split, OR always batch→one confirm→one render (every change needs a re-render to be visible anyway)? Which is more conversational + cost-sane?
2. **Conversation state** — new `drive_intake.chat_messages jsonb` migration vs reuse `feedback_notes`?
3. **Proactive vs reactive** — should the agent auto-notify + offer the fix when a run pauses at a gate, or purely react to Oliver's messages?
4. **regenerateIntake reconciliation** — revert existing run vs new run given the unique constraint?
5. **Planner model** — Haiku 4.5 (cheap, matches template) vs Sonnet (better multi-turn)? Volume is low.
6. **Risk** — re-plumbing the just-activated live intake; mitigate with feature flag + prod E2E before first real folder. Sufficient?
7. **Vertical** — v1 horizontal-only + `add_vertical` action, vs default 'both'? Cost implication.

---

# Plan B — Converged (Gemini + Codex + orchestrator)

Both reviewers rejected Plan A. Two flaws rejected as reviewer error (Gemini stale on "Haiku 4.5 doesn't exist" — it does, `claude-haiku-4-5`; Gemini's "remove scrape" — scrape is required per live verification). All other valid concerns folded. 15 locked decisions:

1. **Planner model** = Haiku 4.5 (exact id from the codebase's existing usage / cost table). Bump to Sonnet only if multi-turn quality demands it in testing.
2. **Scrape (keep, sequence it)** — `approveIntake` fires `runScrapeStage` right after `createRun`, before/concurrent with `runPipeline`. Scrape=stage 2, details gate=stage 7 (photo-gen + judging between) → race is benign. A genuine 0/0/0 MLS-miss pausing at the details gate is the FEATURE (agent asks for the price).
3. **pollResults conditional + explicit run_id** — store `drive_intake.delivery_run_id` at approve; poll THAT run: `stage='delivered'`→ready, `paused_reason`→"paused for review". If no `delivery_run_id` (flag off / legacy customer) → existing `properties.status` fallback. Never `getRunByProperty` (wrong-run risk).
4. **Run mutual-exclusion** — executor/regen set `paused_reason='refining'` (the sweep selects `WHERE paused_reason IS NULL` → skips it) + `claimForRegenerate` CAS; execute → re-render → clear lock. Reuses shipped primitives; no new lock table.
5. **Webhook idempotency** — persist processed Telegram `update_id`s (dedupe, TTL) → reject dupes. Plans single-use (`pending_plan_consumed_at`, atomic CAS claim). Replays no-op safely.
6. **Plan token** — server-side opaque UUID bound to `intake_id`+`chat_id`, single-use, short expiry. Owner-chat gate + webhook secret already present. No HMAC (redundant given server-side persistence).
7. **Batch safety** — validate ALL actions first; execute deterministic order (details→order→voice→music→regen); per-step status; fire the single re-render ONLY if all render-affecting steps succeed; else report exactly what applied/failed and do not render. No cross-subsystem rollback (external side effects) — fail-safe + honest reporting.
8. **Prompt-injection policy (explicit, not deferred)** — fixed action allowlist (union type; model can't invent actions); every arg re-validated + bounded vs ctx; per-session caps (max regenerations / AI-music-gens / re-renders per intake = cost guardrail); confirm gate on all money/render ops; listing text + chat history delimited as UNTRUSTED data in the prompt. Blast radius of injection = one bounded action behind a confirm gate.
9. **Confirm-flow** = accumulate → one confirm → one render. Turns accumulate the change-set ("got it — anything else? say 'go'"); on "go"/done → summary + `[✅ Apply & re-render | ✏️ Adjust | ❌ Cancel]`; one render per confirmed batch. Info queries answer immediately.
10. **Conversation state** — migration 098: `drive_intake.chat_messages jsonb` (cap last ~20 turns), `pending_plan jsonb`, `pending_plan_id uuid`, `pending_plan_consumed_at`, `delivery_run_id uuid`, processed-`update_id` dedupe. Normalized table + retention cron = noted follow-up (low volume for v1).
11. **Proactive** — on pause, notify "⏸️ {reason}" with context; Oliver replies → agent resolves (edit_details/regenerate/flip/resume). Makes the automation actually complete instead of stalling silently.
12. **regenerateIntake** — route through the refine executor on the EXISTING run (`revertRun` back a stage, same row → respects the `(property_id,video_type) WHERE stage<>'delivered'` unique index); new `createRun` only if prior is 'delivered'. Legacy 🔁 button → `regenerate_all` on the existing run.
13. **Vertical** — v1 HORIZONTAL-ONLY (matches current intake default). `add_vertical` dropped from v1 (silent-loss + template dependency); fast-follow with hard preflight if Oliver wants reels.
14. **Details-gate zero-handling** — NOT bundling the shared `!d[field]` patch (pre-existing, affects all operator runs, out of scope; $0/0-bed is usually a real data error → pausing is correct). Drive intake relies on the agent to fill via the pause. Flagged as a separate follow-up.
15. **Testing** — integration tests simulate the sweep+webhook race (invoke resolvers directly, no cron). Feature flag defaults safe. Live E2E = one controlled test intake before flipping the flag broadly; blast radius bounded by flag + single property.

**Wave dependency:** A (orchestrate.ts, detect.ts) ∥ B (new lib/telegram/refine-*.ts) run in parallel (disjoint files); C (webhook.ts + migration 098) depends on both; D reviews/tests/deploys the whole.
