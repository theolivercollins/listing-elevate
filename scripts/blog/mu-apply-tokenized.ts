// scripts/blog/mu-apply-tokenized.ts
//
// One-off idempotent apply tool: writes the tokenized MU HTML files from
// templates/market-update/ into the two live Supabase template rows.
//
// Targets (exact ids, single-row updates only):
//   blog_templates   718e9f58-cb55-4f11-8c5a-664f0be0391c
//   email_templates  8757c0e2-6551-4580-8f96-44177f5aa517
//
// Rollback: re-UPDATE body_html from the tmp/ backup files written here.
//
// NEVER a bulk update. One row per statement, matched by exact id.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { config as dotenvConfig } from "dotenv";
import { getSupabase } from "../../lib/client.js";
import { validateTemplateTokens } from "../../lib/blog-engine/market-update/validate-template.js";
import { tokensInTemplate } from "../../lib/blog-engine/market-update/fill.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const BLOG_TEMPLATE_ID  = "718e9f58-cb55-4f11-8c5a-664f0be0391c";
const EMAIL_TEMPLATE_ID = "8757c0e2-6551-4580-8f96-44177f5aa517";

// Tokens the post-update assertion requires (spec §4).
const REQUIRED_TOKENS = new Set(["REGION_NAME", "FOR_SALE", "SOLD", "PENDED", "DOM"]);

// ── Repo root + path resolution ───────────────────────────────────────────────

// REPO_ROOT is this worktree's checkout (where the tokenized template files live).
// MAIN_REPO_ROOT is the canonical repo root (where .env lives).  In a worktree,
// `git rev-parse --git-common-dir` returns the shared .git directory, whose parent
// is always the main checkout — so we can derive the .env path portably.
const REPO_ROOT      = execSync("git rev-parse --show-toplevel").toString().trim();
const GIT_COMMON_DIR = execSync("git rev-parse --git-common-dir").toString().trim();
const MAIN_REPO_ROOT = dirname(GIT_COMMON_DIR); // e.g. /repo/.git → /repo

// Load .env from the main checkout — worktrees don't have their own .env.
// Must happen before getSupabase() reads process.env.
dotenvConfig({ path: join(MAIN_REPO_ROOT, ".env") });

const TMP_DIR   = join(REPO_ROOT, "tmp");

const BLOG_TOKENIZED_PATH  = join(REPO_ROOT, "templates/market-update/Blog_Template_MU.tokenized.html");
const EMAIL_TOKENIZED_PATH = join(REPO_ROOT, "templates/market-update/Email_Template_MU.tokenized.html");

const BACKUP_BLOG_PATH  = join(TMP_DIR, "backup-blog_templates-718e9f58.html");
const BACKUP_EMAIL_PATH = join(TMP_DIR, "backup-email_templates-8757c0e2.html");

// ── Helpers ───────────────────────────────────────────────────────────────────

function countTokens(html: string): number {
  return tokensInTemplate(html).length;
}

function readTokenizedFile(path: string, label: string): string {
  if (!existsSync(path)) {
    throw new Error(`Tokenized file missing: ${path}  (label: ${label})`);
  }
  const content = readFileSync(path, "utf8").trim();
  if (content.length === 0) {
    throw new Error(`Tokenized file is empty: ${path}  (label: ${label})`);
  }
  return readFileSync(path, "utf8"); // return un-trimmed original
}

// ── Target descriptor ─────────────────────────────────────────────────────────

interface Target {
  table:        "blog_templates" | "email_templates";
  id:           string;
  role:         "blog" | "email";
  tokenizedPath: string;
  backupPath:   string;
  label:        string;
}

