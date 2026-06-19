#!/usr/bin/env tsx
/**
 * scripts/autonomy/daily-run.ts
 *
 * Thin deterministic launcher for the autonomy daily-run loop.
 *
 * This script handles ONLY the non-coding, fully-deterministic steps:
 *   1. Load config and validate
 *   2. Ensure stateDir exists
 *   3. Run the planner (produce/refresh session-plan-<date>.json)
 *   4. Print the plan to stdout
 *   5. Run the verify-gate (pre-flight baseline)
 *   6. Run the decision-packet (flush any pending decisions to Telegram)
 *   7. Write <stateDir>/runs/<date>.json (run summary)
 *   8. Print a human summary
 *
 * It does NOT:
 *   - Dispatch implementer subagents (that is the orchestrator's job per the skill)
 *   - Write or edit any source files
 *   - Commit, push, or merge
 *
 * The coding loop is driven by the Claude orchestrator reading
 * docs/autonomy/skills/daily-run.md. This script is the pre-flight and
 * post-flight harness — it brackets the coding work without doing any of it.
 *
 * Usage:
 *   pnpm exec tsx scripts/autonomy/daily-run.ts [--date=YYYY-MM-DD] [--dry-run]
 *
 * Flags:
 *   --date=YYYY-MM-DD   Target date. Defaults to today (local time).
 *   --dry-run           Skip Telegram notifications and state writes; print
 *                       what would happen instead.
 *
 * Exit codes:
 *   0 — all deterministic steps completed successfully
 *   1 — config load failed, planner failed, or an unrecoverable error occurred
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, type AutonomyConfig } from "./config.js";
import type { SessionSpec } from "./planner.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-step timeout for subprocess calls (planner, verify-gate, decision-packet). */
const STEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return today as YYYY-MM-DD in local time. */
function todayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Parse a flag like `--date=2026-06-19` from argv, returning its value or undefined. */
function flagValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

/** Print a labelled banner line to stdout. */
function banner(text: string): void {
  const line = "=".repeat(Math.min(60, text.length + 4));
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(`${line}\n`);
}

/**
 * Run a child process synchronously and return its output + exit code.
 * Prints live output (stdout + stderr) to the parent process's streams.
 */
function runStep(
  label: string,
  cmd: string[],
  cwd: string,
  dryRun: boolean,
): { ok: boolean; exitCode: number; output: string } {
  if (dryRun) {
    console.log(`[dry-run] Would run: ${cmd.join(" ")}`);
    return { ok: true, exitCode: 0, output: "" };
  }

  console.log(`[daily-run] ${label} …`);
  const [executable, ...args] = cmd;
  if (!executable) {
    return { ok: false, exitCode: 1, output: "empty command" };
  }

  const result = spawnSync(executable, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: STEP_TIMEOUT_MS,
    shell: false,
  });

  const output = [result.stdout ?? "", result.stderr ?? ""].join("\n").trim();

  // Echo to console so the human running this script sees live output.
  if (output) {
    for (const line of output.split("\n")) {
      console.log(`  ${line}`);
    }
  }

  const exitCode = result.status ?? 1;
  const ok = exitCode === 0 && !result.error;

  if (!ok) {
    const reason = result.error
      ? result.error.message
      : `exit code ${exitCode}`;
    console.error(`[daily-run] ${label} FAILED: ${reason}`);
  }

  return { ok, exitCode, output };
}

/** Load the session plan file written by the planner. Returns null on failure. */
function loadPlan(planFile: string): SessionSpec[] | null {
  try {
    if (!fs.existsSync(planFile)) return null;
    const raw: unknown = JSON.parse(fs.readFileSync(planFile, "utf8"));
    if (!Array.isArray(raw)) return null;
    return raw as SessionSpec[];
  } catch {
    return null;
  }
}

