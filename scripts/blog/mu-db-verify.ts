// scripts/blog/mu-db-verify.ts
// Full backend verification against the REAL Supabase + REAL Claude:
// analyzeRun -> generateDrafts -> confirm draft rows exist -> CLEAN UP.
// Proves the real-schema inserts (blog_posts/emails/market_update_runs) work.
// Creates only DRAFT rows (never publishes/sends) and soft-deletes them after.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { getSupabase } from "../../lib/client.js";
import { analyzeRun, generateDrafts } from "../../lib/blog-engine/market-update/run.js";

const ISLES_PDF = "/Users/oliverhelgemo/Documents/PDFs/Market Reports/BSI+PGI MU NOV 2025.pdf";

async function main() {
  const supabase = getSupabase();
  const { data: site } = await supabase.from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) throw new Error("no sierra site");
  const siteId = site.id as string;

  const { data: regionCfg } = await supabase.from("mu_regions")
    .select("slug, display_name, strip_images, emits_email").eq("site_id", siteId).eq("active", true)
    .order("sort_order", { ascending: true });

  // Use .order + .limit(1) + .maybeSingle() instead of .single() so we pick
  // the oldest seeded template even when multiple rows exist (e.g. a 0-token
  // test upload). We also assert the selected template actually has tokens.
  const { data: blogTplRow } = await supabase.from("blog_templates")
    .select("id,body_html")
    .eq("site_id", siteId)
    .eq("metadata->>kind", "market_update")
    .eq("metadata->>mu_role", "blog")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: emailTplRow } = await supabase.from("email_templates")
    .select("id,body_html")
    .eq("site_id", siteId)
    .eq("metadata->>kind", "market_update")
    .eq("metadata->>mu_role", "email")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!regionCfg?.length || !blogTplRow || !emailTplRow) {
    throw new Error("missing seed config/templates");
  }

  // Enforce that the selected template actually has fill tokens — a zero-token
  // template would produce unfilled drafts and is not a valid seed.
  const blogTokenCount = (blogTplRow.body_html?.match(/\{\{[A-Z0-9_]+\}\}/g) ?? []).length;
  const emailTokenCount = (emailTplRow.body_html?.match(/\{\{[A-Z0-9_]+\}\}/g) ?? []).length;
  if (blogTokenCount === 0) {
    throw new Error(
      `blog template ${blogTplRow.id} has zero {{TOKEN}} placeholders — ` +
      "upload a valid fill template, not a rendered post",
    );
  }
  if (emailTokenCount === 0) {
    throw new Error(
      `email template ${emailTplRow.id} has zero {{TOKEN}} placeholders — ` +
      "upload a valid fill template, not a rendered email",
    );
  }
  console.log(`  blog template: ${blogTplRow.id} (${blogTokenCount} tokens)`);
  console.log(`  email template: ${emailTplRow.id} (${emailTokenCount} tokens)`);

  // Plumbing test: feed the validated Isles report into every region slot so
  // all three pass validation and generateDrafts runs end to end.
  const pdf = readFileSync(ISLES_PDF).toString("base64");
  const regions = regionCfg.map((r: any) => ({
    slug: r.slug, display_name: r.display_name, pdf_base64: pdf,
    strip_images: r.strip_images, emits_email: r.emits_email,
  }));

  console.log("analyzeRun (real Claude extraction x3)...");
  const analyzed = await analyzeRun({
    supabase, siteId, periodMonth: 10, periodYear: 2025,
    blogTemplateId: blogTplRow.id, emailTemplateId: emailTplRow.id, regions,
  });
  console.log(`  run ${analyzed.runId} · status=${analyzed.status} · cost=${analyzed.costCents}c`);
  if (analyzed.status !== "ready") {
    console.log("  region issues:", JSON.stringify(analyzed.results.flatMap((r) => r.issues), null, 2));
    throw new Error(`expected status 'ready', got '${analyzed.status}'`);
  }

  console.log("generateDrafts (fill + FAQ rewrite + real inserts)...");
  const gen = await generateDrafts({ supabase, siteId, runId: analyzed.runId });
  console.log(`  created posts=${gen.postIds.length} emails=${gen.emailIds.length} cost=${gen.costCents}c`);

  // Confirm the rows really landed with the expected shape.
  const { data: posts } = await supabase.from("blog_posts").select("id,title,state,category_label,body_html").in("id", gen.postIds);
  const { data: emails } = await supabase.from("emails").select("id,subject,state,body_html").in("id", gen.emailIds);
  console.log("  posts:", posts?.map((p: any) => `${p.state} · ${p.title} · ${p.body_html.length}b`).join("\n         "));
  console.log("  email:", emails?.map((e: any) => `${e.state} · ${e.subject} · ${e.body_html.length}b`).join(""));

  // Assert zero unresolved non-passthrough {{TOKEN}} remain in any draft.
  // passthrough tokens are intentional (CTA_URL, UNSUBSCRIBE_URL, etc.) and
  // are filled by the delivery layer, not by the MU pipeline.
  const { PASSTHROUGH_TOKENS } = await import("../../lib/blog-engine/market-update/types.js");
  const unresolvedRe = /\{\{([A-Z0-9_]+)\}\}/g;
  const unresolvedInPosts: string[] = [];
  for (const p of (posts ?? [])) {
    for (const m of p.body_html.matchAll(unresolvedRe)) {
      if (!PASSTHROUGH_TOKENS.has(m[1])) unresolvedInPosts.push(`post[${p.id}]:${m[1]}`);
    }
  }
  const unresolvedInEmails: string[] = [];
  for (const e of (emails ?? [])) {
    for (const m of e.body_html.matchAll(unresolvedRe)) {
      if (!PASSTHROUGH_TOKENS.has(m[1])) unresolvedInEmails.push(`email[${e.id}]:${m[1]}`);
    }
  }
  if (unresolvedInPosts.length > 0) {
    console.error(`ERROR: unresolved non-passthrough tokens in posts: ${unresolvedInPosts.join(", ")}`);
  }
  if (unresolvedInEmails.length > 0) {
    console.error(`ERROR: unresolved non-passthrough tokens in emails: ${unresolvedInEmails.join(", ")}`);
  }

  const ok =
    gen.postIds.length === 3 &&
    gen.emailIds.length === 1 &&
    unresolvedInPosts.length === 0 &&
    unresolvedInEmails.length === 0 &&
    (posts ?? []).every((p: any) => p.state === "draft_ready" && p.body_html.includes("Market Update")) &&
    (emails ?? []).every((e: any) => e.state === "draft");

  // ── CLEANUP — soft-delete drafts + remove the test run (keep cost_events) ──
  console.log("cleanup...");
  await supabase.from("blog_posts").update({ active: false }).in("id", gen.postIds);
  await supabase.from("emails").update({ active: false }).in("id", gen.emailIds);
  await supabase.from("market_update_runs").delete().eq("id", analyzed.runId);
  console.log("  drafts soft-deleted, test run removed.");

  console.log(`\n${ok ? "DB VERIFY PASS -- full backend path works against real schema" : "DB VERIFY FAIL"}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
