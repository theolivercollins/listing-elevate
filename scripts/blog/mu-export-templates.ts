// scripts/blog/mu-export-templates.ts
// Exports the two MU source templates from Supabase to tmp/ for tokenization.
// READ-ONLY: only fetches body_html, writes local files. No DB writes.
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { getSupabase } from "../../lib/client.js";

const BLOG_TEMPLATE_ID = "718e9f58-cb55-4f11-8c5a-664f0be0391c";
const EMAIL_TEMPLATE_ID = "8757c0e2-6551-4580-8f96-44177f5aa517";

// Resolve repo root portably — works from any checkout or worktree.
const REPO_ROOT = execSync("git rev-parse --show-toplevel").toString().trim();
const OUT_DIR = join(REPO_ROOT, "tmp");

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const supabase = getSupabase();

  const { data: blogRow, error: blogErr } = await supabase
    .from("blog_templates")
    .select("id,name,body_html")
    .eq("id", BLOG_TEMPLATE_ID)
    .single();
  if (blogErr || !blogRow) throw new Error(`blog template fetch failed: ${JSON.stringify(blogErr)}`);

  const { data: emailRow, error: emailErr } = await supabase
    .from("email_templates")
    .select("id,name,body_html")
    .eq("id", EMAIL_TEMPLATE_ID)
    .single();
  if (emailErr || !emailRow) throw new Error(`email template fetch failed: ${JSON.stringify(emailErr)}`);

  const blogPath = join(OUT_DIR, "Blog_Template_MU.src.html");
  const emailPath = join(OUT_DIR, "Email_Template_MU.src.html");

  writeFileSync(blogPath, blogRow.body_html ?? "", "utf8");
  writeFileSync(emailPath, emailRow.body_html ?? "", "utf8");

  console.log(`blog  template: ${blogRow.id} (${blogRow.name}) → ${blogPath}  [${(blogRow.body_html ?? "").length} bytes]`);
  console.log(`email template: ${emailRow.id} (${emailRow.name}) → ${emailPath}  [${(emailRow.body_html ?? "").length} bytes]`);
  console.log("\nDone. Inspect files before tokenizing.");
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
