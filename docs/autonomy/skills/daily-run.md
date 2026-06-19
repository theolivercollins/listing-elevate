# daily-run — capstone orchestrator skill

Last updated: 2026-06-19

See also:
- [../work-categories.md](../work-categories.md) — category rubric, gate matrix, escalation triggers
- [../README.md](../README.md) — autonomy module overview
- [planner.md](planner.md) — step 2 of this skill in detail
- [verify-gate.md](verify-gate.md) — gate runner invoked in step 4
- [refuter.md](refuter.md) — cross-model adversarial check (step 5)
- [decision-packet.md](decision-packet.md) — pending decision flush (step 7)

---

## Purpose

This skill defines the **full daily loop** the Claude orchestrator follows to run one day of autonomous coding work. It is the capstone: it calls every other skill in sequence and handles the outcomes.

The deterministic launcher (`scripts/autonomy/daily-run.ts`) handles non-coding steps (planning, gate run, decision-packet, state write). This skill governs the coding steps in between: task dispatch, review, commit/PR, and escalation routing.

---

## Safety gate: read config.autonomy first

Before any action, load `AutonomyConfig` from `scripts/autonomy/config.ts`.

```
autonomy.unattended  (default: false)
autonomy.autoCommit  (default: false)
autonomy.autoMerge   (default: false)
```

**These three flags control every consequential action in this skill.** Their defaults are false; they are inert until the operator explicitly arms them in `.autonomy/config.json`. Rules:

| Flag | false (default) | true (armed) |
|---|---|---|
| `unattended` | Advisory/manual mode: plan, gate, propose — then STOP and wait for human. Do not self-drive the coding loop. | Coding loop runs unattended. |
| `autoCommit` | Propose-only: show the commit command, do not run it. | On gate pass, commit + push the branch automatically. |
| `autoMerge` | Never merge. Open a PR and stop. Human merges. | Merge the PR automatically after all gates pass. |

**Expert-category tasks ALWAYS require human approval regardless of flags.** No combination of config flags removes this gate. If a task is Expert, write a decision JSON and move on — do not implement it.

If `unattended` is false, print the advisory banner immediately:

```
=== ADVISORY / MANUAL MODE ===
autonomy.unattended = false (default)
This run will plan, gate, and propose — but will NOT self-drive,
commit, or merge. Review the plan and drive each task manually.
================================
```

Then follow steps 1–3 (plan + gate + decision-packet), print the human summary, and stop. Do not proceed to step 4 (coding loop) unless `unattended = true`.

---

## The daily loop (8 steps)

### Step 1 — Read goals and work categories

Read in order:
1. `config.goalsFile` (default: `.autonomy/goals.md`) — this day's approved goals
2. `docs/autonomy/work-categories.md` — category rubric, gate matrix, escalation triggers

Do not explore the repo. Do not read files not listed here. These two files are the only inputs to step 2.

### Step 2 — Plan the day

Engage the **planner skill** (`docs/autonomy/skills/planner.md`) in full.

Output: enriched `SessionSpec[]` written to `<stateDir>/session-plan-<date>.json`.

Key outputs per spec:
- `id` — stable kebab ID
- `title` — one-line summary
- `goal` — verbatim goal text
- `acceptanceCriteria` — 2–5 verifiable criteria
- `suggestedCategory` — menial / standard / advanced / expert
- `filesHint` — optional bounded file list
- `verifyCommands` — optional task-specific shell commands

Quality bar: every spec has non-empty `acceptanceCriteria`; no judgment work is tagged `menial`; Expert specs are flagged for human approval.

If `unattended = false`: print the enriched plan to stdout and stop here (advisory mode, see safety gate above).

### Step 3 — Run the verify-gate (pre-flight)

Run `scripts/autonomy/verify-gate.ts` on the current tree **before any changes**. This is the baseline pass — it confirms the repo is green before the day's work begins.

```bash
pnpm exec tsx scripts/autonomy/verify-gate.ts --json
```

If the pre-flight gate fails:
- Do NOT proceed with any coding tasks.
- Write one decision JSON per failed gate to `<stateDir>/decisions/` (see escalation format below).
- Jump to step 7 (decision-packet) and step 8 (summary).
- Reason in the summary: "Pre-flight gate failed — no tasks were started."

### Step 4 — Coding loop (one spec at a time)

