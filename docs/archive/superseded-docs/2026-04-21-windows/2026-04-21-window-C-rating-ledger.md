# Round 1 — Window C — Rating Ledger UI

Last updated: 2026-04-21
Branch: `session/ledger-2026-04-21`
Worktree: `/Users/oliverhelgemo/real-estate-pipeline/.worktrees/wt-ledger`

## Your mission

Build `/dashboard/rating-ledger` — a page where Oliver can see **every rating he has ever given**, and each rating row visibly links to the source image, the generated clip, the SKU that produced the clip, the stars, the rating reasons, the comment, and whether that rating is currently influencing retrieval. Right now Oliver cannot see this, so his ratings "feel like they go into an abyss." That visibility is the centerpiece deliverable of Round 1.

## North Star you are serving

Criterion **#1 — no HITL** (by making the ML-loop transparent so Oliver can trust autonomous behavior) AND setting up the audit surface for criterion **#2 — no hallucinations** (so mismatches between rating and rendered clip become visible).

## Required reading (in order, before any edits)

1. `/Users/oliverhelgemo/real-estate-pipeline/docs/HANDOFF.md`
2. `/Users/oliverhelgemo/real-estate-pipeline/docs/state/PROJECT-STATE.md`
3. `/Users/oliverhelgemo/real-estate-pipeline/docs/specs/2026-04-21-daily-engagement-design.md` (the plan)
4. `/Users/oliverhelgemo/real-estate-pipeline/docs/audits/ML-AUDIT-2026-04-20.md` (understand the three rating surfaces before unifying them)
5. `/Users/oliverhelgemo/real-estate-pipeline/docs/README.md` — code-reference table
6. Code orientation (read, do not edit yet):
   - `src/pages/dashboard/LabListing*.tsx` — existing Lab UI conventions
   - `api/admin/prompt-lab/**` — existing Lab API shape
   - `lib/db.ts` — schema types for the three rating sources

## Data sources you unify into one ledger row

1. **Legacy Prompt Lab:** `prompt_lab_sessions` + `prompt_lab_iterations` (single-photo flow Oliver used for San Massimo / Manasota Key / Kittiwake)
2. **Phase 2.8 listings Lab:** `prompt_lab_listings` + `prompt_lab_listing_scenes` + `prompt_lab_listing_scene_iterations` (the unified Dev Lab)
3. **Production:** `scene_ratings` (prod property ratings) joined to `scenes` + `clips` + `photos`

## Scope

### Must do

1. **Create `api/admin/rating-ledger.ts`** (or a route under the existing `api/admin/prompt-lab/` tree — whichever matches current conventions). It returns one unified schema regardless of source surface. Suggested shape:
   ```ts
   type LedgerRow = {
     surface: 'legacy_lab' | 'listings_lab' | 'prod';
     rated_at: string;          // ISO timestamp
     rating: number | null;     // 1–5
     rating_reasons: string[] | null;
     user_comment: string | null;
     source_image_url: string | null;   // the photo that was fed in
     clip_url: string | null;            // the rendered video
     sku: string | null;                 // model_used / provider model
     provider: string | null;            // kling | atlas | runway
     listing_name: string | null;        // for cross-surface identification
     scene_id: string | null;
     iteration_id: string;               // primary key in the row's table
     // presence signals:
     has_embedding: boolean;             // iteration.embedding IS NOT NULL
     has_model_used: boolean;            // any SKU field populated
     recipe_id: string | null;           // if a recipe was minted from this rating
   };
   ```
   Paginate: `?limit=50&offset=N&sort=rated_at&surface=<any>`. Filter: `?surface=`, `?sku=`, `?min_rating=`, `?has_comment=`.
2. **Create `src/pages/dashboard/RatingLedger.tsx`** (or equivalent under the current dashboard routing convention — check `src/pages/dashboard/` for the pattern). Render a table:
   - Columns: image thumb → clip preview (hover-play or small inline `<video>` poster) → SKU chip → ★★★★★ → reasons chips → comment excerpt → surface chip → retrieval-status chip (read-only, data: `has_embedding` + `has_model_used` booleans → green if both true, amber if partial, red if missing)
   - Filters in a toolbar: surface, SKU, min rating, has-comment
   - Default sort: rated_at DESC
3. **Wire the route.** Add to whatever router/navigation the existing dashboard uses. Link it in the nav so Oliver can find it.
4. **Smoke test.** Open the page locally (`npm run dev`). Confirm: at least 3 rows render, each from a different surface if possible. At least one image thumb + one clip preview actually load.
5. **Update docs + memory via docs-subagent (see below).**
6. **Commit in ≥3 logical chunks** on your branch.

### Must NOT do

- Do not change the database schema. Read-only consumption.
- Do not change how ratings get written — only how they're displayed.
- Do not add filters or features beyond the must-do list. The scope is "make existing data visible," not "make it prettier."
- Do not edit files outside this worktree.
- Do not push.

## Self-check protocol (MANDATORY)

Keep a live session log at `/Users/oliverhelgemo/real-estate-pipeline/docs/sessions/2026-04-21-window-C.md`. Every ~45 minutes + at every milestone, append a **Self-check** answering:

- (a) Which of Oliver's 4 criteria am I serving? (Expected: #1 no HITL — via transparency.)
- (b) Is this step the highest-leverage next step, or would a different approach close the gap faster? (Example pivot: if unifying 3 surfaces is taking >1h, ship a version that shows ONE surface first and iterate. Oliver seeing SOMETHING is better than seeing nothing.)
- (c) Evidence it's working? (Page renders locally? Rows show? Thumbs load? SQL returns rows?)
- (d) If (b) says pivot — stop, commit WIP, document the pivot.

**If stuck >30 minutes:** commit WIP, write `docs/sessions/2026-04-21-window-C-blocker.md`, ping Oliver.

## Docs-subagent (before every commit)

Dispatch a Sonnet subagent:

> "Update `/Users/oliverhelgemo/real-estate-pipeline/docs/HANDOFF.md` (one-line Recent shipping log entry). Update `/Users/oliverhelgemo/real-estate-pipeline/docs/state/PROJECT-STATE.md` to mention the new Rating Ledger route. Add a memory file at `/Users/oliverhelgemo/.claude/projects/-Users-oliverhelgemo/memory/project_rating_ledger.md` (type: project) summarizing what the Ledger is + where it lives. Then `git status`, confirm only files in `.worktrees/wt-ledger/` are touched, commit."

## Exit criteria (3 hours)

- [ ] `api/admin/rating-ledger` endpoint returns a unified JSON for all three surfaces (paginated).
- [ ] `/dashboard/rating-ledger` route opens locally, renders ≥3 rows across ≥2 surfaces.
- [ ] At least one row shows: image thumb, clip preview, SKU, stars, reasons/comment, surface, retrieval-status chip.
- [ ] At least one filter works (e.g., surface filter).
- [ ] Committed in ≥3 chunks on `session/ledger-2026-04-21`.
- [ ] Session log exists with self-check entries.
- [ ] Docs-subagent has run.

## Budget

Zero renders. This is a read-only UI. If you touch anything that costs money, STOP.

## If you finish early

Do NOT freelance into Window B or D territory. Instead: add a summary-stats strip at the top of the Ledger — counts per surface (legacy / listings / prod), average rating, % with comments, % with retrieval-ready data. This primes Round 2's coverage-heatmap polish.