/** Print a human-readable plan summary to stdout. */
function printPlanSummary(specs: SessionSpec[], date: string): void {
  const counts: Record<string, number> = {
    menial: 0,
    standard: 0,
    advanced: 0,
    expert: 0,
  };
  for (const s of specs) {
    counts[s.suggestedCategory] = (counts[s.suggestedCategory] ?? 0) + 1;
  }
  const countStr = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}:${n}`)
    .join("  ");

  console.log(`\n[plan] ${date} — ${specs.length} task(s)  ${countStr}`);
  for (const s of specs) {
    const expertFlag = s.suggestedCategory === "expert" ? "  [HUMAN APPROVAL REQUIRED]" : "";
    console.log(`  [${s.suggestedCategory.padEnd(8)}] ${s.id}${expertFlag}`);
    console.log(`    ${s.title}`);
  }
}

// ---------------------------------------------------------------------------
// Run summary
// ---------------------------------------------------------------------------

interface RunSummary {
  date: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  autonomyFlags: AutonomyConfig["autonomy"];
  preFlightGateOk: boolean;
  planFile: string;
  specCount: number;
  specs: Array<{
    id: string;
    title: string;
    category: string;
  }>;
  advisoryMode: boolean;
  dryRun: boolean;
}

/** Write the run summary JSON to <stateDir>/runs/<date>.json. */
function writeRunSummary(
  summary: RunSummary,
  stateDirAbs: string,
  dryRun: boolean,
): void {
  const runsDir = path.join(stateDirAbs, "runs");
  const runFile = path.join(runsDir, `${summary.date}.json`);

  if (dryRun) {
    console.log(`[dry-run] Would write run summary to: ${runFile}`);
    return;
  }

  try {
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(runFile, JSON.stringify(summary, null, 2) + "\n", "utf8");
    console.log(`[daily-run] Run summary written to: ${runFile}`);
  } catch (err) {
    // Non-fatal: summary write failure should not abort the run.
    console.warn(
      `[daily-run] Warning: could not write run summary: ${(err as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const dateArg = flagValue(argv, "date");
  const targetDate = dateArg ?? todayLocal();

  // Validate date format.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    console.error(
      `[daily-run] Invalid --date value "${targetDate}". Expected YYYY-MM-DD.`,
    );
    process.exit(1);
  }

  banner(`Listing Elevate — autonomy daily run (${targetDate})`);

  if (dryRun) {
    console.log("[daily-run] DRY RUN — no state writes, no Telegram messages.\n");
  }

  // ── Step 1: Load config ────────────────────────────────────────────────────

  let config: AutonomyConfig;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(
      `[daily-run] Failed to load config: ${(err as Error).message}`,
    );
    process.exit(1);
  }

  // config.stateDir is already absolute (resolved by config.ts against the
  // repoRoot that was passed to loadConfig). No need to re-join here.
  const repoRoot = process.cwd();
  const stateDirAbs = config.stateDir;

  // ── Advisory mode banner ───────────────────────────────────────────────────

  const advisoryMode = !config.autonomy.unattended;

  if (advisoryMode) {
    console.log("=== ADVISORY / MANUAL MODE ===");
    console.log("autonomy.unattended = false (default)");
    console.log(
      "This run will plan, gate, and propose — but will NOT self-drive,",
    );
    console.log("commit, or merge. Review the plan and drive each task manually.");
    console.log("==============================\n");
  } else {
    console.log("[daily-run] Unattended mode armed.");
    if (config.autonomy.autoCommit) {
      console.log("[daily-run] autoCommit = true — passing tasks will be committed automatically.");
    }
    if (config.autonomy.autoMerge) {
      console.log("[daily-run] autoMerge  = true — passing PRs will be merged automatically.");
    }
    console.log("");
  }

  // ── Step 2: Ensure stateDir exists ────────────────────────────────────────

  try {
    fs.mkdirSync(stateDirAbs, { recursive: true });
  } catch (err) {
    console.error(
      `[daily-run] Cannot create stateDir "${stateDirAbs}": ${(err as Error).message}`,
    );
    process.exit(1);
  }

  // ── Step 3: Run planner ───────────────────────────────────────────────────

  const plannerResult = runStep(
    "planner",
    [
      "pnpm",
      "exec",
      "tsx",
      path.join("scripts", "autonomy", "planner.ts"),
      `--date=${targetDate}`,
    ],
    repoRoot,
    dryRun,
  );

  if (!plannerResult.ok) {
    console.error("[daily-run] Planner failed — aborting run.");
    process.exit(1);
  }

  // ── Step 4: Load and print the plan ───────────────────────────────────────

  const planFile = path.join(stateDirAbs, `session-plan-${targetDate}.json`);
  const specs = dryRun ? [] : loadPlan(planFile);

  if (!dryRun && specs === null) {
    console.error(
      `[daily-run] Could not load plan file "${planFile}" after planner ran.`,
    );
    process.exit(1);
  }

  if (specs !== null && specs.length > 0) {
    printPlanSummary(specs, targetDate);
  } else if (!dryRun) {
    console.log(`\n[daily-run] Plan is empty — no tasks for ${targetDate}.`);
  }

  // ── Step 5: Pre-flight verify-gate ────────────────────────────────────────

  console.log("");
  const gateResult = runStep(
    "pre-flight verify-gate",
    [
      "pnpm",
      "exec",
      "tsx",
      path.join("scripts", "autonomy", "verify-gate.ts"),
    ],
    repoRoot,
    dryRun,
  );

  if (!gateResult.ok) {
    console.error(
      "[daily-run] Pre-flight gate FAILED — no coding tasks will be dispatched.",
    );
    console.error(
      "[daily-run] Fix the failing gate(s) before running the daily loop.",
    );
    // Fall through to decision-packet and summary rather than hard-exiting,
    // so any existing pending decisions still get flushed to Telegram.
  }

  // ── Step 6: Decision-packet ────────────────────────────────────────────────

  console.log("");
  runStep(
    "decision-packet",
    [
      "pnpm",
      "exec",
      "tsx",
      path.join("scripts", "autonomy", "decision-packet.ts"),
    ],
    repoRoot,
    dryRun,
  );
  // Non-fatal: decision-packet failure is logged but does not abort the run.

  // ── Step 7: Write run summary ─────────────────────────────────────────────

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  const summary: RunSummary = {
    date: targetDate,
    startedAt,
    completedAt,
    durationMs,
    autonomyFlags: config.autonomy,
    preFlightGateOk: gateResult.ok,
    planFile,
    specCount: specs?.length ?? 0,
    specs: (specs ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      category: s.suggestedCategory,
    })),
    advisoryMode,
    dryRun,
  };

  writeRunSummary(summary, stateDirAbs, dryRun);

  // ── Step 8: Human summary ─────────────────────────────────────────────────

  banner("Daily run complete");

  const gateVerdict = gateResult.ok
    ? "Pre-flight gate: PASS"
    : "Pre-flight gate: FAIL — coding loop was NOT started";

  const specLines =
    specs && specs.length > 0
      ? specs.map(
          (s) =>
            `  ${s.suggestedCategory === "expert" ? "SKIP (Expert)" : "PROPOSED"}  ${s.id} — ${s.title}`,
        )
      : ["  (no tasks)"];

  const modeNote = advisoryMode
    ? "\nMode: ADVISORY — plan and gate ran; coding loop requires manual drive.\n" +
      "Next step: open your Claude session and run the daily-run skill from\n" +
      "docs/autonomy/skills/daily-run.md to implement each task."
    : "\nMode: UNATTENDED — orchestrator should now drive the coding loop.";

  console.log(gateVerdict);
  console.log(`Tasks (${specs?.length ?? 0}):`);
  for (const line of specLines) {
    console.log(line);
  }
  console.log(modeNote);
  console.log(`\nDuration: ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`State:    ${stateDirAbs}`);
  console.log(`Run log:  ${path.join(stateDirAbs, "runs", `${targetDate}.json`)}`);
  console.log("");

  // Exit with a failure code only if the pre-flight gate failed — the human
  // needs to know the repo was broken before the run began.
  process.exit(gateResult.ok ? 0 : 1);
}

void main().catch((err) => {
  console.error(`[daily-run] Fatal: ${(err as Error).message}`);
  process.exit(1);
});
