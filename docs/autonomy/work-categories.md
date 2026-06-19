---
Last updated: 2026-06-19
See also:
- [../specs/2026-06-18-autonomous-coding-loop-design.md](../specs/2026-06-18-autonomous-coding-loop-design.md) — §4 (categories), §5 (gates), §6 (escalation)
- [README.md](README.md) — autonomy module overview
---

# Work categories

The planner assigns every task a category at creation. The category determines the default model, required gate spine, and whether human approval is needed. A task may be **re-categorized upward** mid-flight when any auto-escalation trigger fires (§ Escalation triggers below).

## Category definitions

| Category | Typical examples | Default model tier | Required gates | Human approval |
|---|---|---|---|---|
| **Menial** | formatting, copy edits, config tweaks, mechanical renaming, wiring (adding a prop, exporting a constant) | Haiku | typecheck · lint · build | no |
| **Standard** | isolated bugfix with tests, small single-file feature, dependency bump with type-check clean | Sonnet | typecheck · lint · build · tests · diff-review · run-app smoke | no |
| **Advanced** | cross-module feature, UI workflow, new route, data model change, dev-only migration, prompt changes | Opus + independent code-reviewer | typecheck · lint · build · tests · run-app smoke · diff-review · security-review (if risky surface) · cross-model-refute · qa-verify | no — unless the task touches a risky surface (auth, RLS, routes, webhooks, payments, secrets, migrations), in which case human approval is required |
| **Expert** | production data mutations, security-boundary changes, RLS policy edits, payment flow changes, destructive migrations, architecture decisions, any task requiring prod credentials | top model + independent refuter | **all gates** | **yes — always; no exception** |

Model tiers follow the existing ladder (see `~/.claude/CLAUDE.md` § Model policy). Decompose so most tasks land on Haiku or Sonnet; never tag judgment work as menial.

---

## Gate-by-category matrix

| Gate | Menial | Standard | Advanced | Expert |
|---|---|---|---|---|
| **Typecheck** (`pnpm typecheck:baseline`) | required | required | required | required |
| **Lint** (`pnpm run lint`) | required | required | required | required |
| **Build** (`pnpm run build`) | required | required | required | required |
| **Tests** (`pnpm run test`) | — | required | required | required |
| **Run-app smoke** (dev server + Claude Preview screenshot + console check) | — | required | required | required |
| **Diff review** (`code-reviewer` agent) | — | required | required | required |
| **Security review** (`security-auditor` agent) | — | — | optional (required on risky surface) | required |
| **Cross-model refute** (non-Claude model via OpenRouter, attempts to refute the diff against the brief) | — | — | required | required |
| **QA vs request** (`qa-verifier` agent checks diff against verbatim brief) | — | — | required | required |

**Legend:** required = gate must pass before the task is marked done; optional = run only when the task touches a risky surface (auth, RLS, API routes, webhooks, payments, secrets, migrations); — = not run.

**Definition of done:** every required gate for the task's category emits a PASS artifact. A task is never "done" with an open gate item; partial passes are failures.

**LE-specific guardrails enforced at the gate:**
- Any destructive code path must check `VERCEL_ENV === 'production'` OR `LE_ALLOW_NONPROD_WRITES === 'true'` before writing to `properties`, `scenes`, `cost_events`, storage, or triggering real renders.
- Do NOT drive the render pipeline locally — local `.env` is a subset of prod (missing Creatomate `_30` template id, Bunny config). Pipeline tests run in-studio/prod.
- Storage/video = Bunny, not Supabase Storage.
- No new monospace UI font declarations (DESIGN-GUIDE §9).

---

## Auto-escalation triggers

When any trigger below fires, the orchestrator **stops the task**, bumps the category upward (if applicable), and adds the blocker to the daily decision packet. It does not grind — it escalates. Human is notified only if the item is both blocking and time-sensitive.

| Trigger | Action |
|---|---|
| Tests fail twice on the same task | Bump category (Menial → Standard, Standard → Advanced, Advanced → Expert); queue decision |
| Any gate fails N times (default N = 3) | Stop task; queue decision — do not retry further |
| Task touches shared infra (migrations, auth, shared `lib/`) | Bump to at least Advanced; require human approval if Expert boundary reached |
| Acceptance criteria are vague or unverifiable | Stop before implementation; queue decision requesting clarification |
| Production credentials are required | Bump to Expert; human approval required before proceeding |
| Worker expands scope beyond the brief's declared file set | Stop immediately; queue decision — orchestrator decides whether to extend scope or split the task |
| Daily token ceiling approached | Stop new task dispatch; complete in-flight tasks; queue summary for next run |

**Model escalation on struggle** (separate from category escalation): before declaring a task blocked, escalate the model one tier (Haiku → Sonnet → Opus → Fable) and retry once. Never retry the same model unchanged.
