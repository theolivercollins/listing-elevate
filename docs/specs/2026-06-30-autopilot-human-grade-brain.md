# Autopilot human-grade brain + real video QA

**Date:** 2026-06-30
**Branch:** `worktree-feat+operator-autopilot-autorun`
**Status:** Approved → build

## Goal

Make Operator Autopilot decide like a senior human operator and guarantee the
output is a genuinely good, post-ready video — not a metadata heuristic.

Decisions confirmed with Oliver (2026-06-30):
- **Brain model: `claude-opus-4-8`** for every autopilot decision + the final
  reasoning (verified live: Opus 4.8, $5/$25 per M tok, vision-capable, adaptive
  thinking + effort). Replaces the current Haiku picks and the no-LLM heuristics.
- **On a not-post-ready verdict: auto-fix until good, up to a hard cap (3 rounds),
  then pause** for a human with the rationale.

## Current state (from map 2026-06-30)

- No central model registry; ids hardcoded. Autopilot uses `claude-haiku-4-5`
  (`lib/delivery/auto-run.ts:50` `PICK_MODEL`, voice + music mood) and
  `claude-sonnet-4-6` (`lib/delivery/voiceover-script.ts:23`, script). Everything
  else (photo_selection, checkpoint_a, details, checkpoint_b, music track pick) is
  pure arithmetic — NO model.
- Cost pricing for Opus already in `lib/utils/claude-cost.ts:13-15`; every model
  call records `cost_events` — a model swap keeps cost tracking intact.
- Vision exists for photos (Gemini/Claude aesthetic) and per-scene clips (Gemini
  2.5 Flash video judge → `scene_variants.gemini_scores`, `lib/delivery/judge.ts`).
  **Nothing watches the final assembled video.** `resolveCheckpointB` is a pure
  metadata score (`lib/delivery/auto-run.ts:950-1040`).
- Anthropic call pattern: `client.messages.create({model, ...})` at
  `auto-run.ts:698`. Per the live Claude API reference, Opus 4.8 requires
  `thinking:{type:'adaptive'}` + `output_config:{effort}`; `temperature`/`top_p`/
  `budget_tokens` 400. Use structured outputs (`output_config.format` json_schema)
  for parseable verdicts.

## Design

### A. Central brain module — `lib/delivery/auto-run-model.ts`

- `export const AUTOPILOT_MODEL = 'claude-opus-4-8'` (single source of truth).
- `decideWithBrain<T>({ system, user, schema, effort='high', stage, subtype, propertyId }): Promise<T>`
  — calls Opus 4.8 via the existing Anthropic client with `thinking:{type:'adaptive'}`,
  `output_config:{effort, format:{type:'json_schema', schema}}`, NO temperature/top_p/
  budget_tokens; returns the validated structured object; records a `cost_events` row
  (reuse `computeClaudeCost` + `recordCostEvent`, provider 'anthropic') with model +
  subtype metadata. Used by every resolver. Respect `canWrite()` upstream (resolvers
  already gate). Robust JSON parse + one retry.
- Repoint `auto-run.ts` `PICK_MODEL` and `voiceover-script.ts` `MODEL` at
  `AUTOPILOT_MODEL` (script gen moves Haiku/Sonnet → Opus).

### B. Real reasoning per gate (each logs a rationale into the `auto_advance` ml_event)

Replace arithmetic with `decideWithBrain` + a structured verdict
`{ decision, confidence (0-1), rationale, ... }`. Pause (existing `pauseForHuman`)
when the brain's confidence is low or it flags a blocker.

- **photo_selection** — brain reviews the AI-recommended set (room types, counts,
  aesthetic scores) → confirm / trim / pause. Keeps accept-recommended as the floor;
  the brain validates coverage like a human picking the best 12.
- **checkpoint_a** — brain reasons over `gemini_scores` + scene context to choose the
  A/B winner per scene + confidence; replaces the margin-arithmetic.
- **details** — brain sanity-checks `listing_details` (sane price/beds/baths, no
  garbage description) on top of the presence check.
- **voiceover** — script via Opus (`voiceover-script.ts`), voice-tone pick via brain.
- **music** — mood pick via brain; track selection stays feedback-ranked (brain picks
  the mood + may reason about the listing's vibe).

### C. Final QA gate — `resolveCheckpointB` rebuilt on real vision + reasoning

New `lib/delivery/video-qa.ts`:
- `watchAssembledVideo(run)` — reuse the Gemini 2.5 Flash video pattern
  (`lib/delivery/judge.ts` / `lib/providers/gemini-judge.ts`) to send the assembled
  video URL(s) (`properties.horizontal_video_url` / `vertical_video_url`) to Gemini and
  get a structured visual QA verdict: `{ visual_quality, pacing, coherence, glitches[],
  audio_sync, overall (0-1), notes }`. Records `cost_events`.
- `judgePostReady(run, geminiVerdict)` — `decideWithBrain` (Opus 4.8) synthesizes the
  Gemini video verdict + scene `gemini_scores` + script + audio/music presence + details
  into `{ post_ready: boolean, score (0-1), issues: [{ component: 'scene:<id>'|'script'|
  'music'|'voiceover'|'assembly', severity, why }], worst_component, rationale }`.

`resolveCheckpointB` new flow:
1. If `!post_ready`: enter the **auto-fix loop** (bounded by `qa_fix_rounds` < `QA_MAX_ROUNDS=3`):
   - Increment `qa_fix_rounds`. Identify `worst_component` and regenerate just that:
     scene → re-render the worst scene (reuse the existing regenerate/scene path),
     script → re-gen script, music → re-pick, voiceover → re-synth.
   - After regenerating a component that changes the video, route the run back to
     `assembling` (re-render) so a fresh assembled video exists, then checkpoint_b runs
     again (cron/lease drive it). Persist `qa_verdict` (jsonb) for the dashboard.
   - When `qa_fix_rounds >= QA_MAX_ROUNDS` and still not ready → `pauseForHuman` with the
     accumulated rationale (do NOT deliver a sub-par video).
2. If `post_ready`: submit auto ratings (reuse existing path), log `auto_advance` with the
   rationale + score, advance to `delivered`.

Guards: write-guard + resolve-lease already wrap via `resolveGate`. The loop is bounded
by `QA_MAX_ROUNDS` (cost cap) and idempotent (lease + CAS). Every Gemini + Opus call
records `cost_events`.

### D. Data model

Migration (idempotent, additive; applied to shared DB after build):
```sql
alter table delivery_runs
  add column if not exists qa_fix_rounds int not null default 0,
  add column if not exists qa_verdict jsonb;
```

### E. UI

The command-center decision log already reads `auto_advance` / `auto_pause` ml_events;
include the new `rationale` + QA `score` in those payloads so the operator sees *why*
autopilot decided as it did. (Light: ensure `AutopilotPanel` surfaces `rationale` if
present; QA verdict from `delivery_runs.qa_verdict`.)

## Out of scope (YAGNI)
- A full model-registry refactor (just the central `AUTOPILOT_MODEL` const).
- Fable 5 (Oliver chose Opus 4.8).
- Re-judging individual scenes with Opus (Gemini already does scene + now final video).

## Waves
1. (parallel) Migration (qa_fix_rounds/qa_verdict) · brain module `auto-run-model.ts`.
2. Upstream gate reasoning upgrades (photo/checkpoint_a/details/voice/music) — edits auto-run.ts + voiceover-script.ts.
3. Final QA gate + auto-fix loop — `video-qa.ts` + resolveCheckpointB rebuild + regen routing.
4. UI rationale surfacing.
5. Review (risky: autonomous spend + delivery) + tests + deploy.
