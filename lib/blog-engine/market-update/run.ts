// Orchestrator for the Market Update workflow. Two phases mirror the API:
//   analyzeRun()    — extract + validate every region, persist a run row.
//   generateDrafts()— fill templates, rewrite FAQ, strip images, create drafts.
// A run with any error-severity issue is `needs_review` and creates no drafts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractRegion } from "./extract.js";
import { validateMetrics, hasBlockingIssues } from "./validate.js";
import { buildTokenMap } from "./format.js";
import { fillTemplate } from "./fill.js";
import { rewriteFaq } from "./faq.js";
import { stripImages } from "./strip-images.js";
import type { MathIssue, RegionMetrics } from "./types.js";

export interface RegionInput {
  slug: string;
  display_name: string;
  pdf_base64: string;
  filename?: string;
  strip_images: boolean;
  emits_email: boolean;
}

export interface RegionResult {
  region_slug: string;
  region_name: string;
  strip_images: boolean;
  emits_email: boolean;
  metrics: RegionMetrics | null;
  issues: MathIssue[];
  post_id?: string | null;
  email_id?: string | null;
  error?: string | null;
}

export interface AnalyzeArgs {
  supabase: SupabaseClient;
  siteId: string;
  periodMonth: number;
  periodYear: number;
  blogTemplateId: string;
  emailTemplateId: string | null;
  regions: RegionInput[];
}

/** Phase 1: extract + validate each region; persist the run. */
export async function analyzeRun(args: AnalyzeArgs): Promise<{ runId: string; status: string; results: RegionResult[]; costCents: number }> {
  const { supabase, siteId } = args;

  const { data: runRow, error: insErr } = await supabase
    .from("market_update_runs")
    .insert([{
      site_id: siteId,
      period_month: args.periodMonth,
      period_year: args.periodYear,
      status: "extracting",
      blog_template_id: args.blogTemplateId,
      email_template_id: args.emailTemplateId,
    }])
    .select("id")
    .single();
  if (insErr || !runRow) throw new Error(`analyzeRun: could not create run: ${insErr?.message}`);
  const runId = runRow.id as string;

  const results: RegionResult[] = [];
  let costCents = 0;

  for (const region of args.regions) {
    try {
      const { metrics, costCents: c } = await extractRegion(region.pdf_base64, region.display_name, {
        supabase,
        siteId,
        runId,
      });
      costCents += c;
      const issues = validateMetrics(metrics);
      results.push({
        region_slug: region.slug,
        region_name: region.display_name,
        strip_images: region.strip_images,
        emits_email: region.emits_email,
        metrics,
        issues,
      });
    } catch (e: any) {
      results.push({
        region_slug: region.slug,
        region_name: region.display_name,
        strip_images: region.strip_images,
        emits_email: region.emits_email,
        metrics: null,
        issues: [{ severity: "error", field: "extract", message: e?.message ?? String(e) }],
        error: e?.message ?? String(e),
      });
    }
  }

  const anyBlocking = results.some((r) => !r.metrics || hasBlockingIssues(r.issues));
  const status = anyBlocking ? "needs_review" : "ready";

  await supabase
    .from("market_update_runs")
    .update({ status, region_results: results, cost_usd_cents: costCents, updated_at: new Date().toISOString() })
    .eq("id", runId);

  return { runId, status, results, costCents };
}

function monthName(m: number): string {
  return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1] ?? String(m);
}

export interface GenerateArgs {
  supabase: SupabaseClient;
  siteId: string;
  runId: string;
  acknowledgeWarnings?: boolean;
}