Run this loop for each `SessionSpec` in the plan. Process specs sequentially (one worktree per spec; serial is safe). Within each spec, wave-parallel dispatch is used for sub-tasks (see below).

#### 4a. Skip Expert tasks immediately

If `spec.suggestedCategory === "expert"`, write a decision JSON (see §6 Escalation format) and move on. Do not implement Expert tasks — they require human approval regardless of all flags.

#### 4b. Isolate in a worktree

Create a fresh git worktree on a unique branch:

```
branch name: autonomy/<date>-<spec.id>
```

Use `git worktree add .claude/worktrees/<spec.id> autonomy/<date>-<spec.id>` (or the `EnterWorktree` superpower). The worktree is the only place code is written for this spec. It is never shared with another spec.

#### 4c. Decompose into tasks (Karpathy-minimal)

From the spec, derive the smallest independently-verifiable implementation tasks. For each task:
- `files`: exact files to touch
- `contextBrief`: conventions, guardrails, and facts not inferable from those files
- `successCriterion`: a verifiable test or assertion
- `model`: route by work-categories model tier (Haiku for menial, Sonnet for standard, Opus for advanced)

Group tasks into waves: tasks with disjoint file scopes and no mutual dependency run in the same wave (parallel). Tasks that share a file or depend on another task's output are serialized into later waves.

#### 4d. Execute waves (subagent-driven-development loop)

For each wave, dispatch all implementers at once. Each implementer:
- Receives only: task text + exact files + contextBrief + success criterion
- Does NOT inherit orchestrator context or see other tasks
- Uses TDD: write/run tests, then implement
- Returns terse structured result: `{ filesChanged, evidence, status }`

**Status handling:**
- `DONE` → proceed to review
- `DONE_WITH_CONCERNS` → read concerns; if minor, proceed to review; if blocking, queue decision
- `NEEDS_CONTEXT` → supply exactly what is missing, re-dispatch once
- `BLOCKED` → escalate model one tier and retry once; if still blocked, queue decision

**Claude never writes the code.** Implementation is always a dispatched subagent. If the thought "I'll just edit this file myself" arises — dispatch instead.

#### 4e. Review (risk-scaled)

After each wave, review all results. Reviews within a wave run in parallel.

| Task category | Review required |
|---|---|
| Menial / Standard | ONE combined spec+quality review (`code-reviewer` subagent) |
| Advanced (risky surface: auth, RLS, routes, webhooks, payments, secrets, migrations) | Separate spec-compliance review THEN code-quality review THEN `security-auditor` pass |
| Advanced (non-risky surface) | Combined spec+quality review + `security-auditor` pass |
| Expert | Never reached (blocked at 4a) |

Review findings → implementer fixes → re-review until clean. Never mark a task done with an open review issue.

#### 4f. Refuter (if enabled)

If `config.refuter.enabled = true`, run `scripts/autonomy/refute.ts` against the spec+diff pair:

```bash
pnpm exec tsx scripts/autonomy/refute.ts \
  --spec=<(echo "$spec_text") \
  --diff=<(git diff main...HEAD)
```

- `refuted: false` → proceed
- `refuted: true` → queue a decision JSON with the refuter's reason; skip the commit step for this spec; move to next spec

The refuter is off by default (`config.refuter.enabled = false`). Never block on a disabled refuter.

#### 4g. Commit + PR (gated by autonomy flags)

After all waves pass review (and refuter if enabled):

1. Run the **post-flight verify-gate** on the worktree:
   ```bash
   pnpm exec tsx scripts/autonomy/verify-gate.ts
   ```
   plus any `spec.verifyCommands`. If any gate fails, queue a decision and skip commit.

2. Run the `qa-verifier` subagent with (a) `spec.goal` verbatim and (b) the diff. On FAIL, queue a decision and skip commit.

3. **Commit** (gated by `config.autonomy.autoCommit`):
   - `autoCommit = false`: print the git commands to run; do NOT run them. Add "pending commit" to the summary.
   - `autoCommit = true`: commit with a forensic message (see format below) and push the branch.

4. **Open PR** (gated by `config.autonomy.autoCommit` — no PR without a push):
   - `autoCommit = false`: print the `gh pr create` command; do NOT run it.
   - `autoCommit = true`: open the PR via `gh pr create`. Title: `[autonomy] <spec.title>`. Body: spec goal + gate verdicts + commit SHA + rollback instructions.

