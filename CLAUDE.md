# Listing Elevate — session-start brief

You are working on **Listing Elevate**, a fully-autonomous real-estate listing-video pipeline. Live at <https://listingelevate.com>. Zero human-in-the-loop is a hard product requirement.

## Read this in order on cold entry

1. `docs/HANDOFF.md` — right-now state, next action, recent shipping log
2. `docs/state/PROJECT-STATE.md` — authoritative project state
3. `docs/plans/back-on-track-plan.md` — active roadmap

## Branch model (3-tier, established 2026-05-05)

| Branch | URL | Crons |
|---|---|---|
| `main` | listingelevate.com | All 6 enabled |
| `staging` | listingelevate-git-staging-recasi.vercel.app | Disabled |
| `dev` | listingelevate-git-dev-recasi.vercel.app | Disabled |

**Promotion path:** `feat/* → dev → staging → main`. Always via PR + `git merge --no-ff`. Never direct-push to `staging` or `main`.

**Supabase is shared across all 3 envs** (cost decision: $120/yr saved by not running a separate staging project). App-layer isolation: any destructive code path must check `process.env.VERCEL_ENV === 'production'` OR `process.env.LE_ALLOW_NONPROD_WRITES === 'true'` before writing to `properties`, `scenes`, `cost_events`, storage, or triggering real provider renders.

## Ship-gate rules (non-negotiable)

1. **Use superpowers every session.** Brainstorm → write-plan → TDD → verify-before-completion → request-code-review.
2. **`docs/HANDOFF.md` updated before every push to `main`.** One line in the "Recent shipping log" with date + commit SHA + what changed. If next-action shifts, update "Right now" too.
3. **Never delete docs.** `git mv` to `docs/archive/<reason>/` and add a row in `docs/archive/README.md`. Reasons: `superseded-docs/`, `completed-plans/`, `paused-plans/`, `forks/`.
4. **Use `git mv`, not `cp + rm`** — preserves history.
5. **Cost tracking is first-class.** Every API call (Anthropic, Atlas, Kling, Runway, Luma, Shotstack, Apify, Browserbase, Stagehand, Gemini) writes to `cost_events`. Even $0 calls. Reconcile against invoices via `pnpm exec tsx scripts/cost-reconcile.ts`.
6. **All UI work follows `docs/design/DESIGN-GUIDE.md`.** One token scale (radius/spacing/shadows/type), shared `PageHeading` pattern, no page-level horizontal padding (the dashboard shell provides the gutter), no hardcoded radii/colors. Run its §9 checklist before shipping any new UI.
7. **No JetBrains Mono. No monospace UI text.** Oliver hates the JetBrains Mono treatment (called out 2026-05-14 on the home page "— The Process" eyebrow). The token `--le-font-mono` in `src/v2/styles/tokens.css` is intentionally aliased to the Inter sans stack; `.le-eyebrow` and `.le-mono` use `--le-font-sans`; `tailwind.config.ts` `fontFamily.mono` is also the Inter stack. Do not introduce new monospace font-family declarations for UI text — eyebrows, badges, captions, code views, log viewers, JSON dumps all stay in Inter. If a future feature genuinely requires a monospace face, define a NEW token (e.g. `--le-font-code`) and confirm with Oliver first.

## Run before pushing

- `pnpm run doctor` — surfaces stale worktrees, unmerged branches, doc rot, unapplied migrations, stale archive entries
- `/le-status` — same plus git status + last 5 commits + promotion lineage

## Specs go where

`docs/specs/YYYY-MM-DD-<topic>-design.md`. Plans go to `docs/plans/`. Per-session notes to `docs/sessions/YYYY-MM-DD-<topic>.md`.

## Authoritative consolidation spec

`docs/specs/2026-05-05-listing-elevate-consolidation-design.md` — the design that put this CLAUDE.md + governance system in place. Read on first session post-2026-05-05 to understand the topology.
