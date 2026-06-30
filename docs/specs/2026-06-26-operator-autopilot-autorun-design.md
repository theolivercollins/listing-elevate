# Operator Autopilot — Auto-run for the video operator dashboard

**Date:** 2026-06-26
**Status:** Approved design → implementation
**Branch:** `worktree-feat+operator-autopilot-autorun`

## 1. Goal

Add an **auto-run ("Autopilot")** mode to the video operator dashboard so the AI decides
what's best at each pipeline checkpoint instead of waiting for a human — advancing the
delivery run autonomously toward `delivered`. This directly serves the product's hard
requirement of zero human-in-the-loop.

Decisions confirmed with Oliver (2026-06-26):
- **Autonomy depth: confidence-gated.** Auto-decide and advance at every gate, BUT if a
  gate's signal is low-confidence, pause there and hand control to a human with a reason.
- **Scope: per-property, chosen at inception.** The `auto_run` flag is set when the
  property/run is created. A toggle on the command center can also flip it while running
  (the kill switch). No global setting.
- **Decision engine: hybrid.** Reuse existing AI signals for objective gates (judge A/B
  winners, scraped details), add a *small* LLM call only for subjective picks (voice tone,
  music mood). No new "operator brain" mega-LLM.
- **Integration: fresh and self-contained,** wired directly into the operator dashboard —
  NOT building on the isolated Phase-A advisory autonomy worktree.

## 2. Existing topology (do not duplicate)

- **Dashboard:** `src/pages/dashboard/studio/PropertyCommandCenter.tsx`, route
  `/dashboard/studio/video/properties/:propertyId`. Renders `DeliveryStepper` + checkpoint panels.
- **State machine:** `lib/delivery/state.ts` — stages
  `intake → scraping → generating → judging → checkpoint_a → details → voiceover → music → assembling → checkpoint_b → delivered`.
  `canAdvance(from,to)` allows single forward steps only. `lib/delivery/runs.ts` →
  `advanceRun(runId, to)` performs a CAS update (`WHERE stage = from`) — our idempotency guard.
- **Gate stages** (human pauses): `checkpoint_a`, `details`, `voiceover`, `music`, `checkpoint_b`.
  Auto stages (`intake/scraping/generating/judging/assembling`) already advance via cron/poll.
- **All operator actions** POST to `/api/admin/studio/delivery/{runId}` with an `action` param.
  Every choice already logs an `ml_events` row. We reuse these handlers, never re-implement them.
- **Write guard:** any destructive/provider path must check
  `process.env.VERCEL_ENV === 'production' || process.env.LE_ALLOW_NONPROD_WRITES === 'true'`.

## 3. Data model

Migration (idempotent, applied to **dev first**, never auto-applied to prod):

```sql
ALTER TABLE delivery_runs
  ADD COLUMN IF NOT EXISTS auto_run boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paused_reason text,        -- null = not paused; set when a gate pauses for a human
  ADD COLUMN IF NOT EXISTS auto_paused_at timestamptz; -- when autopilot paused
```

- `auto_run` is seeded at run creation from the intake form choice.
- A run is "on autopilot and live" when `auto_run = true AND paused_reason IS NULL`.
- A gate that can't decide confidently sets `paused_reason` (and `auto_paused_at`) and leaves
  the stage where it is — the existing manual checkpoint UI then takes over.
- Toggling `auto_run` off (kill switch) immediately stops further auto-resolution.

## 4. Auto-resolver core — `lib/delivery/auto-run.ts`

Single entry point:

```ts
resolveGate(run: DeliveryRunRow): Promise<GateOutcome>
// GateOutcome = { action: 'advanced', to } | { action: 'paused', reason } | { action: 'noop' }
```

- Guards first: return `noop` unless `run.auto_run === true`, `paused_reason` is null,
  `run.stage` is a gate stage, and the write guard passes.
- Dispatches by `run.stage` to one of five resolvers (below). Each resolver:
  1. Gathers the signal it needs (existing data or a small LLM call).
  2. If confident: performs the SAME mutation the human action would (calling the existing
     handler/lib function — e.g. set winner, set listing details, set script/voice + generate
     audio, set music, submit ratings), logs an `ml_events` row with `payload.source = 'auto'`
     and a `confidence` value, then calls `advanceRun(run.id, nextStage)`.
  3. If not confident: calls `pauseForHuman(run.id, reason)` (sets `paused_reason` +
     `auto_paused_at`, logs an `ml_events` `auto_pause` row) and returns `paused`.
- Idempotent: `advanceRun`'s CAS guard means a double-fire can't double-advance.

### Per-gate resolvers & confidence rules

