---
Last updated: 2026-06-18
See also:
- [../HANDOFF.md](../HANDOFF.md) — current state
- [../state/PROJECT-STATE.md](../state/PROJECT-STATE.md) — authoritative project state
- [../README.md](../README.md) — docs folder guide
- [2026-05-05-listing-elevate-consolidation-design.md](2026-05-05-listing-elevate-consolidation-design.md) — governance topology this builds on
---

# Autonomous coding loop — thin workflow OS

**Date:** 2026-06-18
**Status:** Proposal — pending Oliver's approval (not yet executing)
**Author:** Oliver + Claude (synthesis of two independent analyses, 2026-06-18: this-session Claude + Codex, which converged on the same core)

## Decisions locked (2026-06-18)

1. **Repo-agnostic from day 1.** The planner, decision-packet, and verify-gate are built as project-parameterized skills — each repo carries its own config (gate commands, guardrails, work-categories). Listing Elevate is the first project, not the only one. Pointing it at a second repo later is config, not a rebuild.
2. **Human interface = a chat bot + a live dashboard, not a Claude Code session.** Set weekly goals and answer decisions from your phone (Telegram, plain English + tap-to-decide); watch everything on a mobile web dashboard. Daily runs fire on a cron — you never start one. Detail in §8.
3. **Autonomy starts safe and widens with trust** (phased, §11). Only menial + standard run unattended at first; anything touching production, money, or security stays behind human approval **permanently**.
4. **The "why are you asking me this?" rule.** A decision only ever reaches you if (a) your answer changes a real outcome and (b) the stakes are obvious in one plain-English line. If you'd react with "why is this a question," the system must not ask it — it takes a sensible default instead.

## Problem

Goal: **fully autonomous coding with ≤1 hour of human involvement per day**, at accuracy close to the current supervised orchestrator loop. Build a super-automated workflow; if there's a simpler path to the same accuracy, take it.

Two independent analyses (Claude + Codex) reached the same conclusions, which is the strongest signal available that the core is right:

1. **"100% autonomous at 100% accuracy" is not achievable today.** Autonomy trades accuracy for throughput. The only way to buy the accuracy back is to **move correctness out of agent judgment and into hard, independent gates** (tests, typecheck, lint, build, run-the-app, diff review, security review, cross-model refutation, PR checks, prod-approval rules).
2. **A deep org chart is the wrong unit of design.** Human orgs have managers-of-managers to solve span-of-control, incentives, and information siloing — problems agents don't have. Porting a 4-rank hierarchy (+ peer-review doubles) imports the *cost* of hierarchy (every tier = latency + tokens + translation loss; error compounds at each hop) with none of the benefit.
3. **The accuracy lever is verification against ground truth, not management depth.**
4. **Don't rebuild the substrate.** Listing Elevate already has the orchestration layer: the subagent-driven loop, 21 routed bench agents, worktree isolation, superpowers, MCP servers, `cost_events`. The work is a small **delta** wrapped around that loop, not a new platform.

The 1-hour/day target is realistic **only if** the human's time is confined to: weekly priorities, product decisions, blocked credentials, production approvals, and final ship/don't-ship calls. Never code review.

## Design principles

These are load-bearing; every decision below traces to one.

1. **Hierarchy depth is a cost, not a feature.** Flat brain + stateless workers. Review and verification are *gates*, not *ranks*.
2. **Accuracy lives in gates, not judgment.** A task is correct because it passed independent checks, not because an agent said so.
3. **Artifacts, not chatter.** Agents produce briefs, diffs, specs, and test output. They do not hold conversations. The artifact is the interface and the audit trail.
4. **Least privilege.** Each agent gets the narrowest tool/scope set that lets it do its one job. **Only the PR agent may stage, commit, push, or open PRs.**
5. **Independence of the verifier.** The agent that checks work is never the agent that produced it; the strongest check is a *different model* trying to refute.
6. **Depth is earned by scale.** Start flat (one repo, one human). Add a Workstream-Lead layer only when concurrent cross-repo initiatives exceed what one orchestrator can hold.
7. **Bias to escalation over green-reporting.** When uncertain, stop and queue a decision. Distrust a confident "PASS." (Prior incidents: a "PASS" shipped with work stranded on a stray branch; a local driver rendered the wrong Creatomate template while logs looked green.)
8. **Map failure modes to mechanisms, not managers** (see §3.4).