const TARGETS: Target[] = [
  {
    table:         "blog_templates",
    id:            BLOG_TEMPLATE_ID,
    role:          "blog",
    tokenizedPath: BLOG_TOKENIZED_PATH,
    backupPath:    BACKUP_BLOG_PATH,
    label:         "Blog_Template_MU",
  },
  {
    table:         "email_templates",
    id:            EMAIL_TEMPLATE_ID,
    role:          "email",
    tokenizedPath: EMAIL_TOKENIZED_PATH,
    backupPath:    BACKUP_EMAIL_PATH,
    label:         "Email_Template_MU",
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(TMP_DIR, { recursive: true });

  console.log("=".repeat(72));
  console.log("mu-apply-tokenized — PROD DATA WRITE (approved)");
  console.log(`Repo root : ${REPO_ROOT}`);
  console.log(`Tmp dir   : ${TMP_DIR}`);
  console.log("=".repeat(72));

  // ── Step 1: pre-flight — read both tokenized files before touching DB ──────
  console.log("\n[1/3] Pre-flight: reading tokenized files …");

  const tokenizedHtmlMap: Record<string, string> = {};
  for (const t of TARGETS) {
    const html = readTokenizedFile(t.tokenizedPath, t.label);
    tokenizedHtmlMap[t.id] = html;
    console.log(`  OK  ${t.label}  [${html.length} bytes, ${countTokens(html)} tokens]  ← ${t.tokenizedPath}`);
  }

  // ── Step 2: back up current body_html from DB ─────────────────────────────
  console.log("\n[2/3] Backing up current body_html rows …");

  const supabase = getSupabase();
  const summaryRows: Array<{
    label:        string;
    table:        string;
    id:           string;
    name:         string;
    beforeTokens: number;
    afterTokens:  number;
    validatorErrors: number;
    backupPath:   string;
    restored?:    boolean;
  }> = [];

  for (const t of TARGETS) {
    const { data: currentRow, error: fetchErr } = await supabase
      .from(t.table)
      .select("id,name,body_html")
      .eq("id", t.id)
      .single();

    if (fetchErr || !currentRow) {
      throw new Error(
        `Row not found in ${t.table} id=${t.id} — aborting before any write.\n` +
        `Supabase error: ${JSON.stringify(fetchErr)}`,
      );
    }

    const currentHtml  = currentRow.body_html ?? "";
    const beforeTokens = countTokens(currentHtml);

    writeFileSync(t.backupPath, currentHtml, "utf8");
    console.log(
      `  backed up  ${t.table} / ${t.id}  (${currentRow.name})  ` +
      `[${currentHtml.length} bytes, ${beforeTokens} tokens]  → ${t.backupPath}`,
    );

    summaryRows.push({
      label:           t.label,
      table:           t.table,
      id:              t.id,
      name:            currentRow.name as string,
      beforeTokens,
      afterTokens:     0,   // filled in below
      validatorErrors: -1,  // filled in below
      backupPath:      t.backupPath,
    });
  }

  // ── Step 3: apply updates one row at a time ───────────────────────────────
  console.log("\n[3/3] Applying tokenized HTML (one row per statement) …");

  for (let i = 0; i < TARGETS.length; i++) {
    const t   = TARGETS[i];
    const row = summaryRows[i];
    const newHtml = tokenizedHtmlMap[t.id];

    console.log(`\n  → UPDATE ${t.table} SET body_html = <${newHtml.length} bytes> WHERE id = '${t.id}'`);

    const { error: updateErr } = await supabase
      .from(t.table)
      .update({ body_html: newHtml, updated_at: new Date().toISOString() })
      .eq("id", t.id);

    if (updateErr) {
      throw new Error(
        `UPDATE failed for ${t.table} id=${t.id}: ${JSON.stringify(updateErr)}\n` +
        `Rollback: re-update body_html from ${t.backupPath}`,
      );
    }

    // ── Post-update read-back & assertion ──────────────────────────────────
    const { data: verifyRow, error: verifyErr } = await supabase
      .from(t.table)
      .select("id,name,body_html")
      .eq("id", t.id)
      .single();

    if (verifyErr || !verifyRow) {
      throw new Error(
        `Post-update read-back failed for ${t.table} id=${t.id}: ${JSON.stringify(verifyErr)}\n` +
        `Rollback: re-update body_html from ${t.backupPath}`,
      );
    }

    const savedHtml   = verifyRow.body_html ?? "";
    const afterTokens = countTokens(savedHtml);
    const validation  = validateTemplateTokens(savedHtml, t.role);

    // Check the 4 core tokens + REGION_NAME.
    const foundSet     = new Set(tokensInTemplate(savedHtml));
    const missingCores = [...REQUIRED_TOKENS].filter((tok) => !foundSet.has(tok));

    row.afterTokens     = afterTokens;
    row.validatorErrors = validation.errors.length;

    const hasRegionName = savedHtml.includes("{{REGION_NAME}}");

    if (!hasRegionName) {
      console.error(`\n!!!!  POST-UPDATE ASSERTION FAILED for ${t.table} / ${t.id}  !!!!`);
      console.error(`  {{REGION_NAME}} NOT FOUND in saved body_html.`);
      console.error(`  The write may have been truncated or corrupted.`);
      console.error(`  RESTORE INSTRUCTIONS:`);
      console.error(`    1. Read: ${t.backupPath}`);
      console.error(`    2. Re-UPDATE ${t.table} SET body_html = <backup contents> WHERE id = '${t.id}'`);
      row.restored = false;
    }

    if (missingCores.length > 0) {
      console.error(`\n!!!!  MISSING CORE TOKENS for ${t.table} / ${t.id}  !!!!`);
      console.error(`  Missing: ${missingCores.map((s) => `{{${s}}}`).join(", ")}`);
      console.error(`  RESTORE INSTRUCTIONS:`);
      console.error(`    1. Read: ${t.backupPath}`);
      console.error(`    2. Re-UPDATE ${t.table} SET body_html = <backup contents> WHERE id = '${t.id}'`);
    }

    if (validation.errors.length > 0) {
      console.error(`\n!!!!  VALIDATOR ERRORS for ${t.table} / ${t.id}  !!!!`);
      for (const e of validation.errors) {
        console.error(`  ERROR: ${e}`);
      }
      console.error(`  RESTORE INSTRUCTIONS:`);
      console.error(`    1. Read: ${t.backupPath}`);
      console.error(`    2. Re-UPDATE ${t.table} SET body_html = <backup contents> WHERE id = '${t.id}'`);
    }

    if (validation.warnings.length > 0) {
      for (const w of validation.warnings) {
        console.log(`  WARN: ${w}`);
      }
    }

    const statusLine = (
      validation.errors.length === 0 &&
      missingCores.length === 0 &&
      hasRegionName
    ) ? "OK" : "FAIL";

    console.log(
      `  ${statusLine}  ${t.table} / ${t.id}` +
      `  before=${row.beforeTokens} tokens  after=${afterTokens} tokens` +
      `  validator_errors=${validation.errors.length}`,
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));

  let anyFail = false;
  for (const r of summaryRows) {
    const pass = r.validatorErrors === 0;
    if (!pass) anyFail = true;
    console.log(`\n  ${pass ? "PASS" : "FAIL"}  ${r.label}`);
    console.log(`        table          : ${r.table}`);
    console.log(`        id             : ${r.id}`);
    console.log(`        name           : ${r.name}`);
    console.log(`        tokens before  : ${r.beforeTokens}  (0 expected — untokenized source)`);
    console.log(`        tokens after   : ${r.afterTokens}`);
    console.log(`        validator errs : ${r.validatorErrors}  (must be 0)`);
    console.log(`        backup         : ${r.backupPath}`);
  }

  console.log("\n" + "=".repeat(72));
  if (anyFail) {
    console.error("RESULT: FAIL — one or more rows have validator errors.  See restore instructions above.");
    process.exit(1);
  } else {
    console.log("RESULT: PASS — both rows updated and validated successfully.");
  }
}

main().catch((e: unknown) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