| Gate | Signal source | Advance when | Pause when |
|---|---|---|---|
| `checkpoint_a` | Judge winners (existing) + default scene order | Judge margin ≥ `AUTO_JUDGE_MARGIN` on all scenes | Any scene's A/B margin below threshold (tie) |
| `details` | Scraped `listing_details` | price, beds, baths all present & non-empty | Any required field missing/empty |
| `voiceover` | Existing `generate_script` + small LLM voice-tone pick → `generate_audio` | Script non-empty & audio synthesized | Script empty/flagged or synth fails |
| `music` | Small LLM mood pick → best-rated track for mood (reuse track library + `music_track_feedback`) | A track matches the mood | No track available for mood |
| `checkpoint_b` | Auto quality check (heuristic + reuse existing signals) | Quality score ≥ `AUTO_DELIVER_THRESHOLD` → auto-rate + deliver | Quality below threshold |

Thresholds live in one config block at the top of `auto-run.ts` (tunable constants), not magic
numbers scattered around.

The two small LLM calls (voice tone, music mood) record `cost_events` like every other model
call (cost tracking is first-class). Use the cheapest model that fits (Haiku-tier).

## 5. Driver — when does `resolveGate` run?

Two triggers, same function (defensive + responsive):

1. **Cron sweep** — `api/cron/auto-run-sweep` (registered in `vercel.json`; cron enabled on
   `main` only per branch model). Selects `delivery_runs WHERE auto_run = true AND
   paused_reason IS NULL AND stage IN (gate stages)` and calls `resolveGate` for each.
   This is the robust backbone (also catches runs that landed at a gate via a non-inline path).
2. **Inline kick** — right after an auto-stage completes and advances into a gate (in the
   existing scrape/assemble/judge-completion paths), if `auto_run` call `resolveGate` once so
   autopilot feels immediate rather than waiting up to a cron tick.

Both paths are safe to overlap because of the CAS guard + `paused_reason` check.

## 6. UI changes

- **Property creation / intake:** an **Auto-run** checkbox ("Let AI run this listing on
  autopilot"). Default off. Wired into the existing create flow → seeds `delivery_runs.auto_run`.
- **`PropertyCommandCenter`:**
  - An **Autopilot badge** in the header when `auto_run` is on ("Autopilot — AI is running this
    listing").
  - A **live decision log**: read the `ml_events` with `payload.source = 'auto'` for this run and
    show, per gate, what autopilot chose + confidence.
  - A **Pause / Take over** button (and a Resume) that flips `auto_run` / clears
    `paused_reason` — the kill switch.
  - **When paused** (`paused_reason` set): a banner with the reason, and the normal manual
    checkpoint panel for that stage renders so a human can finish it. Completing it manually and
    advancing can optionally re-arm autopilot for later gates (Resume).
- New API actions on `/api/admin/studio/delivery/{runId}`:
  `action=set_auto_run` (`{ enabled }`), `action=resume_autopilot` (clears `paused_reason`).

## 7. Safety / non-functional

- Write guard respected in `resolveGate` (no provider renders / writes off-prod unless
  `LE_ALLOW_NONPROD_WRITES`).
- Kill switch: `auto_run = false` stops the sweep from touching the run immediately.
- Idempotent: one decision per gate (CAS guard). Cron + inline can't double-advance.
- Full audit: every auto-decision and pause is an `ml_events` row with `source:'auto'` →
  training data + the command-center log both come for free.
- Cost: the two small LLM calls write `cost_events`.
- Migration: idempotent `IF NOT EXISTS`; applied to dev first, prod only with Oliver's OK.

## 8. Testing

- Unit: each resolver's confidence branch (advance vs pause) with stubbed signals.
- `canAdvance`/`advanceRun` idempotency under double-fire.
- Write-guard short-circuit when off-prod.
- A sweep integration test: a seeded `auto_run` run walks gate→gate→delivered when all signals
  confident, and halts at the first low-confidence gate.

## 9. Out of scope (YAGNI)

- Global "everything autopilot" setting (per-property only, per Oliver).
- Reworking the Phase-A advisory autonomy module.
- New voice/music *generation* models — autopilot only *selects/triggers* existing generation.
- Backfilling `auto_run` for historical runs (defaults false).

## 10. Task breakdown (waves)

**Wave 1 (parallel, disjoint scopes):**
- T1 — Migration: add `auto_run`/`paused_reason`/`auto_paused_at` to `delivery_runs` (sql-pro).
- T2 — Auto-resolver core skeleton + config + `pauseForHuman` + dispatch + guards, with the 5
  resolver stubs and unit-test scaffolding (typescript-pro).

**Wave 2 (parallel after T2 lands the interfaces):**
- T3 — Implement the 5 per-gate resolvers reusing existing handlers + the 2 small LLM calls +
  cost_events (ai-engineer).
- T4 — Driver: cron route `auto-run-sweep` + `vercel.json` registration + inline kicks in
  scrape/assemble/judge-completion paths (nextjs-developer).
- T5 — API actions `set_auto_run` / `resume_autopilot` on the delivery route (typescript-pro).

**Wave 3:**
- T6 — UI: intake auto-run checkbox + command-center autopilot badge, decision log, pause/resume,
  paused-state manual fallback (react-specialist).

**Wave 4:**
- T7 — Tests green + final review + qa-verify (test-runner / code-reviewer / qa-verifier).