## Design decisions

### 1. Architecture — the flat loop

```
weekly goals
   → daily session briefs
      → worktree isolation
         → orchestrator (decompose · dispatch)
            → stateless workers (one task each)
               → verify gate (independent)
                  → pass → PR agent → commit / open PR
                  → fail / ambiguous → daily decision packet → you
```

| Role | Identity | Does | Never does |
|---|---|---|---|
| **You** | the only human | weekly goals; clear the daily decision packet; approve prod ships; unblock credentials | code review; routine task triage |
| **Planner** | a skill | turns approved goals into daily **session briefs** (acceptance criteria + exact verification commands + files in scope) | write code; push |
| **Orchestrator** ("Handler" / Hermes) | the existing main Opus session, **cron-fired** instead of human-typed | decompose briefs into Karpathy-minimal tasks; dispatch waves; integrate; assemble the decision packet | write code; push; review its own output |
| **Workers** | the 21 routed bench agents, in isolated worktrees | implement one task each, TDD, commit forensically to their own branch | push to shared branches; touch files outside scope |
| **Gatekeepers** | code-reviewer, security-auditor, qa-verifier, test-runner, cross-model refuter, **PR agent** | independently verify; the PR agent alone stages/pushes/opens PRs | implement the code they review |

**This is two effective tiers** (orchestrator brain + stateless workers) with verification as a set of gates. It is *not* four ranks. "Handler 2" from the original sketch is not a manager — it is the **cross-model refuter** inside the verify gate (§5).

### 2. Mapping to what already exists (reuse, don't rebuild)

| Need | Existing asset — reuse as-is |
|---|---|
| Orchestrator brain | main Opus session + `superpowers:subagent-driven-development` |
| Workers | the 21 bench agents (`typescript-pro`, `react-specialist`, `sql-pro`, …), routed per task |
| Isolation | git worktrees (mandatory, one per task — §7) |
| Review / QA / security | `code-reviewer`, `qa-verifier`, `security-auditor`, `test-runner` |
| Process discipline | superpowers (brainstorming → writing-plans → TDD → verify-before-completion → code-review → finishing-a-development-branch) |
| Cost tracking | `cost_events` + `scripts/cost-reconcile.ts` |
| Platform ops | Supabase + Vercel MCP servers |

**Explicitly NOT used:** agent teams (retired here on 2026-06-14 as `team-code`, archived at `~/.claude/backups/archived-agent-team-2026-06-14/`; experimental + token-heavy — do not revive); a 4-rank hierarchy; a skill per task category; re-platforming the orchestrator to opencode. OpenRouter is used for exactly one seat — the cross-model refuter (§5).

### 3. Roles, privilege, scaling, and failure-mode mapping

**3.1 Privilege table (least privilege).** Enforced via subagent tool restrictions.

| Agent | Read | Write source | Run cmds | Push / PR |
|---|---|---|---|---|
| Planner | ✅ | ❌ | ❌ | ❌ |
| Orchestrator | ✅ | ❌ (delegates) | ✅ (verify only) | ❌ |
| Worker (implementer) | scope only | scope only | ✅ | ❌ |
| Gatekeepers | ✅ | ❌ | ✅ | ❌ |
| **PR agent** | ✅ | ❌ | ✅ | ✅ **(sole authority)** |

