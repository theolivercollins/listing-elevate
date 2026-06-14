# Listing Elevate — Documentation

Last updated: 2026-04-20

See also:
- [HANDOFF.md](./HANDOFF.md) — what's happening right now + single next action
- [state/PROJECT-STATE.md](./state/PROJECT-STATE.md) — authoritative state of the system
- [plans/back-on-track-plan.md](./plans/back-on-track-plan.md) — active roadmap
- [sessions/TEMPLATE.md](./sessions/TEMPLATE.md) — template for per-session handoff notes
- [archive/README.md](./archive/README.md) — what's archived and why

**If you're a new Claude session starting work on this project, read these three docs in order:**

1. [`HANDOFF.md`](./HANDOFF.md) — what's happening right now + the single next action
2. [`state/PROJECT-STATE.md`](./state/PROJECT-STATE.md) — authoritative state of the system
3. [`plans/back-on-track-plan.md`](./plans/back-on-track-plan.md) — active roadmap

## Session hygiene (required)

Every Claude session on this project MUST:
- **Use the `superpowers` plugin.** All planning, debugging, coding discipline flows through superpowers skills (`brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, etc.). Do not freelance without invoking the relevant skill.
- **Start by reading `HANDOFF.md`.** It's kept current and is the single source of truth for "where are we now."
- **Update `HANDOFF.md` before any push to `main`.** At minimum: add a one-line entry to the "Recent shipping log" with date, commit SHA, and what changed. If the next-action changes, update the "Right now" section too.
- **Never delete docs.** Archive to [`docs/archive/`](./archive/) with a note explaining why, and update [`archive/README.md`](./archive/README.md).

## Folder guide

| Folder | What lives here |
|---|---|
| [`product/`](./product/) | **Customer-facing product documentation** — the published help-center / user-guide content (getting started, ordering, sharing, FAQ). Written for agents, not engineers. |
| [`state/`](./state/) | Living docs — updated as the system evolves (PROJECT-STATE, STACK, TODO) |
| [`plans/`](./plans/) | Active roadmap + future backlog |
| [`specs/`](./specs/) | Design docs per feature. Specs that land become retired to archive once their plan fully executes. |
| [`audits/`](./audits/) | Point-in-time analyses (ML audits, cost reconciliations) |
| [`traces/`](./traces/) | Script outputs (director-prompt traces, etc.) |
| [`sessions/`](./sessions/) | Per-session handoff notes. Each long session SHOULD add one. |
| [`archive/`](./archive/) | Deprecated / superseded / paused docs. Preserved, never deleted. |

## Key code references

| Thing | Where |
|---|---|
| Production pipeline | `lib/pipeline.ts` |
| Director prompt | `lib/prompts/director.ts` |
| Providers (Kling, Runway, Atlas, Shotstack, dispatch) | `lib/providers/*` |
| Lab listings UI | `src/pages/dashboard/LabListing*.tsx` |
| Lab listings API | `api/admin/prompt-lab/listings/**` |
| Cost reconciliation | `scripts/cost-reconcile.ts` |
| Director trace audit | `scripts/trace-director-prompt.ts` |
| Retrieval RPC | `match_rated_examples` (Supabase, unified Lab + prod) |

## Environment + deploy

- Live URL: https://www.listingelevate.com
- Repo: `theolivercollins/reelready` on GitHub (rename to `listing-elevate` pending)
- Local main: `/Users/oliverhelgemo/real-estate-pipeline`
- Branch: `main` (direct-to-main with frequent commits + pushes; Vercel auto-deploys)
- No force-pushes. No rebases that rewrite pushed history.
- Side-branch clones on disk (stale, do not push to them):
  - `/Users/oliverhelgemo/real-estate-pipeline-finances` (branch `finances-tab`, out of date)
  - `/Users/oliverhelgemo/real-estate-pipeline-ui` (branch `ui-redesign`, out of date)

## Docs conventions (recap)

- Every file begins with a `Last updated: YYYY-MM-DD` line and a `See also:` block of relative links to related docs.
- No orphans. If you create a doc, link it from at least one neighbor.
- Archive, don't delete. `git mv` preserves history.
