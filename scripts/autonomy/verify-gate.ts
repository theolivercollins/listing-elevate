#!/usr/bin/env tsx
/**
 * Listing Elevate — verify-gate runner
 *
 * Runs the configured quality gates (typecheck → lint → build → test)
 * and reports pass/fail status. Core of the accuracy spine.
 *
 * Usage:
 *   pnpm exec tsx scripts/autonomy/verify-gate.ts [--only=typecheck,test] [--json]
 *
 * Exit codes:
 *   0 — all run gates passed
 *   1 — one or more gates failed or an unexpected error occurred
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadConfig, type AutonomyConfig } from "./config.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Result for a single gate run. */
interface GateResult {
  gate: GateName;
  command: string;
  ok: boolean;
  durationMs: number;
  exitCode: number;
  /** Last N lines of combined stdout+stderr, capped to avoid log bloat. */
  outputTail: string;
}

/** Overall result returned / printed by the runner. */
interface VerifyResult {
  ok: boolean;
  passed: GateName[];
  failed: GateName[];
  skipped: GateName[];
  gates: GateResult[];
}

// ─── Gate registry ──────────────────────────────────────────────────────────
//
// EXTENSION POINT: add new gate names here and wire them in `GATE_ORDER`.
// The config contract (AutonomyConfig.gates) must provide a matching key.
// Future gates (e.g. "smoke", "security") follow the same GateRunner shape.

const GATE_NAMES = ["typecheck", "lint", "build", "test"] as const;
type GateName = (typeof GATE_NAMES)[number];

/** Canonical execution order. Extend by appending to this array. */
const GATE_ORDER: readonly GateName[] = GATE_NAMES;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default per-gate timeout in milliseconds (10 minutes). */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** Maximum number of output tail lines to capture per gate. */
const OUTPUT_TAIL_LINES = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse `--only=typecheck,test` into a Set of gate names; undefined = run all. */
function parseOnly(argv: string[]): Set<GateName> | undefined {
  const flag = argv.find((a) => a.startsWith("--only="));
  if (!flag) return undefined;
  const raw = flag.slice("--only=".length).split(",").map((s) => s.trim());
  const valid = new Set<GateName>();
  for (const name of raw) {
    if ((GATE_NAMES as readonly string[]).includes(name)) {
      valid.add(name as GateName);
    } else {
      console.error(`[verify-gate] Unknown gate name "${name}". Valid: ${GATE_NAMES.join(", ")}`);
      process.exit(1);
    }
  }
  return valid.size > 0 ? valid : undefined;
}

/** Tail the last N lines of a string. */
function tail(text: string, lines: number): string {
  const all = text.split("\n");
  return all.length <= lines ? text : all.slice(-lines).join("\n");
}

/** Split a shell command string into [executable, ...args] for spawnSync. */
function splitCommand(cmd: string): [string, string[]] {
  // Simple whitespace split — sufficient for the commands config.gates provides
  // (no shell quoting needed: these are invocations like "pnpm tsc --noEmit").
  const parts = cmd.trim().split(/\s+/);
  return [parts[0] ?? "", parts.slice(1)];
}

// ─── Gate runner ─────────────────────────────────────────────────────────────

function runGate(
  gate: GateName,
  command: string,
  repoRoot: string,
  timeoutMs: number,
): GateResult {
  const [executable, args] = splitCommand(command);
  const start = Date.now();

  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    timeout: timeoutMs,
    // Merge stderr into stdout so `outputTail` covers both streams in order.
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: false,
  });

  const durationMs = Date.now() - start;

  const rawOutput = [result.stdout ?? "", result.stderr ?? ""].join("\n").trim();
  const outputTail = tail(rawOutput, OUTPUT_TAIL_LINES);

  // spawnSync sets `status` to null on timeout; treat that as failure.
  const exitCode = result.status ?? 1;
  const timedOut = result.signal === "SIGTERM" || result.error?.message?.includes("ETIMEDOUT");

  const ok = exitCode === 0 && !timedOut;

  return { gate, command, ok, durationMs, exitCode, outputTail };
}

// ─── Reporting ───────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function printHumanSummary(results: GateResult[], overall: VerifyResult): void {
  console.log("\n=== verify-gate ===\n");
  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    const dur = formatDuration(r.durationMs);
    console.log(`[${status}] ${r.gate}  (${dur})  exit=${r.exitCode}`);
    if (!r.ok && r.outputTail) {
      // Indent the tail so it reads as a sub-block, not top-level noise.
      const indented = r.outputTail
        .split("\n")
        .map((l) => `  | ${l}`)
        .join("\n");
      console.log(indented);
    }
  }
  console.log("");
  if (overall.skipped.length > 0) {
    console.log(`Skipped:  ${overall.skipped.join(", ")}`);
  }
  const verdict = overall.ok ? "All gates passed." : `FAILED: ${overall.failed.join(", ")}`;
  console.log(verdict);
  console.log("");
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes("--json");
  const onlySet = parseOnly(argv);

  // Load config — repoRoot is inferred from CWD if not specified (see config.ts contract).
  let config: AutonomyConfig;
  try {
    config = loadConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ error: msg }) + "\n");
    } else {
      console.error(`[verify-gate] Failed to load config: ${msg}`);
    }
    process.exit(1);
  }

  // Resolve the repo root the same way config does — fall back to CWD.
  // This keeps `cwd` for spawnSync consistent with wherever config resolved paths.
  const repoRoot =
    (config as AutonomyConfig & { _repoRoot?: string })._repoRoot ?? process.cwd();

  const gateCommands: Record<GateName, string> = config.gates;

  // Determine which gates to run, preserving canonical order.
  const toRun: GateName[] = GATE_ORDER.filter(
    (g) => !onlySet || onlySet.has(g),
  );
  const skipped: GateName[] = GATE_ORDER.filter(
    (g) => onlySet && !onlySet.has(g),
  );

  const gateResults: GateResult[] = [];
  const passed: GateName[] = [];
  const failed: GateName[] = [];

  for (const gate of toRun) {
    const command = gateCommands[gate];
    if (!command) {
      // Guard: if the config omitted this gate's command, treat as a config error.
      console.error(`[verify-gate] No command configured for gate "${gate}".`);
      process.exit(1);
    }

    if (!jsonMode) {
      process.stdout.write(`Running ${gate}…  `);
    }

    const result = runGate(gate, command, repoRoot, DEFAULT_TIMEOUT_MS);
    gateResults.push(result);

    if (result.ok) {
      passed.push(gate);
      if (!jsonMode) process.stdout.write(`done (${formatDuration(result.durationMs)})\n`);
    } else {
      failed.push(gate);
      if (!jsonMode) process.stdout.write(`FAILED (${formatDuration(result.durationMs)})\n`);
      // Stop on first failure — later gates are likely meaningless if build/typecheck is broken.
      // Remove this break to run all gates regardless; that's the only behavioral change needed.
      break;
    }
  }

  // Gates not reached because an earlier one failed are also "skipped" for output purposes.
  const notReached = toRun.filter(
    (g) => !passed.includes(g) && !failed.includes(g),
  );

  const overall: VerifyResult = {
    ok: failed.length === 0,
    passed,
    failed,
    skipped: [...skipped, ...notReached],
    gates: gateResults,
  };

  if (jsonMode) {
    process.stdout.write(JSON.stringify(overall, null, 2) + "\n");
  } else {
    printHumanSummary(gateResults, overall);
  }

  process.exit(overall.ok ? 0 : 1);
}

main();