**3.2 When to add depth.** At one repo with one human, the Planner and Orchestrator nearly merge — keep them as skills, not separate standing agents. **Add a "Workstream Lead" layer** (one temporary owner per repo / product area / initiative, converting goals into briefs) **only when 3+ concurrent initiatives across repos** exceed one orchestrator's working set. Depth follows scale.

**3.3 Active-agent cap.** For *interdependent* work, default **3–5 active agents** (coordination cost grows with size). For *disjoint-scope* work, go **wide (up to ~16 parallel)** — coordination cost is ~0 when file scopes don't overlap. The deciding variable is dependency, not a fixed number.

**3.4 Failure mode → mechanism (not a manager).**

| Failure mode | Mechanism |
|---|---|
| Context bloat | stateless worker, minimal brief, fresh per task |
| Goal drift | brief's acceptance criteria attached to the task; gate checks diff *against it* (`qa-verifier`) |
| Self-preferential bias | cross-model refuter in the gate (§5) |
| Agentic laziness | "evidence before assertions" — the app must actually run; gates emit artifacts |
| Scope creep | auto-escalation trigger when a worker expands scope (§6) |

### 4. Work categories

Defined as markdown files the planner and orchestrator read (`docs/autonomy/work-categories.md`). A task gets a category at creation; it can be **re-categorized** mid-flight (auto-bumped on the §6 triggers).

| Category | Examples | Default model | Required gates | Human approval |
|---|---|---|---|---|
| **Menial** | formatting, copy, config, mechanical refactor, wiring | Haiku | typecheck · lint · build | no |
| **Standard** | isolated bugfix or small feature with tests | Sonnet | + tests · diff review · run-app smoke | no |
| **Advanced** | cross-module feature, UI workflow, data model, dev-only migration | Opus + reviewer | + qa-verifier · cross-model refute | no (unless touches risky surface) |
| **Expert** | production, security, payments, RLS, destructive data, architecture | top model + independent refuter | **all** gates + security-auditor | **yes — always** |

Model tiers follow the existing ladder; decompose so most work lands on Haiku/Sonnet.

### 5. The hard-gate spine (the accuracy guarantee)

**Definition of done:** a task is done only when **every gate applicable to its category passes**, each emitting a pass/fail artifact. No task is "done" with an open gate item.

| Gate | Command / mechanism | Notes |
|---|---|---|
| **Typecheck** | `pnpm exec tsc --noEmit` | **Must be added as a `typecheck` script — it does not exist today.** Vite/Vercel build never runs `tsc`, so runtime `ReferenceError`s ship to prod. This gate closes a known prod-incident class. |
| Lint | `pnpm run lint` (`eslint .`) | |
| Build | `pnpm run build` (`vite build`) | |
| Tests | `pnpm run test` (`vitest run`) | Brief must include tests that **encode the acceptance criteria**, not just "tests pass." |
| **Run-the-app + observe** | `pnpm run dev` + Claude Preview / browser MCP (screenshot + console) | UI/route smoke only. **Do NOT drive the render pipeline locally** — local `.env` is a subset of prod (missing Creatomate `_30` template id, Bunny config); pipeline runs go in-studio/prod. |
| Diff review | `code-reviewer` agent | correctness first, then maintainability |
| Security review | `security-auditor` agent | required on auth / RLS / API routes / webhooks / payments / secrets / migrations |
| **Cross-model refute** | non-Claude model via **OpenRouter** | an *independent* model tries to **refute** the diff against the brief; default verdict "refuted" if uncertain. This is "Handler 2." |
| QA vs request | `qa-verifier` agent | checks the diff against the **verbatim** brief — catches "looks done but isn't" |
| Pre-push hygiene | `pnpm run doctor` | stale worktrees, unmerged branches, doc rot, unapplied migrations |
| Cost recorded | every agent + provider call → `cost_events`; reconcile via `scripts/cost-reconcile.ts` | first-class, even $0 calls |
| PR checks | CI + Vercel preview | final gate before merge |