/** Phase 2: fill + create drafts for a `ready` (or warnings-acknowledged) run. */
export async function generateDrafts(args: GenerateArgs): Promise<{ status: string; postIds: string[]; emailIds: string[]; costCents: number }> {
  const { supabase, siteId, runId } = args;

  const { data: run, error: runErr } = await supabase
    .from("market_update_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (runErr || !run) throw new Error(`generateDrafts: run not found: ${runErr?.message}`);

  const results = (run.region_results ?? []) as RegionResult[];
  const anyError = results.some((r) => !r.metrics || r.issues.some((i) => i.severity === "error"));
  if (anyError) throw new Error("generateDrafts: run has unresolved error-severity issues; refusing to create drafts");

  const blogTpl = await loadTemplateHtml(supabase, "blog_templates", run.blog_template_id);
  const emailTpl = run.email_template_id ? await loadTemplateHtml(supabase, "email_templates", run.email_template_id) : null;

  const period = `${monthName(run.period_month)} ${run.period_year}`;
  const postIds: string[] = [];
  const emailIds: string[] = [];
  let costCents = 0;

  for (const r of results) {
    if (!r.metrics) continue;
    const tokenMap = buildTokenMap(r.metrics);

    // --- Blog post ---
    const filled = fillTemplate(blogTpl, tokenMap);
    if (filled.unknownTokens.length > 0) {
      throw new Error(`blog template references unknown tokens: ${filled.unknownTokens.join(", ")}`);
    }
    let blogHtml = filled.html;
    const faq = await rewriteFaq(blogHtml, r.metrics, { supabase, siteId, runId });
    blogHtml = faq.html;
    costCents += faq.costCents;
    if (r.strip_images) blogHtml = stripImages(blogHtml);

    const title = `${r.region_name} Market Update — ${period}`;
    const { data: post, error: pErr } = await supabase
      .from("blog_posts")
      .insert([{
        site_id: siteId,
        state: "draft_ready",
        title,
        body_html: blogHtml,
        category_label: "Market Update",
        meta_title: title,
        meta_description: `${r.region_name} real estate market update for ${period}: inventory, sales, prices and trends.`,
        metadata: { authored: "market_update", mu_run_id: runId, region_slug: r.region_slug },
      }])
      .select("id")
      .single();
    if (pErr || !post) throw new Error(`generateDrafts: blog insert failed for ${r.region_slug}: ${pErr?.message}`);
    r.post_id = post.id;
    postIds.push(post.id);

    // --- Email (Charlotte County only) ---
    if (r.emits_email && emailTpl) {
      const eFilled = fillTemplate(emailTpl, tokenMap);
      if (eFilled.unknownTokens.length > 0) {
        throw new Error(`email template references unknown tokens: ${eFilled.unknownTokens.join(", ")}`);
      }
      let emailHtml = eFilled.html;
      const eFaq = await rewriteFaq(emailHtml, r.metrics, { supabase, siteId, runId });
      emailHtml = eFaq.html;
      costCents += eFaq.costCents;

      const subject = `${r.region_name} Market Update — ${period}`;
      const { data: email, error: eErr } = await supabase
        .from("emails")
        .insert([{
          site_id: siteId,
          template_id: run.email_template_id,
          source_post_id: post.id,
          state: "draft",
          subject,
          body_html: emailHtml,
          authored: "market_update",
          metadata: { mu_run_id: runId, region_slug: r.region_slug },
        }])
        .select("id")
        .single();
      if (eErr || !email) throw new Error(`generateDrafts: email insert failed: ${eErr?.message}`);
      r.email_id = email.id;
      emailIds.push(email.id);
    }
  }

  await supabase
    .from("market_update_runs")
    .update({
      status: "generated",
      region_results: results,
      created_post_ids: postIds,
      created_email_ids: emailIds,
      cost_usd_cents: (run.cost_usd_cents ?? 0) + costCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);

  return { status: "generated", postIds, emailIds, costCents };
}

async function loadTemplateHtml(supabase: SupabaseClient, table: string, id: string): Promise<string> {
  const { data, error } = await supabase.from(table).select("body_html").eq("id", id).single();
  if (error || !data) throw new Error(`loadTemplateHtml(${table}/${id}): ${error?.message ?? "not found"}`);
  return (data.body_html as string) ?? "";
}
