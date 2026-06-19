#!/usr/bin/env tsx
/**
 * Listing Elevate — autonomy planner
 *
 * Reads the goals file (config.goalsFile — a Markdown file of weekly goals and
 * optional per-day items) and produces a daily session plan: an array of
 * SessionSpec objects written to <stateDir>/session-plan-<date>.json.
 *
 * This script is the DETERMINISTIC path: no LLM is called. It parses the
 * Markdown structure and emits whatever goal text is present for the target
 * date (or the flat weekly list when no day section matches). The SMART path
 * lives in docs/autonomy/skills/planner.md — the orchestrator reads that skill
 * and enriches the plan with acceptance criteria, category classification, and
 * verify commands.
 *
 * Usage:
 *   pnpm exec tsx scripts/autonomy/planner.ts [--date=YYYY-MM-DD] [--json]
 *
 * Flags:
 *   --date=YYYY-MM-DD   Plan date. Defaults to today (new Date() local time).
 *   --json              Print the SessionSpec[] JSON to stdout. Also writes the
 *                       file regardless of this flag.
 *
 * Exit codes:
 *   0 — plan produced (even if empty — zero tasks is valid)
 *   1 — config or I/O error
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Public type — imported by the orchestrator and other autonomy scripts
// ---------------------------------------------------------------------------

/** Work category vocabulary. Matches work-categories.md exactly. */
export type WorkCategory = "menial" | "standard" | "advanced" | "expert";

/**
 * A single unit of work for one autonomous session.
 *
 * The deterministic parser populates id, title, and goal.
 * The smart planner (docs/autonomy/skills/planner.md) fills in
 * acceptanceCriteria, suggestedCategory, filesHint, and verifyCommands.
 * The parser emits safe defaults for those fields so the JSON is always valid.
 */
export interface SessionSpec {
  /** Stable kebab-case identifier derived from title + date, e.g. "2026-06-19-fix-cost-tracking-01". */
  id: string;
  /** One-line human-readable title. */
  title: string;
  /** Full goal text as written in the goals file (possibly multi-line). */
  goal: string;
  /**
   * Verifiable criteria that define "done" for this session.
   * The deterministic parser emits [] — the smart planner populates this.
   */
  acceptanceCriteria: string[];
  /**
   * Suggested work category. The smart planner classifies; the parser defaults
   * to "standard" so the runner never skips gates on an unclassified task.
   */
  suggestedCategory: WorkCategory;
  /**
   * Optional hint: files or directories the task is likely to touch.
   * Helps the orchestrator scope the worktree and reduce context passing.
   */
  filesHint?: string[];
  /**
   * Optional shell commands the executor should run to verify the task is done,
   * beyond the standard gate spine. E.g. `["pnpm run test -- cost_events"]`.
   */
  verifyCommands?: string[];
}

// ---------------------------------------------------------------------------
// Markdown parser
// ---------------------------------------------------------------------------

/**
 * Lightweight Markdown parser. Supports two goal-file structures:
 *
 *  Structure A — flat list (no day sections):
 *    All `- ` or `* ` bullet items are treated as goals for every day.
 *    Indented sub-bullets are appended to the parent goal as additional context.
 *
 *  Structure B — day-keyed sections:
 *    `## YYYY-MM-DD` headings partition the file. Items under the matching
 *    heading are used; items under `## Weekly` / `## Goals` (case-insensitive)
 *    are always included as background context, appended after the day items.
 *    Items under other day headings are ignored.
 *
 * Headings at any level (`#`, `##`, `###`, …) that contain an ISO date are
 * treated as day sections. Any other heading resets the current section.
 *
 * Returns raw goal strings (may be multi-line when sub-bullets exist).
 */
function parseGoals(markdown: string, targetDate: string): string[] {
  const lines = markdown.split("\n");

  // Detect Structure B: does the file contain at least one `## YYYY-MM-DD` heading?
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const hasDaySection = lines.some((l) => {
    const heading = extractHeadingText(l);
    return heading !== null && ISO_DATE_RE.test(heading.trim());
  });

  if (hasDaySection) {
    return parseDaySectioned(lines, targetDate, ISO_DATE_RE);
  }
  return parseFlatList(lines);
}

/** Extract the text content of a Markdown heading line, or null if not a heading. */
function extractHeadingText(line: string): string | null {
  const match = /^#{1,6}\s+(.+)$/.exec(line.trim());
  return match ? (match[1] ?? "").trim() : null;
}

/** Structure A parser: collect all top-level bullets with their sub-bullets. */
function parseFlatList(lines: string[]): string[] {
  return collectBullets(lines);
}

/** Structure B parser: collect bullets from the target day section + weekly sections. */
function parseDaySectioned(
  lines: string[],
  targetDate: string,
  isoRe: RegExp,
): string[] {
  // Classify each section by type.
  type SectionType = "target" | "weekly" | "other";

  interface Section {
    type: SectionType;
    startLine: number;
  }

  const sections: Section[] = [];
  let i = 0;

  for (; i < lines.length; i++) {
    const heading = extractHeadingText(lines[i] ?? "");
    if (heading === null) continue;
    const text = heading.trim();
    if (text === targetDate) {
      sections.push({ type: "target", startLine: i });
    } else if (isoRe.test(text)) {
      sections.push({ type: "other", startLine: i });
    } else if (/^(weekly|goals?)$/i.test(text)) {
      sections.push({ type: "weekly", startLine: i });
    } else {
      sections.push({ type: "other", startLine: i });
    }
  }

  // Build line ranges for each section.
  const results: string[] = [];

  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si]!;
    if (sec.type !== "target" && sec.type !== "weekly") continue;

    const nextSec = sections[si + 1];
    const endLine = nextSec ? nextSec.startLine : lines.length;
    const sectionLines = lines.slice(sec.startLine + 1, endLine);
    results.push(...collectBullets(sectionLines));
  }

  return results;
}