**LE-specific guardrails the gate must enforce:** any destructive path must check `VERCEL_ENV === 'production'` or `LE_ALLOW_NONPROD_WRITES === 'true'` before writing to `properties`, `scenes`, `cost_events`, storage, or triggering real renders. Storage/video = Bunny, not Supabase Storage. No new monospace UI fonts (DESIGN-GUIDE §9).

### 6. Escalation

**Auto-escalate (bump category and/or queue a decision) when any trigger fires:**

- tests fail twice on the same task
- any gate fails N times (default N=3) → stop, don't grind
- the task touches shared infra (migrations, auth, shared `lib/`)
- acceptance criteria are vague / unverifiable
- production credentials are required
- the worker **expands scope** beyond the brief's file set
- the daily token ceiling is approached

**What escalation does:** the worker/orchestrator **stops**, packages the blocker, and adds it to the daily decision packet (§8). It does **not** wake the human unless the item is both blocking *and* time-sensitive (then: push notification). Default is queue, not interrupt.

**Model escalation** on struggle follows the existing ladder (Haiku → Sonnet → Opus → Fable) before a task is declared blocked; never retry the same model unchanged.

### 7. Isolation (mandatory for unattended runs)

One **git worktree per task**, on a uniquely-named branch off a clean base. Same-wave workers run in parallel **only** when file scopes are disjoint; overlapping scopes serialize into later waves or get per-worker worktrees. No worker ever switches branches or pushes to a shared branch. Branches converge only at the gated PR step. This is already mandatory practice; unattended parallelism makes it non-negotiable.

### 8. The daily decision packet (the human interface)

The orchestrator collects **all** questions raised across the day's runs, **dedupes** them, and converts each into a **multiple-choice decision with a recommended default**. One dashboard, cleared in the daily hour.

Each item: `{ context · the decision · options A/B/C (one marked recommended) · impact · what's blocked on it }`.

**Human-only items (never delegated, ever):** product decisions, blocked credentials, production approvals, ship/don't-ship.

**Delivery — chat bot + live dashboard (locked 2026-06-18).** The interface is two surfaces over a shared store, so everything is managed from your phone with minimum involvement:

- **Chat bot — BUILT 2026-06-19 via the official Claude Code Channels plugin** (`telegram@claude-plugins-official`, bot @oliverhelgemo_cc_bot), NOT a custom Vercel Chat SDK bot. It drives a real Claude Code session; permission relay sends 🔐 tap-to-approve prompts to Telegram; Oliver is pre-authorized in `~/.claude/channels/telegram/access.json` (no pairing). Run in a TTY/tmux: `claude --channels plugin:telegram@claude-plugins-official`. This is the live chat *surface*; the goals-in / decision-packet-out wiring still depends on the autonomous engine (§10) being built.
- **Live dashboard (mobile web, Next.js on Vercel).** Read view of everything: runs in flight, what shipped, open decisions, costs, PR links.
- **Shared store (Supabase).** Single source of truth all three write to / read from. Bot, daily runs, and dashboard never call each other synchronously — they communicate through the store (artifacts, not chatter, same as the agents).
- **Daily runs fire on a cron** (§9); you never start one. A run reads goals + answered decisions from the store, does the work, writes results + new decisions back. New decisions notify the bot (Supabase Realtime, or the run calling the bot's send API).

**Build order:** MVP = cron run + bot (goals in, decisions + end-of-day summary out); the bot's `status` command covers "see everything" until the dashboard lands as the fast-follow.

### 9. Weekly + daily cadence

- **Monday:** goal-setting session. Planner proposes the week's goals from the roadmap/backlog; you approve/edit. This is the bulk of the week's human hour-budget.
- **Daily (cron-fired):** planner builds the day's session briefs → orchestrator runs the loop unattended → gates run → decision packet assembled → you clear it (~most days <1 hr; often minutes).
- **Trigger:** a scheduled task / cron fires the orchestrator. No human keystroke required to start a run.

### 10. What to build (the delta)

Reuse §2; build only this:

1. **`planner` skill** — roadmap/backlog → weekly goals → daily session briefs (acceptance criteria + verification commands + file scope).
2. **`decision-packet` skill** — collect → dedupe → format escalations into the daily multiple-choice dashboard.
3. **`verify-gate` harness** — runs the full §5 gate spine for a task's category, emits a pass/fail artifact; includes the cross-model refuter.
4. **cross-model refuter** — OpenRouter integration for one non-Claude refute pass.
5. **cron trigger** — fire the orchestrator on schedule.
6. **`docs/autonomy/work-categories.md`** + the gate-by-category matrix.
7. **`typecheck` npm script** (`tsc --noEmit`) — closes the prod-incident gap.
8. **escalation-trigger logic** — lives in the orchestrator skill.
9. **repo-agnostic config layer** — per-project config (gate commands, guardrails, work-categories) so the skills aren't LE-hardcoded; LE is project #1.
10. **shared store** — Supabase tables (goals, runs, tasks, decisions, ships, costs), keyed by project; the bus between bot, runs, and dashboard.
11. **chat bot** — ✅ DONE (2026-06-19): official Claude Code **Channels** plugin (Telegram), not a custom Chat SDK bot. Bot @oliverhelgemo_cc_bot, pre-authorized in access.json, permission-relay on.
12. **live dashboard** — Next.js on Vercel, mobile-first, read view of the store.

### 11. Rollout (earn trust in phases)

- **Phase 0 — assisted:** you kick off each run; it executes the full loop + gates; you review every PR. Goal: prove the gates catch real issues. Measure gate catch-rate, escalation quality, cost/task.
- **Phase 1 — semi-autonomous:** cron-fired for **menial + standard** only; advanced/expert still need your kick-off; you clear the daily packet.
- **Phase 2 — autonomous:** menial → advanced run unattended; **expert + all prod ships always human-gated.** Human hour = packet + weekly goals + prod approvals.

**Kill-switches (all phases):** daily token ceiling; max fix-loops per task; auto-pause on repeated gate failures; **hard stop on any prod write without explicit approval.**

### 12. Cost model (first-class)

- Every agent call + provider call writes to `cost_events` (even $0).
- Per-run and per-day **token ceilings**; orchestrator tracks spend against the ceiling and stops at the cap.
- Model policy mapped to categories (cheap models maximized; §4).
- Track: cost/task by category, gate overhead, escalation rate, human-minutes/day.

## Decisions & remaining picks

**Locked (2026-06-18)** — see the Decisions-locked block up top:
- Repo-agnostic from day 1.
- Human interface = chat bot (Telegram) + live dashboard (§8).
- Autonomy phased, starting safe; expert (prod / money / security / destructive data) human-gated permanently (§11 Rollout).
- The "why are you asking me this?" rule governs what reaches the decision packet (§8).

**Remaining build-time picks (low stakes, defaults set):**
1. **Cron cadence** — default: one run early each morning; tune later.
2. **Cross-model refuter model** — default: a strong non-Claude model via OpenRouter; finalize at build.
3. **Bot platform** — Telegram first; Slack is a drop-in via the same Chat SDK adapter.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Autonomy theater (green reports, hidden errors) | independent gates + run-the-app + cross-model refute + bias-to-escalate |
| Cost blowup (runaway fix-loops) | token ceilings + max-loops + auto-escalate instead of grind |
| Parallel clobbering | mandatory worktree-per-task |
| Prod incidents | expert category always human-gated; non-prod write guard; prod ship needs explicit approval |
| Stranded work | `finishing-a-development-branch` discipline; verify nothing stranded before "done" |
| Reviving retired complexity | agent teams stay retired; OpenRouter only for the refuter seat |