5. **Merge** (gated by `config.autonomy.autoMerge`):
   - `autoMerge = false` (default): NEVER merge. Stop after opening the PR. Human merges.
   - `autoMerge = true`: merge only after all gates (including the PR CI run) pass. NEVER merge if any gate is open.

**Forensic commit message format:**
```
autonomy(<date>-<spec-id>): <spec.title>

Goal: <spec.goal first line>
Category: <suggestedCategory>
Gates: all passed (typecheck · lint · build · test)
Refuter: <approved | disabled>
Rollback: git revert <SHA> (no migration rollback needed | see down-migration: <file>)
```

### Step 5 — Escalation triggers (mid-loop)

When any trigger fires, stop the task, do NOT retry indefinitely, and queue a decision:

| Trigger | Action |
|---|---|
| Gate fails ≥ 3 times on the same task | Stop; queue decision |
| Tests fail twice on the same task | Bump category up; if now Expert, stop and queue decision |
| Worker expands scope beyond `filesHint` | Stop immediately; queue decision |
| Task requires prod credentials | Bump to Expert; queue decision (human approval required) |
| `acceptanceCriteria` are vague or unverifiable | Stop before implementation; queue decision |
| Daily token ceiling approached | Stop new task dispatch; finish in-flight tasks; queue summary |

**Model escalation on struggle:** before declaring blocked, escalate the model one tier (Haiku → Sonnet → Opus → Fable) and retry once. Never retry the same model unchanged.

### Step 6 — Escalation: decision JSON format

Write one file per escalation to `<stateDir>/decisions/<spec-id>-<reason-slug>.json`:

```json
{
  "id": "<spec-id>-<reason-slug>",
  "question": "<the question Oliver needs to answer>",
  "options": ["<option A>", "<option B>"],
  "context": "<what happened and why it was escalated>",
  "impact": "<cost / reversibility / timeline>",
  "blocks": "<what is waiting on this decision>"
}
```

After writing the file, move on to the next spec. Do not wait for a human reply mid-run.

### Step 7 — Decision-packet + summary

After all specs have been processed (pass, skip, or escalate):

1. **Run decision-packet:**
   ```bash
   pnpm exec tsx scripts/autonomy/decision-packet.ts
   ```
   This collects all `<stateDir>/decisions/*.json`, deduplicates, posts to Telegram, and moves posted files to `decisions/posted/`.

2. **Post plain-English daily summary via notify:**
   ```bash
   pnpm exec tsx scripts/autonomy/notify.ts "<summary text>"
   ```

   Summary format:
   ```
   [<project>] Daily run — <date>

   Completed: <N> tasks (committed: <N> | pending human commit: <N>)
   Escalated: <N> tasks (decisions queued)
   Skipped (Expert): <N> tasks

   Tasks:
     PASS  autonomy/<date>-<spec-id-1> — <title>
     PASS  autonomy/<date>-<spec-id-2> — <title>
     SKIP  autonomy/<date>-<spec-id-3> — <title> [Expert — awaiting approval]
     FAIL  autonomy/<date>-<spec-id-4> — <title> [gate failed: build]

   <N> decision(s) sent to Telegram.
   ```

3. **Write the run state file:**
   ```
   <stateDir>/runs/<date>.json
   ```
   Schema: `{ date, specs: [{id, title, category, status, branchName, prUrl?, decisionId?}], gateResults, refuterResults, durationMs, autonomyFlags }`

### Step 8 — Finish and report

- Verify no stray worktrees are left dirty (`git worktree list`; prune any clean worktrees that were used).
- Confirm `git status` is clean on the main working tree.
- Report to stdout: outcome-first (N done, N escalated, N skipped), then per-task one-liners, then the current branch state.

If `unattended = false` was set, the only output is the plan (step 2) and the advisory banner. Steps 4–8 are not executed.

---

## Invariants (never violate these)

1. **Claude never writes code.** Implementation is always a dispatched subagent.
2. **Expert tasks always require human approval.** No flag overrides this.
3. **autoMerge = false by default.** PRs are opened; humans merge.
4. **A gate failure is a failure.** Never soften it to "mostly passing."
5. **Decisions are queued, not waited on.** Mid-run escalation writes a file and moves on.
6. **Worktrees are isolated.** One spec, one worktree, one branch. Never share a worktree between specs.
7. **The refuter never blocks when disabled.** `config.refuter.enabled = false` means the step is a no-op.
