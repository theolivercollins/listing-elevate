# planner — daily session plan builder

Last updated: 2026-06-19

See also:
- [../work-categories.md](../work-categories.md) — category rubric, gate matrix, escalation triggers
- [../README.md](../README.md) — autonomy module overview
- [verify-gate.md](verify-gate.md) — the gate runner the planner wires into verifyCommands

---

## Two paths to a session plan

| Path | Who runs it | What it does |
|---|---|---|
| **Smart** (this skill) | The Claude orchestrator | Reads goals + work-categories, classifies each item, writes acceptance criteria and verifyCommands, produces a plan rich enough to dispatch workers directly. |
| **Deterministic fallback** | `scripts/autonomy/planner.ts` | Parses the Markdown structure, derives IDs and titles, emits safe defaults for category/criteria. No LLM, always runs first for state I/O. |

The deterministic script writes `<stateDir>/session-plan-<date>.json`. This skill enriches that file (or writes a fresh one when run standalone). The enriched file is the input to every subsequent autonomy step.

---

## When to engage

Engage this skill at the start of every autonomy session:

1. Before dispatching any implementer subagents.
2. When the goals file has changed since the last run.
3. When `--date` is different from the last plan date.
4. When re-planning after an escalation or blocked task shifts the day's priorities.

---

## Input: the goals file

Default path: `.autonomy/goals.md` (configurable via `config.goalsFile`).

Two supported structures — the deterministic parser handles both; this skill respects the same grammar:

**Structure A — flat list** (no day sections): every bullet is a goal for every plan date.

**Structure B — day-keyed sections** (`## YYYY-MM-DD` headings): bullets under the matching heading are that day's goals. Bullets under `## Weekly` or `## Goals` are always included as background context.

---

## Smart planning procedure

Run this procedure in full. Each step feeds the next.

### Step 1 — Load inputs

Read in order:
1. `config.goalsFile` (from `loadConfig()` in `scripts/autonomy/config.ts`)
2. `docs/autonomy/work-categories.md` — the category rubric and gate matrix
3. The existing `session-plan-<date>.json` if present (deterministic parser's output)

Do not re-read files already in context. Do not explore the repo.

### Step 2 — Parse and deduplicate

Parse the goals file using the same grammar as the deterministic parser:
- Strip Markdown heading noise.
- Collect bullets for the target date (Structure B) or all bullets (Structure A).
- Remove exact duplicates (same trimmed text).
- Remove items that are already DONE in the existing plan (status field, if present).

### Step 3 — Classify each goal

For every raw goal text, assign `suggestedCategory` using `work-categories.md` as the rubric:

| Signal | Category |
|---|---|
| Copy edit, config tweak, rename, wiring a prop or export | `menial` |
| Single-file bugfix with clear scope, dependency bump, isolated UI change | `standard` |
| Cross-module feature, new route, UI workflow, data model change, dev-only migration, prompt change | `advanced` |
| Production data mutation, RLS edit, payment flow, destructive migration, architecture decision, any task needing prod credentials | `expert` |

When in doubt, classify **up** (conservative). A misclassified-down task ships with too few gates; a misclassified-up task just takes longer but is safe.

Do NOT classify judgment work as `menial`. If it requires reading comprehension, reasoning, or has a failure mode, it is at least `standard`.

### Step 4 — Write acceptance criteria

For each goal, write 2–5 concrete, verifiable acceptance criteria. Each criterion must be testable by a script, a visual check, or an explicit `git grep` — not by reading prose.

Good criteria:
- `pnpm run test passes with no new failures`
- `GET /api/properties returns 200 with at least one item in the response body`
- `cost_events table has a new row with provider="kling" within 5 s of render trigger`
- `No TS2345 errors in tsc --noEmit on the changed files`

Bad criteria (reject these):
- `The feature works correctly`
- `Code is clean`
- `User can see the result`

### Step 5 — Attach verifyCommands

Attach 1–3 shell commands the executor runs **after** the gate spine to confirm acceptance criteria are met. These complement the standard gates — they do not replace them.

Prefer commands that:
- Run fast (< 30 s) and are side-effect-free.
- Can be run from the repo root without prod credentials.
- Are specific to this task (not generic `pnpm test`).

Examples:
```bash
pnpm exec tsx scripts/cost-reconcile.ts --check          # cost tracking
pnpm exec tsc --noEmit --strict src/lib/providers/       # type-check a subtree
grep -r 'JetBrains' src/ && exit 1 || true               # font guard
curl -s http://localhost:3000/api/health | jq '.ok'      # smoke
```

Omit `verifyCommands` entirely when no task-specific command adds value beyond the gate spine.

### Step 6 — Attach filesHint (optional)

If the goal clearly implies a bounded set of files or directories, list them. This helps the orchestrator scope the worktree and the implementer's context brief.

Keep it tight: 1–5 paths at most. When the scope is uncertain, omit.

### Step 7 — Assign IDs

Preserve any IDs from the deterministic parser's output (stable across re-plans). For new items not present in the existing plan, generate IDs following the same scheme:

```
<YYYY-MM-DD>-<slug>-<NN>
```

where `slug` is the title lowercased, non-alphanumeric → hyphens, max 40 chars; `NN` is 1-based zero-padded index.

### Step 8 — Write the plan

Write the enriched `SessionSpec[]` to `<stateDir>/session-plan-<date>.json`. This file is the handoff to the orchestrator loop.

Also write a one-line human summary to stdout:
```
[planner] 2026-06-19 — 4 task(s)  menial:1  standard:2  advanced:1  expert:0
```

---

## SessionSpec schema

```ts
interface SessionSpec {
  id: string;                       // "2026-06-19-fix-cost-tracking-01"
  title: string;                    // one-line, max 80 chars
  goal: string;                     // verbatim from goals file (may be multi-line)
  acceptanceCriteria: string[];     // 2–5 verifiable criteria
  suggestedCategory: "menial" | "standard" | "advanced" | "expert";
  filesHint?: string[];             // optional bounded file list
  verifyCommands?: string[];        // optional task-specific shell commands
}
```

The orchestrator reads `suggestedCategory` to determine the gate spine (see `work-categories.md` gate-by-category matrix) and the default model tier. It may bump the category upward if escalation triggers fire during execution.

---

## Quality bar for the plan

Before handing off, verify the plan satisfies:

- [ ] Every item has a title ≤ 80 chars.
- [ ] Every item has 2–5 non-trivial acceptance criteria.
- [ ] No `acceptanceCriteria` entry is `[]`.
- [ ] Category is assigned conservatively (no judgment work tagged `menial`).
- [ ] Expert items are flagged with a note that human approval is required.
- [ ] `verifyCommands`, if present, are runnable from repo root without prod creds.
- [ ] Plan file written to `stateDir` with correct filename `session-plan-<date>.json`.
