# Autonomy runbook

Last updated: 2026-06-19

See also:
- [README.md](README.md) — module overview
- [work-categories.md](work-categories.md) — category rubric and gate matrix
- [skills/daily-run.md](skills/daily-run.md) — full orchestrator skill (the loop)
- [config.md](config.md) — config reference

---

## Today's flow (manual — default)

Everything is OFF by default. No cron, no auto-commit, no auto-merge. You kick off each run, review every proposed PR, and merge manually. This is the recommended operating mode.

### 1. Write your goals

Edit `.autonomy/goals.md`. Two formats are supported:

**Flat list** — goals that apply every day:
```markdown
- Fix the cost_events insert for Kling renders
- Add a smoke test for the /api/health endpoint
```

**Day-keyed sections** — goals for a specific date:
```markdown
## Weekly
- Keep dependencies up to date

## 2026-06-19
- Fix the cost_events insert for Kling renders
- Add a smoke test for the /api/health endpoint
```

Goals under `## Weekly` or `## Goals` are always included. Goals under other day headings are ignored unless they match the run date.

### 2. Run the deterministic launcher

The launcher handles the planning, pre-flight gate, and decision-packet steps. It does NOT write code.

```bash
pnpm exec tsx scripts/autonomy/daily-run.ts
```

Or for a specific date:

```bash
pnpm exec tsx scripts/autonomy/daily-run.ts --date=2026-06-19
```

Dry-run (no state writes, no Telegram):

```bash
pnpm exec tsx scripts/autonomy/daily-run.ts --dry-run
```

Output:
- Prints the advisory banner (unattended is off by default)
- Runs the planner and prints the enriched session plan
- Runs the pre-flight verify-gate
- Flushes any pending decisions to Telegram
- Writes `<stateDir>/runs/<date>.json`

The launcher exits 0 if the pre-flight gate passes, 1 if it fails. A failed pre-flight means the repo was already broken before you started — fix the gate before driving the coding loop.

### 3. Drive the coding loop from your Claude session

Open the session where you want to run the work. The orchestrator reads `docs/autonomy/skills/daily-run.md` and follows it:

> "Follow docs/autonomy/skills/daily-run.md for today's daily run."

The skill tells Claude to:
- Pick up the plan from `<stateDir>/session-plan-<date>.json`
- Dispatch implementer subagents for each non-Expert task (one worktree per task)
- Run the full review + refuter + qa-verifier gate chain
- Print the `git commit` and `gh pr create` commands for each passing task — but NOT run them (autoCommit is off)

You review the proposed commands. When you are satisfied, run them yourself or reply "go ahead" to have Claude run them.

Expert-category tasks are always skipped — Claude writes a decision JSON and you receive it via Telegram.

### 4. Review and merge the PRs

Each passing task produces one PR on branch `autonomy/<date>-<spec-id>`. Review the PR normally. Merge when you are happy. The autonomy system never merges without your explicit action.

### 5. Review pending decisions

Decisions are sent to Telegram by the decision-packet step. Each decision lists the question, options, and what is blocked. Reply with your choice and drive the blocked task manually or in the next run's goals.

---

## Arming autonomy (advanced, opt-in)

The following switches enable progressively more unattended operation. Each is OFF until you explicitly set it. A prior session's approval does NOT carry over to the next change.

**Create or edit `.autonomy/config.json`** (gitignored — never commit this file):

```json
{
  "autonomy": {
    "unattended": false,
    "autoCommit": false,
    "autoMerge": false
  }
}
```

### Pre-conditions before arming any switch

- **Refuter must record cost_events before it is enabled.** The OpenRouter refuter is OFF by default (`config.refuter.enabled = false`). Before setting `enabled: true`, wire the cost_events insert at the call site marked `TODO(before-arming)` in `scripts/autonomy/refute.ts` — per CLAUDE.md ship-gate rule 5, every paid/metered API call must write telemetry.

### Switch 1: `autonomy.unattended`

Default: `false`

When `false` (default): the launcher runs the plan + gate + decision-packet, then stops. The coding loop must be driven manually from a Claude session.

When `true`: the orchestrator proceeds through the full coding loop — decompose, dispatch, review, gate — without pausing for confirmation at each task. It still stops for Expert tasks and any escalation trigger.

**Enable only after you have verified the gate spine catches real issues on several manual runs.**

### Switch 2: `autonomy.autoCommit`

Default: `false`

When `false` (default): the orchestrator prints the `git commit` and `gh pr create` commands and stops. You run them.

When `true`: the orchestrator commits passing tasks automatically and opens PRs. Requires `unattended = true` to have any effect.

**Enable only when you trust the gate + review chain to catch breakage reliably.**

### Switch 3: `autonomy.autoMerge`

Default: `false`

When `false` (default): PRs are opened; you merge. This is the safe default.

When `true`: the orchestrator merges a PR automatically after all gates (including the PR's CI run) pass. A PR is never merged with any open gate item.

**Enable only with extreme care. Expert tasks are never auto-merged regardless of this flag.**

### Cron trigger (optional, opt-in)

To run the deterministic launcher on a schedule, add a cron entry. Example for 07:00 local time daily:

```
0 7 * * *  cd /path/to/listing-elevate && pnpm exec tsx scripts/autonomy/daily-run.ts >> /tmp/autonomy-daily.log 2>&1
```

The cron only runs the deterministic steps (plan, gate, decision-packet). For the coding loop to run unattended from cron, `autonomy.unattended` must also be `true`.

**The cron is OFF until you add this line manually.** There is no cron configured in the repo.

### macOS LaunchAgent (optional, opt-in)

For a more reliable schedule than crontab on macOS, a LaunchAgent plist can be installed at `~/Library/LaunchAgents/com.listingelevate.autonomy.plist`. A template is not shipped — create it if needed following the macOS LaunchAgent documentation.

**The LaunchAgent is OFF until you create and load it manually.**

---

## Expert tasks — permanent human gate

Expert-category tasks (production data mutations, RLS edits, payment flows, destructive migrations, architecture decisions, anything requiring prod credentials) always require human approval. This gate is not removed by any combination of `autonomy.*` flags, cron configuration, or future phases.

When the orchestrator encounters an Expert task:
1. It writes a decision JSON to `<stateDir>/decisions/`.
2. It moves on to the next task.
3. The decision is sent to Telegram via the decision-packet step.
4. You reply with your decision. You drive the Expert task manually.

---

## Escalation and decisions

When any task hits an escalation trigger (gate fails 3 times, scope expansion, prod credentials needed, vague acceptance criteria), the orchestrator:
1. Stops the task immediately.
2. Writes a decision JSON to `<stateDir>/decisions/<spec-id>-<reason>.json`.
3. Moves on to the next task.
4. At end-of-run, flushes all decisions to Telegram via `decision-packet.ts`.

You receive a numbered list of decisions with lettered options. Reply with your choices. Blocked tasks are picked up in the next run's goals file.

---

## Observability

| What | Where |
|---|---|
| Today's plan | `<stateDir>/session-plan-<date>.json` |
| Today's run summary | `<stateDir>/runs/<date>.json` |
| Pending decisions | `<stateDir>/decisions/*.json` |
| Posted decisions | `<stateDir>/decisions/posted/*.json` |
| Task branches | `git branch -a \| grep autonomy/` |
| PRs | `gh pr list --search "autonomy"` |

State directory default: `.autonomy/state/` (configurable via `config.stateDir`).
