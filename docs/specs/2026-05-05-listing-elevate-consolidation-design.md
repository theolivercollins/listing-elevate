---
Last updated: 2026-05-05
See also:
- [../HANDOFF.md](../HANDOFF.md) — current state
- [../state/PROJECT-STATE.md](../state/PROJECT-STATE.md) — authoritative project state
- [../README.md](../README.md) — docs folder guide
---

# Listing Elevate — consolidation + 3-tier deployment + governance

**Date:** 2026-05-05
**Status:** Approved, executing
**Author:** Oliver + Claude (brainstorming session 2026-05-05)

## Problem

Repo organization has drifted. Three apparent "repos" turned out to be one GitHub repo (`theolivercollins/reelready`) with extra git worktrees parked at sibling folders (`~/real-estate-pipeline-ui` on branch `ui-redesign`, `~/real-estate-pipeline-finances` on branch `finances-tab`). 16 worktrees under `.worktrees/`, most stale since April. One Vercel project, one Supabase, no staging environment, no formal promotion path. Doc surface is mostly clean (April 21 consolidation `dc27158`) but `docs/briefs/` and `docs/traces/` are stale and should archive. The product name is `Listing Elevate` everywhere except the GitHub repo name (`reelready`) and local folder (`real-estate-pipeline`); rename was paused April 13 due to a file-revert ghost.

Goal: collapse this back into a single, named, well-governed repo with a 3-tier deployment path and a session-start system that keeps it organized without relying on memory.

## Design decisions

### 1. Repo + folder layout

- **One repo, one folder, no monorepo.** Existing single-app structure (Vite frontend + `api/` Vercel Functions + `lib/` shared + `supabase/migrations/` + `docs/`) stays as-is. Splitting into apps/packages would add toolchain churn for zero benefit at current scale.
- **Final names:**
  - GitHub: `theolivercollins/listing-elevate` (renamed via UI; `reelready` URL auto-redirects)
  - Local: `~/listing-elevate` (replaces `~/real-estate-pipeline`)
  - Vercel project: `listing-elevate` (renamed; project ID `prj_ZJRb76Pu05FHirZsHNH17MuJcL00` preserved so domains + env vars carry over)
- **Worktrees live only at `~/listing-elevate/.worktrees/<branch-name>/`** — no more cross-folder worktrees.

### 2. 3-tier deployment topology

One Vercel project, three long-lived branches:

| Branch | Vercel env | URL | Supabase | Crons |
|---|---|---|---|---|
| `main` | Production | `listingelevate.com` | **prod** (`reelready` project) | All 6 enabled |
| `staging` | Preview (auto URL) | `listing-elevate-git-staging-recasi.vercel.app` | **prod, shared** | Disabled |
| `dev` | Preview (auto URL) | `listing-elevate-git-dev-recasi.vercel.app` | **prod, shared** | Disabled |

- **Cost decision (revised 2026-05-05):** Original spec called for a separate `listing-elevate-staging` Supabase project. Cost check via Supabase MCP returned $10/month for a new project on the Recasi org's paid plan (not free as originally claimed). Decision: skip the separate project, share prod Supabase across all 3 envs, save $120/yr. Isolation moves to the app layer.
- Promotion: `feat/* → dev → staging → main`, each via PR + `git merge --no-ff`. No direct push to `staging` or `main`.
- Vercel auto-distinguishes Production from Preview via `VERCEL_ENV`; branch is in `VERCEL_GIT_COMMIT_REF`. No per-env Supabase config — same URL/keys everywhere.
- Crons fire on Production only by default — Vercel native behavior.
- **App-layer isolation (the missing piece, since Supabase is shared):** every destructive code path (write to `properties`, `scenes`, `cost_events`, `prompt_lab_*`, storage uploads, real provider renders) must check `VERCEL_ENV === 'production'` OR `process.env.LE_ALLOW_NONPROD_WRITES === 'true'` before proceeding. Doctor + governance hooks (Phase 5) enforce this convention by greppping for unguarded write paths.
- Pretty subdomains (`staging.listingelevate.com`, `dev.listingelevate.com`) deferred — `*.vercel.app` URLs work fine for an internal staging gate.

### 3. Doc + governance system

**Layer 1 — `CLAUDE.md` at repo root** (auto-loaded into every Claude Code session in this folder). Under 80 lines. Contents:
- Product one-liner + canonical name (`Listing Elevate`)
- The 3-branch / 2-Supabase topology
- Mandatory cold-entry read order: `docs/HANDOFF.md` → `docs/state/PROJECT-STATE.md` → `docs/plans/back-on-track-plan.md`
- Ship-gate rules: superpowers always, HANDOFF.md updated before every push to main, never delete docs (archive), `git mv` not `cp+rm`
- Branch promotion path
- Cost-tracking is first-class — every API call logs `cost_events`

**Layer 2 — hooks in `.claude/settings.json`:**
- **SessionStart** — print 5 lines: current branch, last HANDOFF.md update date, count of uncommitted changes, count of stale worktrees, "RUN `pnpm doctor` if anything looks off."
- **PreToolUse on `git push`** — block if:
  - branch is `main` AND `docs/HANDOFF.md` not modified in last 10 commits, OR
  - `*.test.ts` files exist with no recent run, OR
  - branch is `staging`/`main` AND no migration promoted via Supabase MCP since last `supabase/migrations/*.sql` change
- **Stop hook** — print next-action summary if work is in-progress

