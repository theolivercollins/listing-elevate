#!/usr/bin/env tsx
/**
 * Listing Elevate — repo health check.
 * Run: pnpm doctor
 *
 * Surfaces drift the repo accumulates between sessions: stale worktrees,
 * merged-but-undeleted branches, doc rot, and unmerged feat/* branches that
 * haven't been touched. Read-only — never modifies anything.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = execSync("git rev-parse --show-toplevel").toString().trim();
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const sh = (cmd: string) => execSync(cmd, { cwd: REPO, encoding: "utf8" }).trim();
const tryRun = (cmd: string) => { try { return sh(cmd); } catch { return ""; } };

const findings: string[] = [];
const note = (line: string) => findings.push(line);

console.log(`\n=== Listing Elevate doctor — ${new Date().toISOString().slice(0, 10)} ===\n`);

// 1. Worktrees > 14 days
const worktrees = sh("git worktree list --porcelain")
  .split("\n\n")
  .filter(Boolean)
  .map((block) => Object.fromEntries(block.split("\n").map((l) => l.split(" ")) as [string, string][]));
const wtAged = worktrees.filter((wt) => {
  if (!wt.worktree || wt.worktree === REPO) return false;
  const age = (NOW - statSync(wt.worktree).mtimeMs) / DAY;
  return age > 14;
});
if (wtAged.length) note(`⚠ ${wtAged.length} worktree(s) older than 14 days: ${wtAged.map((w) => w.worktree).join(", ")}`);

// 2. Merged branches still alive
const mergedLocal = tryRun("git branch --merged origin/main")
  .split("\n").map((s) => s.trim().replace(/^\*\s*/, "")).filter((s) => s && !["main", "staging", "dev"].includes(s));
if (mergedLocal.length) note(`⚠ ${mergedLocal.length} local branch(es) merged into main but not deleted: ${mergedLocal.join(", ")}`);

const mergedRemote = tryRun("git branch -r --merged origin/main")
  .split("\n").map((s) => s.trim()).filter((s) => s && !s.includes("HEAD") && !["origin/main", "origin/staging", "origin/dev"].includes(s));
if (mergedRemote.length) note(`⚠ ${mergedRemote.length} remote branch(es) merged but not deleted: ${mergedRemote.join(", ")}`);

// 3. Docs with Last updated > 30 days
const walkDocs = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkDocs(p));
    else if (e.name.endsWith(".md") && !p.includes("/archive/")) out.push(p);
  }
  return out;
};
const staleDoc: { path: string; age: number }[] = [];
for (const f of walkDocs(join(REPO, "docs"))) {
  const text = readFileSync(f, "utf8");
  const m = text.match(/Last updated:\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) continue;
  const age = (NOW - new Date(m[1]).getTime()) / DAY;
  if (age > 30) staleDoc.push({ path: f.replace(REPO + "/", ""), age: Math.floor(age) });
}
if (staleDoc.length) {
  note(`⚠ ${staleDoc.length} doc(s) with Last updated > 30 days:`);
  for (const d of staleDoc.slice(0, 10)) note(`    ${d.age}d  ${d.path}`);
  if (staleDoc.length > 10) note(`    … and ${staleDoc.length - 10} more`);
}

// 4. HANDOFF age
const handoff = tryRun(`grep -m1 "^Last updated:" docs/HANDOFF.md`);
const handoffDate = handoff.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
const handoffAge = handoffDate ? Math.floor((NOW - new Date(handoffDate).getTime()) / DAY) : null;
if (handoffAge !== null && handoffAge > 7) note(`⚠ docs/HANDOFF.md is ${handoffAge} days old — update before next push to main`);

// 5. Unmerged feat/* branches inactive > 14 days
const unmergedRemote = tryRun("git branch -r --no-merged origin/main")
  .split("\n").map((s) => s.trim()).filter((s) => s && !s.includes("HEAD") && s !== "origin/staging" && s !== "origin/dev" && !s.startsWith("origin/chore/consolidation"));
const inactive: string[] = [];
for (const b of unmergedRemote) {
  const lastDate = tryRun(`git log -1 --format=%ct ${b}`);
  if (!lastDate) continue;
  const age = (NOW - parseInt(lastDate) * 1000) / DAY;
  if (age > 14) inactive.push(`${b} (${Math.floor(age)}d)`);
}
if (inactive.length) note(`⚠ ${inactive.length} unmerged remote branch(es) inactive > 14 days — consider tag-and-delete:\n    ${inactive.join("\n    ")}`);

// 6. Migrations local vs prod check (info only — needs Supabase MCP at runtime to fully verify)
const localMigrations = existsSync(join(REPO, "supabase/migrations"))
  ? readdirSync(join(REPO, "supabase/migrations")).filter((f) => f.endsWith(".sql")).length
  : 0;
note(`ℹ ${localMigrations} local migration files in supabase/migrations/. Verify against prod via Supabase MCP if any are unapplied.`);

// 7. Branch info (always shown)
const branch = tryRun("git rev-parse --abbrev-ref HEAD");
const aheadBehind = tryRun(`git rev-list --left-right --count origin/main...${branch} 2>/dev/null`);
note(`ℹ on branch '${branch}' — ahead/behind origin/main: ${aheadBehind || "?"}`);

// Render
if (findings.length === 0) {
  console.log("✓ No drift detected. Repo is clean.\n");
} else {
  for (const f of findings) console.log(f);
  console.log("");
}
