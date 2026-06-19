#!/usr/bin/env node
/**
 * Listing Elevate — staged TypeScript baseline gate.
 * Run: pnpm typecheck:baseline          (CI gate — exits 1 on NEW errors only)
 *      pnpm typecheck:baseline:update   (regenerate baseline from current errors)
 *
 * Root tsconfig.json has `"files": []` + project references, so a bare
 * `tsc --noEmit` checks zero files. This script invokes each project config
 * individually and then diffs against a committed baseline so that pre-existing
 * errors are grandfathered and only NEW errors fail CI.
 *
 * Key design decisions:
 *  - Uses file+code+message as the error identity (drops line/col) so the
 *    baseline survives purely mechanical line shifts.
 *  - Control-character delimiter (\x1F, ASCII Unit Separator) avoids false
 *    splits on colons or pipe characters that appear in TS messages.
 *  - Counts occurrences per key (not a Set) so a new occurrence of an already-
 *    known (file,code,message) triple is caught as a new error rather than
 *    silently collapsed.
 *  - Fails closed (exit 2) when tsc itself fails to parse a config (broken
 *    tsconfig, missing binary, etc.) — a silent 0-error result from a broken
 *    tsc invocation is indistinguishable from a clean build and must not pass.
 *  - Resolves the tsc binary via require.resolve so it works both in a worktree
 *    (no local node_modules) and in CI. Runs on plain node (no tsx required —
 *    tsx is an undeclared/transitive-only dep in this repo and not on the PATH
 *    in a clean `pnpm install --frozen-lockfile` CI environment).
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselineFile = resolve(repoRoot, ".typecheck-baseline.json");

// ---------------------------------------------------------------------------
// tsc binary resolution — walks up from import.meta.url so it finds the main
// repo's node_modules even when run from a worktree that has none.
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const tscJs = require.resolve("typescript/bin/tsc");

// ---------------------------------------------------------------------------
// Configs to check (tsconfig.app, tsconfig.api, tsconfig.node)
// ---------------------------------------------------------------------------

const CONFIGS = ["tsconfig.app.json", "tsconfig.api.json", "tsconfig.node.json"];

// ---------------------------------------------------------------------------
// Error parsing
// ---------------------------------------------------------------------------

/** Delimiter safe against colons and pipes that appear in TS error messages. */
const SEP = "\x1F";

/**
 * Normalize a tsc diagnostic message so the error identity is portable across
 * environments (local macOS dev vs GitHub CI vs different pnpm store locations).
 *
 * tsc embeds absolute paths in some diagnostics:
 *   1. pnpm virtual-store paths: `/home/runner/.../node_modules/.pnpm/stripe@22.1.1_.../node_modules/stripe/...`
 *      (the prefix + version/peer hash differ per environment)
 *   2. Repo-root-prefixed source paths: `import("/abs/path/to/repo/lib/providers/gemini-judge")`
 *      (the repo root differs between local worktree and CI checkout)
 *
 * Both must be collapsed so the same logical error produces the same key everywhere.
 *
 * Apply order matters: 1 → 2 → 3.
 */
