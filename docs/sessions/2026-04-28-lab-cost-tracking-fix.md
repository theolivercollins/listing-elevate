# 2026-04-28 — Lab cost-tracking fix + ledger-driven system update

## Why

Oliver flagged: "prompts aren't improving as I provide ratings or feedback in the 'What should change?' tab."

## Investigation

Used `superpowers:systematic-debugging`. Two distinct issues found.

### Issue 1: Historical refine-data loss (already fixed)

Per-day audit on `prompt_lab_iterations`:

| Day | Refines | Parent had `refinement_instruction` saved |
|---|---|---|
| 2026-04-23 | 43 | 1 |
| 2026-04-24 | 37 | 2 (fix landed mid-day) |
| 2026-04-28 (today) | 1 | 1 ✓ |

Bug fixed in commit `140c8f4` (2026-04-24 14:56 EDT) — `api/admin/prompt-lab/refine.ts` was silently dropping `tags` + `refinement_instruction` on the parent UPDATE before spawning the child. Verified today's V1-00375 refine end-to-end: parent V1-00286 (2★) had `refinement_instruction = "push in towards the front door"` saved; child prompt diff showed Claude added "descending" / "toward the entry portico" — feedback honored.

So: rating + refine loop works. The user's perception that "ratings aren't improving prompts" was largely about (a) confusion that "Save rating" alone never spawns a new iteration (only Refine does), and (b) refiner staying close to existing 4–5★ neighbors via rating-weighted retrieval.

### Issue 2: Latent ledger never crystallized into hard rules

```
proposals: 0
overrides: 0
recipes:   84 / 102 winners (18 missing)
router_bucket_stats: 0 / 41 possible arms
```

193 rated Lab iterations were powering retrieval (soft "bias toward neighbor") but had never been mined into director-system rules, never auto-promoted into all available recipes, and never seeded the Thompson router posteriors.

### Issue 3 (discovered during fix): Lab cost telemetry totally missing

While drafting the rule-mining script, the cost_events insert silently failed. Root cause:

```sql
-- cost_events
property_id uuid NOT NULL REFERENCES properties(id)
```

Every Lab cost-event insert site sent `property_id: null` inside a `try/catch`:

```ts
try {
  await supabase.from("cost_events").insert({
    property_id: null,
    ...
  });
} catch (costErr) {
  console.error("...", costErr);
}
```

Two-layer mask:
1. Supabase JS returns `{error}` rather than throwing — catch never fires.
2. `console.error` had no audience.

30-day audit: 378 lab iterations created, only 17 lab-stage cost rows. Effective rule_mining + lab embedding cost telemetry was zero — directly violates the "every API call logs a cost_event" directive.

## What shipped

### Ledger-driven system update (no code, ledger only)

| Action | Result |
|---|---|
| Run `mine.ts` over 60 days of ratings | Pending proposal `c0708a98-dd6f-4f99-9741-817726180243` with 6 concrete director-system patches. Cost: 43,921 tokens / $0.3135 (Sonnet 4.6) |
| Backfill recipe promotions for 4★+ that lacked a recipe row | 27 winners promoted; pool 84 → 115 |
| Refresh `router_bucket_stats` from full ledger | 41 arms populated (α=42, β=39); router posteriors now non-empty |
| Failure-cell scan (room × movement × sku, n≥3, avg≤2.5) | 4 weak cells; all overlap with mined proposal or router posteriors. No new proposals emitted |

The 6 mined proposed changes (review at `/dashboard/development/proposals`):

- **c1**: Ban rooflines as primary subject on drone push_in (warped geometry pattern)
- **c2**: Require named architectural anchor for drone pull-back (vs "the subject rooftop")
- **c3**: Dolly phrasing must name start + end anchor on a wall (fixes pan-instead-of-slide failures)
- **c4**: Ban "subtle drift"; redirect to "gentle curve" (subtle gets dropped by models)
- **c5**: Curve direction must match subject's actual side of frame
- **c6**: Ban vertical rise on Atlas pool push_in shots

### Cost-tracking bug fix (commit `cd242fc`, branch fast-forwarded to main)

- **Migration 045** (`supabase/migrations/045_cost_events_nullable_property.sql`): `ALTER TABLE cost_events ALTER COLUMN property_id DROP NOT NULL`. Applied to prod via Supabase MCP before push.
- **Replaced silent try/catch with explicit error checks** at 10 insert sites:
  - `api/admin/prompt-lab/{analyze,mine,recipes}.ts`
  - `api/admin/prompt-lab/listings/[id]/scenes/[sceneId]/chat.ts`
  - `api/admin/prompt-lab/listings/[id]/iterations/[iterId]/chat.ts`
  - `api/cron/{poll-lab-renders,poll-listing-iterations}.ts`
  - `lib/{db,prompt-lab,prompt-lab-listings,refine-prompt}.ts`
- **Side-fix in two listing chat handlers**: `scene_id` was being set to a `prompt_lab_listing_scenes.id`, but the `cost_events.scene_id` FK targets the prod `scenes` table. Moved listing-scene id into metadata; `scene_id` left null.
- **Today's $0.31 rule-mining cost backfilled** as `cost_events` row with `stage='rule_mining'` + audit note in metadata.

### One-off scripts (kept under `scripts/oneoff/`)

- `run-mine-now.ts` — replicates `mine.ts` handler with service-role + streaming + 32k `max_tokens` (8k cap truncated on 196 ratings × 23 buckets); reusable.
- `backfill-recipes.ts` — calls `autoPromoteIfWinning` on missing winners; reusable for future winner backfills.

## Findings to track

1. **`mine.ts` `max_tokens=8192` is too small** for production-scale ledgers. Once we have 300+ rated iterations the live endpoint will silently truncate. Consider bumping to 32k like the one-off, or batching evidence by bucket.
2. **`property_id` is now nullable** — make sure new code reviewers don't accidentally re-add a NOT NULL assumption. Migration 045's column comment documents the rationale.
3. **File-revert hazard struck mid-session** (per `project_file_revert_issue.md`). An external process switched the repo back to `feat/custom-listing-pages` and committed Sierra publish work while I had staged changes on `fix/lab-cost-events-tracking`. Recovery via `git fsck --lost-found` worked — found stash commit `058187be…`. Lesson for future Claude sessions: commit eagerly, don't hold uncommitted work across long-running ops.

## P2 Gemini judge — corrected memory

Earlier memory claimed "Gemini binding is P2 S1 TODO". Stale — the binding shipped in commits `0f71d9e` / `77ce652` / `cff08f8`. Implementation lives at `lib/providers/gemini-judge.ts` (uses `@google/genai`, default model `gemini-2.5-flash`). Two-gate dormancy (must satisfy BOTH to enable):

1. `JUDGE_ENABLED=true` env var
2. `system_flags.judge_cron_paused = false` (currently `true`)

Updated `project_p2_judge_rubric.md` memory + main MEMORY.md index to reflect this.

## Deploy

- Pushed to `origin/main` after Oliver approval.
- Vercel deploy `dpl_5rzumekkYDH1CdajsEwViVC6t7aK` for commit `cd242fc` building at session end.
