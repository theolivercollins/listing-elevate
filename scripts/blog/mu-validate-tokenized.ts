// scripts/blog/mu-validate-tokenized.ts
// Validates the two tokenized MU templates produced by the tokenization task.
// Reads from templates/market-update/ and prints validator output.
// EXIT 0 = zero errors on both templates; EXIT 1 = any errors found.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateTemplateTokens } from "../../lib/blog-engine/market-update/validate-template.js";
import { tokensInTemplate } from "../../lib/blog-engine/market-update/fill.js";

const WORKTREE = "/Users/oliverhelgemo/listing-elevate/.claude/worktrees/mu-template-tokenize-fix";

const TEMPLATES: Array<{ file: string; role: "blog" | "email"; label: string }> = [
  {
    file: join(WORKTREE, "templates/market-update/Blog_Template_MU.tokenized.html"),
    role: "blog",
    label: "Blog_Template_MU.tokenized.html",
  },
  {
    file: join(WORKTREE, "templates/market-update/Email_Template_MU.tokenized.html"),
    role: "email",
    label: "Email_Template_MU.tokenized.html",
  },
];

// Required tokens that MUST be present per task spec.
const REQUIRED = new Set(["REGION_NAME", "FOR_SALE", "SOLD", "PENDED", "DOM"]);

let anyErrors = false;

for (const { file, role, label } of TEMPLATES) {
  const html = readFileSync(file, "utf8");
  const result = validateTemplateTokens(html, role);
  const found = tokensInTemplate(html);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Template: ${label}  [${html.length} bytes]`);
  console.log(`Tokens found (${found.length}): ${found.join(", ")}`);
  console.log(`\nErrors (${result.errors.length}):`);
  if (result.errors.length === 0) {
    console.log("  (none)");
  } else {
    for (const e of result.errors) {
      console.log(`  ERROR: ${e}`);
    }
    anyErrors = true;
  }
  console.log(`\nWarnings (${result.warnings.length}):`);
  for (const w of result.warnings) {
    console.log(`  WARN: ${w}`);
  }

  // Check required tokens are present.
  const foundSet = new Set(found);
  const missingRequired = [...REQUIRED].filter((t) => !foundSet.has(t));
  if (missingRequired.length > 0) {
    console.log(`\nMISSING REQUIRED tokens: ${missingRequired.join(", ")}`);
    anyErrors = true;
  } else {
    console.log(`\nAll required tokens present: ${[...REQUIRED].join(", ")} ✓`);
  }
}

console.log(`\n${"=".repeat(70)}`);
console.log(anyErrors ? "\nVALIDATION FAIL — errors found above." : "\nVALIDATION PASS — zero errors on both templates.");
process.exit(anyErrors ? 1 : 0);