function normalizeMessage(msg) {
  // 1. Collapse pnpm virtual-store paths (env-specific prefix + version/peer hash)
  //    e.g. "/home/runner/.../node_modules/.pnpm/stripe@22.1.1_.../node_modules/" → "node_modules/"
  msg = msg.replace(/\/?[^\s"'()]*\/node_modules\/\.pnpm\/[^/]+\/node_modules\//g, "node_modules/");
  // 2. Collapse any other absolute .../node_modules/ to a bare relative prefix
  //    e.g. "/Users/oliverhelgemo/listing-elevate/node_modules/" → "node_modules/"
  msg = msg.replace(/\/?[^\s"'()]*\/node_modules\//g, "node_modules/");
  // 3. Strip the runtime repo-root prefix so in-repo source paths become repo-relative.
  //    Use string split/join (not regex) to avoid escaping issues with platform path chars.
  msg = msg.split(repoRoot + "/").join("").split(repoRoot).join("");
  return msg;
}

/**
 * Plain error line format when --pretty false:
 *   path/to/file.ts(line,col): error TSxxxx: message text
 */
const ERROR_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;

/**
 * Run tsc for one project config and return a count map of canonical error keys.
 * Fails closed (exit 2) if tsc itself errors without producing parseable output,
 * because a 0-key result from a broken tsc is indistinguishable from a clean build.
 *
 * Normal cases:
 *   status !== 0 && parsed > 0  → real type errors found — OK, return the map
 *   status === 0 && parsed === 0 → clean config (e.g. tsconfig.node) — OK, return empty map
 *
 * Fail-closed cases (exit 2):
 *   res.error is set             → tsc binary not spawnable (ENOENT etc.)
 *   status !== 0 && parsed === 0 → tsc exited non-zero but we parsed no error lines
 *                                  (broken tsconfig, TS5058, etc.)
 */
function collectErrorCounts(cfg) {
  const res = spawnSync(
    process.execPath,
    [tscJs, "-p", cfg, "--noEmit", "--pretty", "false"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  // Combine stdout + stderr; tsc writes diagnostics to stdout with --pretty false.
  const output = (res.stdout ?? "") + (res.stderr ?? "");
  const counts = new Map();

  for (const line of output.split("\n")) {
    const m = ERROR_RE.exec(line);
    if (!m) continue;
    const [, file, , , code, message] = m;
    // Identity: file + TS error code + normalized message (no line/col → survives shifts;
    // message is normalized so env-specific absolute paths don't break portability).
    const key = `${file}${SEP}${code}${SEP}${normalizeMessage(message)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // FAIL-CLOSED: tsc spawn failure or non-zero exit with zero parsed lines →
  // something is structurally broken; do not silently pass as 0 errors.
  if (res.error !== undefined || (res.status !== 0 && counts.size === 0)) {
    console.error(`\ntsc config failure: ${cfg}`);
    if (res.error) {
      console.error(`  spawn error: ${res.error.message}`);
    }
    if (output.trim()) {
      console.error(`  tsc output:\n${output.trim()}`);
    }
    process.exit(2);
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const isUpdate = process.argv.includes("--update");

// Collect all current errors across every config, merging counts.
// A key that appears in multiple configs accumulates its count across all of them.
const currentCounts = new Map();
for (const cfg of CONFIGS) {
  for (const [key, count] of collectErrorCounts(cfg)) {
    currentCounts.set(key, (currentCounts.get(key) ?? 0) + count);
  }
}

const currentTotalOccurrences = [...currentCounts.values()].reduce(
  (sum, n) => sum + n,
  0,
);

if (isUpdate) {
  // Sort keys for a stable, diffable baseline file.
  const sorted = [...currentCounts.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const errorsRecord = {};
  for (const [key, count] of sorted) {
    errorsRecord[key] = count;
  }

  const baseline = {
    note: "count-aware; gate fails on any new key OR any key whose count increases; drops line/col to tolerate line shifts; run pnpm typecheck:baseline:update to shrink",
    configs: CONFIGS,
    totalOccurrences: currentTotalOccurrences,
    distinctKeys: currentCounts.size,
    errors: errorsRecord,
  };
  writeFileSync(baselineFile, JSON.stringify(baseline, null, 2) + "\n", "utf8");
  console.log(
    `Baseline written: ${currentTotalOccurrences} occurrences across ${currentCounts.size} distinct keys`,
  );
  process.exit(0);
}

// Gate mode — baseline must exist.
if (!existsSync(baselineFile)) {
  console.error(
    "No baseline file found. Run `pnpm typecheck:baseline:update` to generate it.",
  );
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
const baselineErrors = baseline.errors;
const baselineTotalOccurrences = Object.values(baselineErrors).reduce(
  (sum, n) => sum + n,
  0,
);

// For each key in the current run, compare count against baseline.
// delta > 0 means more occurrences than baselined → treat the excess as new.
let newCount = 0;
let fixedCount = 0;
const offenders = [];

for (const [key, currentCount] of currentCounts) {
  const baselineCount = baselineErrors[key] ?? 0;
  const delta = currentCount - baselineCount;
  if (delta > 0) {
    newCount += delta;
    const [file, code, message] = key.split(SEP);
    offenders.push(`  +${delta} ${file}: ${code} ${message}`);
  }
}

// Keys in baseline that have fewer (or zero) occurrences in the current run are fixed.
for (const [key, baselineCount] of Object.entries(baselineErrors)) {
  const currentCount = currentCounts.get(key) ?? 0;
  if (currentCount < baselineCount) {
    fixedCount += baselineCount - currentCount;
  }
}

console.log(
  `typecheck baseline: ${baselineTotalOccurrences} known, ${currentTotalOccurrences} current, ${newCount} new, ${fixedCount} fixed`,
);

if (fixedCount > 0) {
  console.log(
    `  ${fixedCount} occurrence(s) resolved — run \`pnpm typecheck:baseline:update\` to shrink the baseline.`,
  );
}

if (newCount > 0) {
  console.error(`\n${newCount} NEW type error occurrence(s):\n`);
  for (const line of offenders) {
    console.error(line);
  }
  process.exit(1);
}

console.log("No new type errors.");
process.exit(0);
