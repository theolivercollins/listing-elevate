# Window E — OG Prompt Lab data-capture enrichment

Last updated: 2026-04-21
Branch: `session/og-data-capture-2026-04-21` (cut off main)
Worktree: `.worktrees/wt-og-data-capture`

## Why this brief exists

The OG Prompt Lab was un-retired in commit `235100d`. Oliver will use it again. Before he does, enrich what it captures so the ML retrieval loop gets richer signal from every legacy session — both historical (108 rated iterations that only have `provider`) and going forward.

**Hard constraint:** DO NOT change the OG Prompt Lab's user-facing behavior. No UI changes. No workflow changes. Oliver's clicks, inputs, and visible output must stay identical. All enrichment is backend-only + retroactive.

## North Star you are serving

Criterion **#2 — no hallucinations** (retrieval surfaces richer past examples → director hallucinates less) AND criterion **#4 — right SKU** (SKU recovery on legacy ratings unlocks signal the router aggregator can use).

## Required reading

1. `docs/HANDOFF.md` — confirm DA.1 is on main + migration 030 applied
2. `docs/audits/router-coverage-2026-04-21.md` — the "32% SKU-granular" data shape problem this brief partially fixes
3. `lib/providers/gemini-analyzer.ts` — the `analyzePhotoWithGemini(url)` function you'll call against legacy photos
4. `supabase/migrations/030_photo_camera_state.sql` — pattern for migration 032
5. `lib/embeddings.ts` — `embedText(prompt)` wrapper
6. `api/admin/prompt-lab/*` — the OG Lab backend endpoints you'll instrument; DO NOT change their response shape or behavior
7. `src/pages/dashboard/PromptLab.tsx` + `PromptLabRecipes.tsx` — DO NOT TOUCH. Just confirm what the endpoints feed.
8. Supabase schema via MCP: `prompt_lab_sessions`, `prompt_lab_iterations`, `prompt_lab_recipes`

## Scope

### Must do — in this order

#### Part A — Retroactive Gemini analysis on legacy photos (highest leverage)

1. **Migration 032** at `supabase/migrations/032_prompt_lab_session_analysis.sql`:
   ```sql
   ALTER TABLE prompt_lab_sessions
     ADD COLUMN analysis_json jsonb,
     ADD COLUMN analysis_provider text;
   ```
   Apply via Supabase MCP `apply_migration` to project `vrhmaeywqsohlztoouxu`.

2. **`scripts/backfill-legacy-lab-gemini.ts`** — walks every `prompt_lab_sessions` row where `analysis_json IS NULL`, calls `analyzePhotoWithGemini(image_url)`, persists to the new columns. Batched (5 parallel), with `--limit N` and `--dry-run` flags. Every call logs a `cost_event` with `scope='prompt_lab_session_eyes_backfill'`, `provider='google'`, `amount_cents` per DA.1's existing pattern.

3. **Dry-run first.** Print what it would do (count, estimated cost). Expected: ~150 sessions, ~$0.40 total.

4. **Run `--write` once dry-run looks sane.** Log every analyzed session to `docs/audits/og-lab-data-capture-2026-04-21.md`.

#### Part B — Auto-analyze on every NEW legacy session (no UI change)

5. **Hook into the OG Lab session-create path.** Find the endpoint that creates a `prompt_lab_sessions` row (grep `api/admin/prompt-lab/sessions` or similar). After the row is inserted, fire `analyzePhotoWithGemini(image_url)` **asynchronously** (do not block the response). Write the result back into the same row's `analysis_json` / `analysis_provider`.

6. **If the Gemini call fails**, log the error to a `cost_event` with `metadata.gemini_error` + leave `analysis_json` null. Do NOT retry at request time. A follow-up backfill catches gaps.

7. **Critical: response shape unchanged.** The session-create endpoint's JSON response must be byte-identical to before. Run before/after tests to confirm.

#### Part C — Embedding backfill for legacy iterations

8. **`scripts/backfill-legacy-lab-embeddings.ts`** — walks every `prompt_lab_iterations` row where `embedding IS NULL AND director_prompt IS NOT NULL`, calls `embedText(director_prompt)`, writes the vector back. Cost-event per call with `scope='prompt_lab_iteration_embedding_backfill'`.

9. Dry-run + write, same pattern as Part A.

