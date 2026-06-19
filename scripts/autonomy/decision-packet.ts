#!/usr/bin/env tsx
/**
 * scripts/autonomy/decision-packet.ts
 *
 * Reads pending decision files from <stateDir>/decisions/*.json, deduplicates
 * by a stable key (question + context), formats them as a single numbered list
 * with lettered options, posts via Telegram, and moves each posted file to
 * <stateDir>/decisions/posted/ to prevent double-posting.
 *
 * Idempotent: re-running with no new decisions is a no-op.
 *
 * Usage:
 *   tsx decision-packet.ts
 *
 * Decision file schema:
 *   { id, question, options, context?, impact?, blocks? }
 *   (See Decision type below for full contract.)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "./config.js";
import { sendTelegram } from "./notify.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of a pending decision JSON file written to <stateDir>/decisions/.
 *
 * The orchestrator emits one file per decision; this script collects and
 * posts them as a single Telegram packet.
 */
export interface Decision {
  /** Stable unique identifier (e.g. "feat-xyz-model-choice"). */
  id: string;
  /** The question Oliver needs to answer. */
  question: string;
  /** Ordered list of choices — rendered as A, B, C, … */
  options: string[];
  /** Optional: extra context that frames the question. */
  context?: string;
  /** Optional: describes what is at stake (cost, reversibility, timeline). */
  impact?: string;
  /** Optional: what is blocked until this decision is made. */
  blocks?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive a stable dedup key from a decision's content (not its file name or id). */
function dedupKey(d: Decision): string {
  return `${d.question.trim()}||${(d.context ?? "").trim()}`;
}

/**
 * Parse and lightly validate a raw JSON value as a Decision.
 * Throws if required fields are missing or malformed.
 */
function parseDecision(raw: unknown, filePath: string): Decision {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`decision-packet: ${filePath} is not a JSON object`);
  }
  const obj = raw as Record<string, unknown>;

  const id = obj["id"];
  const question = obj["question"];
  const options = obj["options"];

  if (typeof id !== "string" || !id.trim()) {
    throw new Error(`decision-packet: ${filePath} missing required string field "id"`);
  }
  if (typeof question !== "string" || !question.trim()) {
    throw new Error(
      `decision-packet: ${filePath} missing required string field "question"`,
    );
  }
  if (
    !Array.isArray(options) ||
    options.length === 0 ||
    options.some((o) => typeof o !== "string")
  ) {
    throw new Error(
      `decision-packet: ${filePath} "options" must be a non-empty string[]`,
    );
  }

  return {
    id: id.trim(),
    question: question.trim(),
    options: (options as string[]).map((o) => o.trim()),
    context: typeof obj["context"] === "string" ? obj["context"].trim() : undefined,
    impact: typeof obj["impact"] === "string" ? obj["impact"].trim() : undefined,
    blocks: typeof obj["blocks"] === "string" ? obj["blocks"].trim() : undefined,
  };
}

/**
 * Load all *.json files from `dir`, skipping unreadable / unparseable files
 * with a warning rather than aborting.
 */
function loadDecisions(dir: string): Array<{ decision: Decision; filePath: string }> {
  if (!fs.existsSync(dir)) return [];

  const entries = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort(); // deterministic order

  const results: Array<{ decision: Decision; filePath: string }> = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry);
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
      results.push({ decision: parseDecision(raw, filePath), filePath });
    } catch (err) {
      console.warn(`[decision-packet] Skipping ${entry}: ${(err as Error).message}`);
    }
  }

  return results;
}

/**
 * Deduplicate by stable key (question + context), keeping the first occurrence
 * in sorted file order. Returns both the unique decisions and the set of file
 * paths that are duplicates (to be moved to posted/ silently).
 */
function deduplicate(
  items: Array<{ decision: Decision; filePath: string }>,
): {
  unique: Array<{ decision: Decision; filePath: string }>;
  duplicatePaths: string[];
} {
  const seen = new Set<string>();
  const unique: Array<{ decision: Decision; filePath: string }> = [];
  const duplicatePaths: string[] = [];

  for (const item of items) {
    const key = dedupKey(item.decision);
    if (seen.has(key)) {
      duplicatePaths.push(item.filePath);
    } else {
      seen.add(key);
      unique.push(item);
    }
  }

  return { unique, duplicatePaths };
}

