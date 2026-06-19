# verify-gate — quality gate runner

Last updated: 2026-06-19

Runs the configured quality gates (typecheck → lint → build → test) and reports pass/fail.
This is the core of the accuracy spine: a codebase change is only "done" when all gates pass.

## Invocation

```bash
# Run all gates (default)
pnpm exec tsx scripts/autonomy/verify-gate.ts

# Run a subset of gates
pnpm exec tsx scripts/autonomy/verify-gate.ts --only=typecheck,test

# Machine-readable output (JSON to stdout)
pnpm exec tsx scripts/autonomy/verify-gate.ts --json

# Combine flags
pnpm exec tsx scripts/autonomy/verify-gate.ts --only=typecheck --json
```

## Flags

| Flag | Effect |
|---|---|
| `--only=<gate>[,<gate>…]` | Run only the named gates in canonical order. Valid values: `typecheck`, `lint`, `build`, `test`. |
| `--json` | Print a machine-readable JSON result to stdout instead of the human summary. Exit code semantics are unchanged. |

## Exit semantics

- **`0`** — all run gates passed (or `--only` selected zero gates).
- **`1`** — one or more gates failed, OR config could not be loaded, OR an unknown gate name was passed.

The runner stops at the first failing gate (fail-fast). Gates that were not reached because an earlier one failed appear in `skipped` in the JSON output.

## JSON shape

```ts
interface VerifyResult {
  ok: boolean;            // true iff all run gates passed
  passed: string[];       // gate names that passed, in run order
  failed: string[];       // gate names that failed (0 or 1 with fail-fast)
  skipped: string[];      // gates excluded by --only or not reached due to failure
  gates: GateResult[];    // per-gate detail, one entry per gate that was run
}

interface GateResult {
  gate: string;           // "typecheck" | "lint" | "build" | "test"
  command: string;        // exact shell command invoked (from config.gates)
  ok: boolean;            // true iff exit code was 0 and no timeout
  durationMs: number;     // wall-clock milliseconds
  exitCode: number;       // exit code of the subprocess (1 on timeout)
  outputTail: string;     // last 50 lines of combined stdout+stderr
}
```

### Example — all pass

```json
{
  "ok": true,
  "passed": ["typecheck", "lint", "build", "test"],
  "failed": [],
  "skipped": [],
  "gates": [
    { "gate": "typecheck", "command": "pnpm typecheck:baseline", "ok": true, "durationMs": 4200, "exitCode": 0, "outputTail": "" },
    { "gate": "lint",      "command": "pnpm lint",          "ok": true, "durationMs": 1800, "exitCode": 0, "outputTail": "" }
  ]
}
```

### Example — build fails (lint and test skipped)

```json
{
  "ok": false,
  "passed": ["typecheck", "lint"],
  "failed": ["build"],
  "skipped": ["test"],
  "gates": [
    { "gate": "typecheck", "command": "pnpm typecheck:baseline", "ok": true,  "durationMs": 3900, "exitCode": 0, "outputTail": "" },
    { "gate": "lint",      "command": "pnpm lint",          "ok": true,  "durationMs": 1600, "exitCode": 0, "outputTail": "" },
    { "gate": "build",     "command": "pnpm build",         "ok": false, "durationMs": 8100, "exitCode": 1, "outputTail": "error TS2345: …\n…" }
  ]
}
```

## Config contract

Gate commands are read from `scripts/autonomy/config.ts` → `loadConfig().gates`:

```ts
interface AutonomyConfig {
  gates: {
    typecheck: string;  // e.g. "pnpm typecheck:baseline"
    lint:      string;  // e.g. "pnpm lint"
    build:     string;  // e.g. "pnpm build"
    test:      string;  // e.g. "pnpm test"
  };
  // …other keys managed by config.ts
}
```

## Extension point

The canonical gate order is the `GATE_ORDER` constant at the top of `verify-gate.ts`.
To add a new gate (e.g. `"smoke"`):
1. Add it to the `GATE_NAMES` tuple.
2. Append it to `GATE_ORDER`.
3. Add a `smoke: string` field to `AutonomyConfig.gates` in `config.ts`.

No other changes are required.

## Per-gate timeout

Each gate is given a hard timeout of **10 minutes** (`DEFAULT_TIMEOUT_MS` in the source).
A timed-out gate is reported as `ok: false`, `exitCode: 1`.