#### Part D — Postgres VIEW for unified retrieval

10. **Migration 033** at `supabase/migrations/033_unified_rated_pool_view.sql`:
    ```sql
    CREATE OR REPLACE VIEW v_unified_rated_pool AS
    SELECT
      'legacy_lab'::text AS surface,
      i.id AS iteration_id,
      s.id AS session_id,
      s.image_url AS photo_url,
      s.analysis_json AS photo_analysis,
      NULL::uuid AS photo_id,
      i.director_prompt,
      i.camera_movement,
      i.provider,
      i.model_used,
      i.rating,
      NULL::text[] AS rating_reasons,
      i.tags AS legacy_tags,
      i.user_comment,
      i.embedding,
      i.clip_url,
      i.created_at AS rated_at
    FROM prompt_lab_iterations i
    JOIN prompt_lab_sessions s ON i.session_id = s.id
    WHERE i.rating IS NOT NULL

    UNION ALL

    SELECT
      'listings_lab'::text,
      i.id,
      NULL::uuid,
      p.image_url,
      NULL::jsonb,     -- listings Lab photos use the photos table; DA.1 analysis is on photos.analysis_json
      lsc.photo_id,
      i.director_prompt,
      lsc.camera_movement,
      CASE WHEN i.model_used LIKE 'kling-v2-native%' THEN 'kling' ELSE 'atlas' END,
      i.model_used,
      i.rating,
      i.rating_reasons,
      NULL::text[],
      i.user_comment,
      i.embedding,
      i.clip_url,
      i.rated_at
    FROM prompt_lab_listing_scene_iterations i
    JOIN prompt_lab_listing_scenes lsc ON i.scene_id = lsc.id
    JOIN prompt_lab_listing_photos p ON lsc.photo_id = p.id
    WHERE i.rating IS NOT NULL

    UNION ALL

    SELECT
      'prod'::text,
      r.id,
      NULL::uuid,
      ph.file_url,
      ph.analysis_json,
      ph.id,
      COALESCE(r.rated_director_prompt, sc.prompt),
      sc.camera_movement,
      COALESCE(r.rated_provider, sc.provider),
      NULL::text,     -- prod doesn't record SKU yet
      r.rating,
      NULL::text[],
      r.tags AS legacy_tags,
      r.comment AS user_comment,
      COALESCE(r.rated_embedding, sc.embedding) AS embedding,
      COALESCE(r.rated_clip_url, sc.clip_url),
      r.created_at
    FROM scene_ratings r
    JOIN scenes sc ON r.scene_id = sc.id
    LEFT JOIN photos ph ON sc.photo_id = ph.id
    WHERE r.rating IS NOT NULL;
    ```
    (Adjust column names if any don't match actual schema — verify via Supabase MCP `list_tables` first.)

11. Smoke test the view: `SELECT surface, COUNT(*) FROM v_unified_rated_pool GROUP BY surface;` should return ~55 listings_lab, ~108 legacy_lab, ~7 prod (matching D's audit numbers).

#### Part E — SKU recovery for legacy iterations

12. **`scripts/backfill-legacy-lab-sku.ts`** — join `prompt_lab_iterations` to `cost_events` on (same session window + matching provider + timestamp proximity) and any `render_config`-shaped JSON blob on iterations. Where a specific SKU is recoverable, write it to `model_used`. Where not, leave null (migration adds `sku_confidence text` column: values `'recovered' | 'captured_at_render' | 'unknown'`).

13. **Migration 034** adds `prompt_lab_iterations.sku_confidence text`. Default 'unknown' for historical rows; 'captured_at_render' for rows where `model_used IS NOT NULL` at runtime.

14. Expected recovery rate: 10–30% of the 108 legacy ratings. Run dry-run first, report the number before committing the write.

#### Part F — Tag → rating_reasons normalization

15. **Migration 035** adds `prompt_lab_iterations.rating_reasons_normalized text[]`.

16. **`scripts/normalize-legacy-tags.ts`** — reads `prompt_lab_iterations.tags`, applies a heuristic mapper (explicit lookup table at top of the file mapping common legacy tag strings to listings-Lab rating_reasons taxonomy values), writes the normalized array. Leaves `tags` untouched. Unknown tags go into a `docs/audits/legacy-tag-coverage-2026-04-21.md` report so Oliver can see what's unmapped.

#### Part G — Docs + memory

17. Docs-subagent before every commit (per usual pattern): HANDOFF Recent shipping log, PROJECT-STATE new subsection "2026-04-21 — OG Prompt Lab data enrichment", new memory `project_og_lab_data_capture.md`.

18. Update `docs/state/STACK.md` to reflect the new analysis_json column on prompt_lab_sessions + the view.

### Must NOT do

- **Do NOT touch `src/pages/dashboard/PromptLab*.tsx`, `src/components/lab/*` (legacy), or the OG Lab UI in any way.** Zero UI changes.
- **Do NOT change API response shapes** of any `api/admin/prompt-lab/*` endpoint. Backwards compatibility is critical — the UI depends on them.
- Do NOT change the retrieval logic downstream (that's a future round — this brief only produces richer signal, doesn't consume it yet).
- Do NOT delete the original `tags` column or mutate existing iteration rows beyond the additive backfill columns.
- Do NOT touch Window B/C/D work. B Round 3 vocab cleanup + C bucket-progress + D grid are separate.
- Do NOT push to origin without Oliver's explicit go-ahead.

## Self-check protocol

Session log: `docs/sessions/2026-04-21-window-E.md`. Every ~45 min + each milestone, append a **Self-check**:

- **(a) Criterion served?** Expected: #2 via richer retrieval context + #4 via SKU recovery.
- **(b) Highest-leverage next step?** Pivot triggers:
  - Gemini backfill costs >$2 (much more than projected) → stop, investigate why.
  - Session-create endpoint has no clear insert point → leave the auto-analyze hook for a future round, ship Parts A + C + D + E + F.
  - Migration 032/033/034/035 collide with another in-flight migration → coordinate with B Round 3's migration 031 first.
- **(c) Evidence?** Dry-run outputs match expected counts? Migration applies clean via Supabase MCP? View returns expected row counts per surface? Cost-events logged for every API call?
- **(d) Pivot? → STOP, commit WIP, document.**

**Stuck >30 min:** commit WIP, write `docs/sessions/2026-04-21-window-E-blocker.md`, ping Oliver.

## Exit criteria (3 hours)

- [ ] Migrations 032, 033, 034, 035 applied to dev Supabase (MCP)
- [ ] `scripts/backfill-legacy-lab-gemini.ts` run + all legacy sessions have `analysis_json`
- [ ] `scripts/backfill-legacy-lab-embeddings.ts` run + all rated legacy iterations have `embedding`
- [ ] Session-create endpoint hooks Gemini analysis async (response shape unchanged — verify with a diff)
- [ ] `v_unified_rated_pool` view returns sensible counts per surface
- [ ] SKU recovery backfill run + report committed with %-recovered number
- [ ] Tag normalization run + coverage report committed
- [ ] `docs/audits/og-lab-data-capture-2026-04-21.md` with total cost spent + row counts per backfill step
- [ ] Committed in ≥5 logical chunks (one per Part)
- [ ] Docs-subagent run + HANDOFF/PROJECT-STATE/memory updated
- [ ] Zero UI changes confirmed via `git diff main -- src/` (should be empty aside from possibly type imports in the session-create backend if that lives under `api/`)

## Budget

**~$0.50 total.** Gemini backfill ~$0.40 + embeddings ~$0.02 + everything else is free. If spend exceeds $2, stop and flag.

## If you finish early

1. Add an "analysis coverage" metric column to the Rating Ledger endpoint (C's Round 1 work) — show `%_with_gemini_analysis` per surface as a hint to ML-loop health. Tiny extension, serves transparency.
2. Write a one-page `docs/state/ML-SIGNAL-PIPELINE-2026-04-21.md` explaining the data flow from photo upload → retrieval → director → clip → rating → embedding → next retrieval. Good cold-entry doc for future sessions.

## Success definition

When Oliver next opens the OG Prompt Lab and uploads a photo for a new session, the session row gets automatically enriched with Gemini camera-state signal in the background — invisible to him. Meanwhile all 108 historical legacy iterations now have motion_headroom + room_type + camera geometry on record. The retrieval system can surface legacy 5★ examples alongside listings-Lab 5★ examples with equivalent metadata shape, via a single view query. Oliver's UX: identical to before. His ML's input signal: much richer.
