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

## Run before pushing

- `pnpm run doctor` — surfaces stale worktrees, unmerged branches, doc rot, unapplied migrations, stale archive entries
- `/le-status` — same plus git status + last 5 commits + promotion lineage

## Specs go where

`docs/specs/YYYY-MM-DD-<topic>-design.md`. Plans go to `docs/plans/`. Per-session notes to `docs/sessions/YYYY-MM-DD-<topic>.md`.

## Authoritative consolidation spec

`docs/specs/2026-05-05-listing-elevate-consolidation-design.md` — the design that put this CLAUDE.md + governance system in place. Read on first session post-2026-05-05 to understand the topology.

## Self-service unblock policy (added 2026-05-14)

**Never make Oliver do work you can do yourself.** Before pausing to ask, exhaust these in order:

1. **Credentials live in `docs/CREDENTIALS.md`.** Any API key, secret, password, or service URL you need is there. `grep -i` it before asking. If it's missing, ask Oliver to add it to that file (don't ask for the value in chat — it should land in the credentials doc so future sessions find it too).
2. **Use the MCP servers.** Available MCPs: **Supabase** (apply migrations, run SQL, list tables, get logs/advisors), **Vercel** (auth, deploy ops), **Gamma** (presentations). For Supabase ops always prefer the MCP over CLI/dashboard. If you need an MCP that isn't installed (Stripe, GitHub, Slack, Linear, etc.), tell Oliver the exact MCP package name and what you'll use it for — don't ask him to do the operation manually.
3. **Use provider REST APIs directly.** When no MCP exists (e.g. Stripe webhooks, ElevenLabs voice management), call the API yourself with `curl` + the secret from credentials.md. Don't ask Oliver to click through a dashboard for something an HTTP call can do.
4. **Only escalate to Oliver when you genuinely cannot proceed** — the work needs a decision he hasn't made, requires a physical action (recording a voice sample), or hits a destructive operation gated by his "no destructive ops without permission" rule (git push, prod deploy, schema drop).

When you do escalate, propose the answer first and ask for ratification rather than asking him to think from scratch.
