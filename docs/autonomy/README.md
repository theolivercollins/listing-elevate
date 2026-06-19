---
Last updated: 2026-06-19
See also:
- [../specs/2026-06-18-autonomous-coding-loop-design.md](../specs/2026-06-18-autonomous-coding-loop-design.md) — full design spec
- [work-categories.md](work-categories.md) — category rubric, gate matrix, escalation triggers
- [../HANDOFF.md](../HANDOFF.md) — current project state
---

# Autonomy module — overview

The autonomy module is a thin orchestration wrapper around the existing subagent-driven loop that lets the system execute daily coding work unattended, gate every task independently, and surface only the decisions that actually require a human.

## What it is

A **flat loop** — no management hierarchy, no peer-review doubles, no re-platforming:

```
weekly goals
  → daily session briefs (planner)
      → worktree isolation (one per task)
          → orchestrator (decompose · dispatch waves)
              → stateless workers (one task each, TDD)
                  → verify gate (independent; see work-categories.md)
                      → PASS → PR agent → commit / open PR
                      → FAIL / blocked → daily decision packet → human
```

Roles:

| Role | What it does | What it never does |
|---|---|---|
| **Planner** | turns approved goals into daily session briefs (acceptance criteria + verification commands + files in scope) | writes code; pushes |
| **Orchestrator** | decomposes briefs into Karpathy-minimal tasks; dispatches waves; assembles the decision packet | writes code; pushes; reviews its own output |
| **Workers** | implement one task each in isolated worktrees, TDD, commit forensically | push to shared branches; touch files outside scope |
| **Gatekeepers** | independently verify (code-reviewer, security-auditor, qa-verifier, test-runner, cross-model refuter, PR agent) | implement the code they review |

The accuracy guarantee lives in the gates, not agent judgment. See [work-categories.md](work-categories.md) for the full gate spine and which gates are required per category.

## Where things live

| Path | What's there |
|---|---|
| `.autonomy/config.json` | Per-project config: gate commands, guardrails, token ceilings, project ID. LE is project #1; the skills are repo-agnostic — pointing at another repo is a config change, not a rebuild. |
| `.autonomy/goals.md` | Current approved goals (weekly + per-run overrides). Planner reads this; human edits this. |
| `.autonomy/state/` | Run state, task status, decision packet, cost accumulator. Shared Supabase is the source of truth; this is the local mirror. |
| `scripts/autonomy/` | Planner skill, decision-packet skill, verify-gate harness, cross-model refuter, cron trigger, escalation logic. |
| `docs/autonomy/` | This README + [work-categories.md](work-categories.md) (rubric the planner and orchestrator read). |

## NOT armed by default

> **Autonomy is not armed by default. Everything is manual-invoke. Cron triggers, auto-commit, and auto-merge are OFF until explicitly enabled.**

Phase 0 (current): every run is human-kicked-off; every PR is human-reviewed. Cron and unattended execution are enabled only after Phase 0 proves the gates catch real issues. Expert-category tasks (production, security, payments, destructive data) require human approval permanently — no phase removes that gate.

See the full rollout plan in [the design spec §11](../specs/2026-06-18-autonomous-coding-loop-design.md).