/** Convert a 0-based index to a letter label: 0→A, 1→B, …, 25→Z, 26→AA, … */
function optionLabel(index: number): string {
  // Simple base-26 encoding for option labels.
  const chars: string[] = [];
  let n = index;
  do {
    chars.unshift(String.fromCharCode(65 + (n % 26)));
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return chars.join("");
}

/**
 * Format the list of unique decisions into a single plain-text Telegram message.
 *
 * Example output:
 *
 *   [Listing Elevate] 2 pending decisions — please reply with your choices.
 *
 *   1. Which model for scene scoring?
 *      Context: We need a cheap model that handles JSON output reliably.
 *      Impact: ~$0.002 per scene; reversible.
 *      Blocks: scene-scorer subagent dispatch.
 *      A) gpt-4o-mini
 *      B) claude-haiku
 *
 *   2. Pin Shotstack SDK version?
 *      A) Yes, pin to 1.7.0
 *      B) No, use latest
 */
function formatPacket(
  decisions: Decision[],
  projectName: string,
): string {
  const count = decisions.length;
  const header =
    `[${projectName}] ${count} pending decision${count === 1 ? "" : "s"} — please reply with your choices.`;

  const blocks = decisions.map((d, idx) => {
    const lines: string[] = [`${idx + 1}. ${d.question}`];
    if (d.context) lines.push(`   Context: ${d.context}`);
    if (d.impact) lines.push(`   Impact: ${d.impact}`);
    if (d.blocks) lines.push(`   Blocks: ${d.blocks}`);
    for (let i = 0; i < d.options.length; i++) {
      lines.push(`   ${optionLabel(i)}) ${d.options[i]}`);
    }
    return lines.join("\n");
  });

  return [header, "", ...blocks].join("\n\n");
}

/**
 * Move a file to `destDir`, creating the directory if needed.
 * Overwrites silently if the destination already exists (idempotent cleanup).
 */
function markPosted(filePath: string, destDir: string): void {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const dest = path.join(destDir, path.basename(filePath));
  fs.renameSync(filePath, dest);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();
  // config.stateDir is already absolute (resolved by config.ts).
  const decisionsDir = path.join(config.stateDir, "decisions");
  const postedDir = path.join(decisionsDir, "posted");

  const allItems = loadDecisions(decisionsDir);

  if (allItems.length === 0) {
    console.log("[decision-packet] No pending decisions. Nothing to send.");
    return;
  }

  // Cross-run dedup: load already-posted decisions and seed the seen set so
  // a re-emitted identical-content decision (new filename, same question+context)
  // is moved to posted/ without re-sending to Telegram.
  const postedItems = loadDecisions(postedDir);
  const seenPostedKeys = new Set<string>(
    postedItems.map((item) => dedupKey(item.decision)),
  );

  // Split pending items into those already covered by a prior run's post and
  // those that are genuinely new.
  const alreadyPostedPaths: string[] = [];
  const remainingItems: Array<{ decision: Decision; filePath: string }> = [];

  for (const item of allItems) {
    if (seenPostedKeys.has(dedupKey(item.decision))) {
      alreadyPostedPaths.push(item.filePath);
    } else {
      remainingItems.push(item);
    }
  }

  // Move cross-run duplicates to posted/ without sending.
  for (const fp of alreadyPostedPaths) {
    try {
      markPosted(fp, postedDir);
      console.log(
        `[decision-packet] Already posted (cross-run dedup), moved to posted/: ${path.basename(fp)}`,
      );
    } catch (err) {
      console.warn(
        `[decision-packet] Could not move cross-run duplicate ${path.basename(fp)}: ${(err as Error).message}`,
      );
    }
  }

  if (remainingItems.length === 0) {
    console.log(
      "[decision-packet] All pending decisions already posted in a prior run. Nothing to send.",
    );
    return;
  }

  const { unique, duplicatePaths } = deduplicate(remainingItems);

  // Move duplicates to posted/ without sending — they've already been posted
  // (or are exact repeats of a decision in this same run).
  for (const dup of duplicatePaths) {
    try {
      markPosted(dup, postedDir);
      console.log(`[decision-packet] Duplicate moved to posted/: ${path.basename(dup)}`);
    } catch (err) {
      console.warn(
        `[decision-packet] Could not move duplicate ${path.basename(dup)}: ${(err as Error).message}`,
      );
    }
  }

  if (unique.length === 0) {
    console.log("[decision-packet] All pending decisions were duplicates. Nothing to send.");
    return;
  }

  const message = formatPacket(
    unique.map((item) => item.decision),
    config.project,
  );

  try {
    await sendTelegram(message);
    console.log(`[decision-packet] Sent ${unique.length} decision(s) to Telegram.`);
  } catch (err) {
    console.error(
      `[decision-packet] Failed to send Telegram message: ${(err as Error).message}`,
    );
    process.exit(1);
  }

  // Mark sent decisions as posted.
  for (const item of unique) {
    try {
      markPosted(item.filePath, postedDir);
    } catch (err) {
      // Non-fatal: the message was sent; worst case the file is re-read next run
      // and deduplicated via content key.
      console.warn(
        `[decision-packet] Could not move ${path.basename(item.filePath)} to posted/: ${(err as Error).message}`,
      );
    }
  }
}

// Run when invoked directly (tsx decision-packet.ts ...) but not when imported as a module.
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("decision-packet.ts") ||
    process.argv[1].endsWith("decision-packet.js"));

if (isMain) {
  void main();
}