/** Collect top-level bullet items from a slice of lines, folding sub-bullets in. */
function collectBullets(lines: string[]): string[] {
  const goals: string[] = [];
  let current: string | null = null;
  let subLines: string[] = [];

  const BULLET_RE = /^[-*]\s+(.+)$/;
  const SUB_BULLET_RE = /^\s{2,}[-*]\s+(.+)$/;

  const flush = () => {
    if (current !== null) {
      const combined =
        subLines.length > 0
          ? `${current}\n${subLines.map((s) => `  - ${s}`).join("\n")}`
          : current;
      goals.push(combined.trim());
      current = null;
      subLines = [];
    }
  };

  for (const line of lines) {
    const subMatch = SUB_BULLET_RE.exec(line);
    if (subMatch && current !== null) {
      subLines.push(subMatch[1] ?? "");
      continue;
    }
    const bulletMatch = BULLET_RE.exec(line);
    if (bulletMatch) {
      flush();
      current = bulletMatch[1] ?? "";
      continue;
    }
    // Non-bullet, non-sub-bullet: continuation text for the current item or noise.
    const trimmed = line.trim();
    if (trimmed && current !== null && !trimmed.startsWith("#")) {
      current = `${current} ${trimmed}`;
    } else if (!trimmed && current !== null) {
      // Blank line inside a section — end the current bullet.
      flush();
    }
  }
  flush();

  return goals;
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Produce a stable, collision-resistant ID for a goal item.
 * Format: `<date>-<slug>-<index>` where slug is the first 40 chars of the
 * title lowercased and non-alphanumeric chars replaced with hyphens.
 * Index (1-based, zero-padded to 2 digits) handles duplicate titles.
 */
function makeId(date: string, title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const idx = String(index).padStart(2, "0");
  return `${date}-${slug}-${idx}`;
}

/**
 * Derive a short title from a raw goal string: first line, max 80 chars,
 * stripped of Markdown inline markup (bold, italic, code ticks, links).
 */
function deriveTitle(goal: string): string {
  const firstLine = goal.split("\n")[0] ?? goal;
  return firstLine
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/\*(.+?)\*/g, "$1") // *italic*
    .replace(/`(.+?)`/g, "$1") // `code`
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // [text](url)
    .trim()
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// SessionSpec builder
// ---------------------------------------------------------------------------

/** Build a SessionSpec from a raw goal string. Smart fields get safe defaults. */
function buildSpec(
  goal: string,
  index: number,
  date: string,
): SessionSpec {
  const title = deriveTitle(goal);
  const id = makeId(date, title, index);
  return {
    id,
    title,
    goal,
    // Deterministic parser: safe defaults — smart planner fills these in.
    acceptanceCriteria: [],
    suggestedCategory: "standard",
  };
}

// ---------------------------------------------------------------------------
// Date helper
// ---------------------------------------------------------------------------

/** Return today as YYYY-MM-DD in local time. */
function todayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes("--json");

  // Resolve --date flag.
  const dateFlag = argv.find((a) => a.startsWith("--date="));
  const targetDate = dateFlag ? dateFlag.slice("--date=".length).trim() : todayLocal();

  // Validate date format.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    console.error(
      `[planner] Invalid --date value "${targetDate}". Expected YYYY-MM-DD.`,
    );
    process.exit(1);
  }

  // Load config — goalsFile and stateDir are already absolute (resolved by config.ts).
  let goalsPath: string;
  let stateDirAbs: string;
  try {
    const cfg = loadConfig();
    goalsPath = cfg.goalsFile;
    stateDirAbs = cfg.stateDir;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[planner] Failed to load config: ${msg}`);
    process.exit(1);
  }

  // Read goals file.
  if (!fs.existsSync(goalsPath)) {
    console.error(
      `[planner] Goals file not found: ${goalsPath}\n` +
        `  Expected at config.goalsFile = "${goalsPath}".\n` +
        `  Create it or copy .autonomy/goals.example.md.`,
    );
    process.exit(1);
  }

  let markdown: string;
  try {
    markdown = fs.readFileSync(goalsPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[planner] Cannot read goals file: ${msg}`);
    process.exit(1);
  }

  // Parse goals.
  const rawGoals = parseGoals(markdown, targetDate);

  // Build specs (1-indexed for human-readable IDs).
  const specs: SessionSpec[] = rawGoals.map((goal, i) =>
    buildSpec(goal, i + 1, targetDate),
  );

  // Write plan file.
  const planFile = path.join(stateDirAbs, `session-plan-${targetDate}.json`);
  try {
    fs.mkdirSync(stateDirAbs, { recursive: true });
    fs.writeFileSync(planFile, JSON.stringify(specs, null, 2) + "\n", "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[planner] Failed to write plan file: ${msg}`);
    process.exit(1);
  }

  if (jsonMode) {
    process.stdout.write(JSON.stringify(specs, null, 2) + "\n");
  } else {
    console.log(`[planner] ${targetDate} — ${specs.length} task(s) → ${planFile}`);
    for (const s of specs) {
      console.log(`  [${s.suggestedCategory}] ${s.id}`);
      console.log(`    ${s.title}`);
    }
  }

  process.exit(0);
}

main();
