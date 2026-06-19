# refuter — cross-model adversarial verify gate

Last updated: 2026-06-19

The refuter is an independent, non-Claude "Handler 2" check that adversarially
challenges proposed diffs before they are accepted.  It is gated behind
`config.refuter.enabled` and is **OFF by default** — a complete no-op until
deliberately armed.

---

## Purpose

After the primary Claude-based review, the refuter dispatches the same
spec+diff pair to a different model (via OpenRouter) with an adversarial
system prompt: the model is told its job is to REFUTE the claim that the diff
implements the spec, and to default to `refuted: true` when uncertain.

This cross-model check catches:
- Gaps the primary reviewer missed (different training distribution).
- Spec requirements that are stated but not implemented.
- Edge cases, security holes, or silent behavioural deviations.

---

## Config contract

The refuter reads `config.refuter` from `scripts/autonomy/config.ts`:

```ts
refuter: {
  enabled: boolean;       // master switch — default false
  model: string;          // OpenRouter model ID, e.g. "openai/gpt-4o"
  via: "openrouter";      // only OpenRouter is supported
}
```

**Arm it** by setting `enabled: true` in `.autonomy/config.json`:

```json
{
  "refuter": {
    "enabled": true,
    "model": "openai/gpt-4o"
  }
}
```

`.autonomy/config.json` is gitignored — never commit `enabled: true` to shared
config.

---

## Credential resolution

The refuter reads `OPENROUTER_API_KEY` in this order:

1. `process.env.OPENROUTER_API_KEY`
2. A line `OPENROUTER_API_KEY=<value>` in `~/credentials.md`

The key is **never logged**.  If absent, the refuter returns
`{ refuted: false, reason: "no OpenRouter key", confidence: 0 }` — it does not
block the pipeline.

---

## When the verify-gate invokes the refuter

The refuter is called as the final step of the verify pass, after all quality
gates (typecheck → lint → build → test) have passed:

```
verify-gate gates (all PASS)
        ↓
  refute({ spec, diff })
        ↓
  refuted: false → accept change
  refuted: true  → reject, surface reason
```

Only call the refuter when gates are green — a failing build produces a diff
that is trivially refutable, wasting API spend.

---

## Import API

```ts
import { refute } from "./refute.js";

const result = await refute({ spec, diff });
// result: { refuted: boolean; reason: string; confidence: number }
```

`refute()` never throws.  All failure modes (disabled, missing key, network
error, bad JSON from the model) return `refuted: false` so they do not
silently block the pipeline.  Network failures are logged to stderr.

---

## CLI usage

```bash
# Run from the repo root
tsx scripts/autonomy/refute.ts \
  --spec=path/to/spec.md \
  --diff=path/to/change.diff

# Exit codes:
#   0 — refuted:false (change approved or refuter skipped)
#   1 — refuted:true (change rejected) OR fatal argument error
```

JSON verdict is printed to stdout; human verdict and exit status to stderr.

---

## Failure modes and their handling

| Condition | refuted | reason |
|---|---|---|
| `config.refuter.enabled = false` | false | "refuter disabled" |
| No OpenRouter key in env or `~/credentials.md` | false | "no OpenRouter key" |
| Config load failure | false | config error message |
| OpenRouter HTTP error or network failure | false | error message (logged to stderr) |
| Model returns non-JSON | true | raw snippet included (fail-safe) |
| Model returns JSON but wrong shape | true | raw snippet included (fail-safe) |
| Model returns `refuted: true` | true | model's reason + confidence |

Parse failures default to `refuted: true` so a broken model response is a hard
gate, not a silent pass.

---

## Spend control

The refuter makes one API call per verify run, to a model you control via
`config.refuter.model`.  To cap spend:

- Leave `enabled: false` (the default) and arm only on explicit sessions.
- Choose a cheaper model (e.g. `openai/gpt-4o-mini`) for routine checks.
- The refuter is not called when any quality gate fails, so it never runs on
  broken builds.