**Layer 3 — `pnpm doctor` (`scripts/doctor.ts`):**
- Worktrees: any older than 14 days with unmerged commits
- Branches: any merged-to-main branches still alive locally or remote
- Docs: any file in `docs/` whose `Last updated:` line is >30 days old
- HANDOFF: when last updated; show diff vs now
- Migrations: any local migration not yet applied to staging or prod
- Stale `archive/forks/` content
- Wired to `prepush` hook (informational, not blocking)

**Layer 4 — slash command `/le-status`** — runs `pnpm doctor` + git status + last 5 commits + current branch's promotion lineage in one shot.

**Archive convention:** `docs/archive/<reason>/` only. Reasons: `superseded-docs/`, `completed-plans/`, `paused-plans/`, `forks/`. Every archived file gets a row in `docs/archive/README.md` with date, reason, pointer. **`docs/briefs/` stops existing**; sessions write to `docs/sessions/YYYY-MM-DD-<topic>.md` only; old session notes archive monthly via `pnpm doctor --archive-old-sessions`.

### 4. Kill list

**Branches (delete after rename + ui-redesign tag):**
- `finances-tab` — merged to main 2026-04-14 → delete local + remote
- `ui-redesign` — superseded by main's new-shell → tag `archive/ui-redesign-2026-04`, delete branch + worktree
- `feat/iteration-order-id`, `feat/prompt-lab-listing-selection`, `feat/sku-affinity-self-refresh`, `feat/sku-motion-affinity`, `fix/*` (3 branches), `drive-ingest` — all Apr 24 → check merged → delete if merged
- `session/offline-2026-04-22-continuation` — session work captured in `docs/sessions/`, delete
- `feature/new-shell` — already on main → delete remote
- `feature/machine-learning-improvement`, `feat/ui-v3-design` — stale, tag-then-delete if unmerged
- Claude-generated branches (5) — delete remote

**Worktrees:** all 13 in `.worktrees/` + 2 sister-folder worktrees. Default: delete all 16. Keep only `feat/custom-listing-pages` if still actively in use.

**Docs to move:**
- `docs/briefs/*` (5 files) → `docs/archive/superseded-docs/2026-04-21-windows/`
- `docs/traces/*` (3 files) → `docs/archive/superseded-docs/director-traces-2026-04-22/`
- `docs/audits/*` (8 files) — audit each: keep current verdicts, archive old

**Code:** delete only after grep audit returns zero references (`src/`, `api/`, `lib/`, `scripts/`):
- `lib/providers/higgsfield.ts` + `scripts/test-higgsfield.ts` + `scripts/compare-higgsfield-vs-kling.ts`
- `lib/providers/runway.ts` (and `luma.ts` if not in use) — verify no recent `cost_events.provider = 'runway'`/`'luma'` rows
- `dist/` (build artifact) — add to `.gitignore` if not already

**NOT touched:**
- Legacy product names in code (`STORAGE_KEY = "keyframe_presets"`) — architectural terms, not product naming
- `.github/workflows/claude*.yml` — keep
- All migrations under `supabase/migrations/`

### 5. Execution order (each phase = checkpoint)

**Phase 0 — Canary** (5 min): trivial edit on `docs/HANDOFF.md`, wait, re-read. If reverted → STOP and escalate. If stuck → green light.

**Phase 1 — Branches & worktrees cleanup**: write `pnpm doctor`; tag stale-but-unmerged branches; delete merged branches local + remote; delete 16 worktrees; commit doc moves on the consolidation branch with `git mv`.

**Phase 2 — Staging Supabase + 3-tier branches**: create `listing-elevate-staging` Supabase project via MCP; dump+restore prod schema; create `staging` and `dev` branches; configure Vercel domains + per-env vars; smoke-test a `dev` deploy.

**Phase 3 — GitHub repo rename**: GitHub UI rename `reelready` → `listing-elevate`; `git remote set-url`; verify push/pull; rename Vercel project (project ID preserved).

**Phase 4 — Local folder rename + sister-folder removal**: close all editors/terminals on `~/real-estate-pipeline*`; `mv ~/real-estate-pipeline ~/listing-elevate`; delete `~/real-estate-pipeline-ui` and `~/real-estate-pipeline-finances`; update memory files.

**Phase 5 — Governance install**: `CLAUDE.md`, `.claude/settings.json` hooks, `scripts/doctor.ts`, `/le-status` command; update `docs/HANDOFF.md`; commit on `dev` → PR → `staging` → `main`. **Validates the new promotion path.**

**Phase 6 — Code deletes**: grep audit each candidate; delete unreferenced; single commit on `dev`; promote.

### Rollback notes

- Phases 1, 2, 5, 6 reversible per-action
- Phase 3 partially reversible (GitHub keeps redirect indefinitely)
- Phase 4 reversible via `mv` back

## Open questions (none blocking)

- Whether `feat/custom-listing-pages` (currently active, 3 commits ahead of main) should merge first or after consolidation — defer to user during Phase 1.
- Whether `credentials.env` (currently untracked, NOT gitignored — safety risk) should be added to `.gitignore` immediately as a side-quest. Recommend yes.

## Out of scope

- Migration to monorepo / turborepo / pnpm workspaces
- Renaming legacy code-level identifiers (`keyframe_presets`, `reelready` in `package.json` `name` field) — architectural terms, separate decision
- Setting up CI test gates (current `.github/workflows/` only run Claude review/comment hooks)
- Migrating any data between Supabase projects (staging starts empty)
