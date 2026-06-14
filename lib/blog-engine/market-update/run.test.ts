import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RegionMetrics, MetricKey, MetricStat } from "./types.js";
import { METRIC_KEYS } from "./types.js";

// Mock the two AI-calling modules so the orchestrator runs without network.
vi.mock("./extract.js", () => ({
  extractRegion: vi.fn(),
}));
vi.mock("./faq.js", () => ({
  rewriteFaq: vi.fn(async (html: string) => ({ html, costCents: 1, rewritten: true })),
}));

import { analyzeRun, generateDrafts } from "./run.js";
import { extractRegion } from "./extract.js";

function fullMetrics(name: string): RegionMetrics {
  const metrics = {} as Record<MetricKey, MetricStat>;
  for (const k of METRIC_KEYS) {
    metrics[k] = { current: 10, prev_month: 10, prev_year: 10, mom_pct: 0, yoy_pct: 0 };
  }
  return { region_name: name, report_month: "March", report_year: 2026, published_month: null, market_verdict: "Neutral", metrics };
}

// Minimal in-memory Supabase stub supporting the chained calls run.ts uses.
function makeSupabase(seed: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = { market_update_runs: [], blog_posts: [], emails: [], blog_templates: [{ id: "btpl", name: "Blog Template", body_html: "<p>{{REGION_NAME}} {{SOLD}}</p>" }], email_templates: [{ id: "etpl", name: "Email Template", body_html: "<p>{{REGION_NAME}}</p>" }], ...seed };
  let idc = 0;
  const nextId = (t: string) => `${t}-${++idc}`;

  function from(table: string) {
    const ctx: any = { table, filters: [] as [string, any][], _payload: null as any, _update: null as any };
    const api: any = {
      insert(rows: any[]) { ctx._payload = rows[0]; return api; },
      update(patch: any) { ctx._update = patch; return api; },
      select() { return api; },
      eq(col: string, val: any) { ctx.filters.push([col, val]); return api; },
      order() { return api; },
      limit() { return api; },
      async single() {
        if (ctx._payload) {
          const row = { id: nextId(table), ...ctx._payload };
          tables[table].push(row);
          ctx._inserted = row;
          return { data: { id: row.id, ...row }, error: null };
        }
        if (ctx._update) {
          const row = tables[table].find((r) => ctx.filters.every(([c, v]) => r[c] === v));
          if (row) Object.assign(row, ctx._update);
          return { data: row ?? null, error: null };
        }
        const row = tables[table].find((r) => ctx.filters.every(([c, v]) => r[c] === v));
        return { data: row ?? null, error: row ? null : { message: "not found" } };
      },
      then(resolve: any) {
        // terminal for update without single()
        if (ctx._update) {
          const row = tables[table].find((r) => ctx.filters.every(([c, v]) => r[c] === v));
          if (row) Object.assign(row, ctx._update);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  }
  return { from, _tables: tables } as any;
}

const regionInput = (slug: string, name: string, opts: Partial<{ strip: boolean; email: boolean }> = {}) => ({
  slug, display_name: name, pdf_base64: "BASE64", strip_images: opts.strip ?? false, emits_email: opts.email ?? false,
});

beforeEach(() => vi.clearAllMocks());

describe("analyzeRun", () => {
  it("returns ready and persists results when all regions validate", async () => {
    (extractRegion as any).mockImplementation(async (_pdf: string, name: string) => ({ metrics: fullMetrics(name), costCents: 2 }));
    const supabase = makeSupabase();
    const out = await analyzeRun({
      supabase, siteId: "site1", periodMonth: 3, periodYear: 2026,
      blogTemplateId: "btpl", emailTemplateId: "etpl",
      regions: [regionInput("charlotte_county", "Charlotte County", { email: true }), regionInput("the_isles", "The Isles", { strip: true })],
    });
    expect(out.status).toBe("ready");
    expect(out.results).toHaveLength(2);
    expect(out.costCents).toBe(4);
  });

  it("returns needs_review when a region fails validation", async () => {
    (extractRegion as any).mockImplementation(async (_pdf: string, name: string) => {
      const m = fullMetrics(name);
      m.metrics.sold.mom_pct = 99; // 10 vs 10 implies 0%, so 99% is a hard error
      return { metrics: m, costCents: 2 };
    });
    const supabase = makeSupabase();
    const out = await analyzeRun({
      supabase, siteId: "site1", periodMonth: 3, periodYear: 2026,
      blogTemplateId: "btpl", emailTemplateId: null,
      regions: [regionInput("deep_creek", "Deep Creek", { strip: true })],
    });
    expect(out.status).toBe("needs_review");
  });

  it("records an extract failure as a blocking error", async () => {
    (extractRegion as any).mockRejectedValue(new Error("pdf unreadable"));
    const supabase = makeSupabase();
    const out = await analyzeRun({
      supabase, siteId: "site1", periodMonth: 3, periodYear: 2026,
      blogTemplateId: "btpl", emailTemplateId: null,
      regions: [regionInput("the_isles", "The Isles")],
    });
    expect(out.status).toBe("needs_review");
    expect(out.results[0].issues[0].message).toContain("pdf unreadable");
  });
});

describe("generateDrafts", () => {
  it("creates a blog post per region and an email for the email-emitting region", async () => {
    (extractRegion as any).mockImplementation(async (_pdf: string, name: string) => ({ metrics: fullMetrics(name), costCents: 1 }));
    const supabase = makeSupabase();
    const analyzed = await analyzeRun({
      supabase, siteId: "site1", periodMonth: 3, periodYear: 2026,
      blogTemplateId: "btpl", emailTemplateId: "etpl",
      regions: [regionInput("charlotte_county", "Charlotte County", { email: true }), regionInput("the_isles", "The Isles", { strip: true })],
    });
    const gen = await generateDrafts({ supabase, siteId: "site1", runId: analyzed.runId });
    expect(gen.postIds).toHaveLength(2);
    expect(gen.emailIds).toHaveLength(1);
    expect(supabase._tables.blog_posts).toHaveLength(2);
    expect(supabase._tables.blog_posts[0].title).toContain("Charlotte County Market Update — March 2026");
    expect(supabase._tables.blog_posts[0].body_html).toContain("Charlotte County");
    expect(supabase._tables.emails[0].subject).toContain("Charlotte County");
  });

  it("refuses to generate when the run has error-severity issues", async () => {
    (extractRegion as any).mockImplementation(async (_pdf: string, name: string) => {
      const m = fullMetrics(name); m.metrics.dom.yoy_pct = 77; // 10 vs 10 => 0% expected
      return { metrics: m, costCents: 1 };
    });
    const supabase = makeSupabase();
    const analyzed = await analyzeRun({
      supabase, siteId: "site1", periodMonth: 3, periodYear: 2026,
      blogTemplateId: "btpl", emailTemplateId: null,
      regions: [regionInput("deep_creek", "Deep Creek", { strip: true })],
    });
    await expect(generateDrafts({ supabase, siteId: "site1", runId: analyzed.runId })).rejects.toThrow(/error-severity/);
    expect(supabase._tables.blog_posts).toHaveLength(0);
  });
});

describe("generateDrafts — template-token guard", () => {
  // Sets up a healthy analyzeRun (both regions extract fine) then swaps the
  // template HTML via the seed so the guard fires during generateDrafts.

  async function runWithBlogTemplate(blogHtml: string) {
    (extractRegion as any).mockImplementation(async (_pdf: string, name: string) => ({
      metrics: fullMetrics(name),
      costCents: 1,
    }));
    const supabase = makeSupabase({
      blog_templates: [{ id: "btpl", name: "Blog_Template_MU", body_html: blogHtml }],
      email_templates: [{ id: "etpl", name: "Email Template", body_html: "<p>{{REGION_NAME}}</p>" }],
    });
    const analyzed = await analyzeRun({
      supabase, siteId: "site1", periodMonth: 3, periodYear: 2026,
      blogTemplateId: "btpl", emailTemplateId: "etpl",
      regions: [regionInput("charlotte_county", "Charlotte County", { email: true })],
    });
    return { supabase, runId: analyzed.runId };
  }

  async function runWithEmailTemplate(emailHtml: string) {
    (extractRegion as any).mockImplementation(async (_pdf: string, name: string) => ({
      metrics: fullMetrics(name),
      costCents: 1,
    }));
    const supabase = makeSupabase({
      blog_templates: [{ id: "btpl", name: "Blog Template", body_html: "<p>{{REGION_NAME}} {{SOLD}}</p>" }],
      email_templates: [{ id: "etpl", name: "Email_Template_MU", body_html: emailHtml }],
    });
    const analyzed = await analyzeRun({
      supabase, siteId: "site1", periodMonth: 3, periodYear: 2026,
      blogTemplateId: "btpl", emailTemplateId: "etpl",
      regions: [regionInput("charlotte_county", "Charlotte County", { email: true })],
    });
    return { supabase, runId: analyzed.runId };
  }

  it("blocks generation and creates zero drafts when the blog template has no tokens", async () => {
    const { supabase, runId } = await runWithBlogTemplate("<p>Hardcoded content with no placeholders at all.</p>");
    // Both the failure sentinel and the offending template name must appear in the error.
    await expect(generateDrafts({ supabase, siteId: "site1", runId })).rejects.toThrow(
      /template validation failed.*Blog_Template_MU|Blog_Template_MU.*template validation failed/,
    );
    expect(supabase._tables.blog_posts).toHaveLength(0);
    expect(supabase._tables.emails).toHaveLength(0);
  });

  it("sets run status to needs_review when blog template has no tokens", async () => {
    const { supabase, runId } = await runWithBlogTemplate("<p>No placeholders here.</p>");
    await generateDrafts({ supabase, siteId: "site1", runId }).catch(() => {/* expected */});
    const run = supabase._tables.market_update_runs.find((r: any) => r.id === runId);
    expect(run.status).toBe("needs_review");
  });

  it("blocks generation when blog template contains only unknown tokens", async () => {
    // A template with tokens, but all unknown (not in the canonical vocabulary).
    const { supabase, runId } = await runWithBlogTemplate("<p>{{UNKNOWN_TOKEN_XYZ}} {{ANOTHER_BAD_ONE}}</p>");
    await expect(generateDrafts({ supabase, siteId: "site1", runId })).rejects.toThrow(/template validation failed/);
    expect(supabase._tables.blog_posts).toHaveLength(0);
  });

  it("blocks generation and creates zero drafts when the email template has no tokens", async () => {
    const { supabase, runId } = await runWithEmailTemplate("<p>Finished email with hardcoded content.</p>");
    await expect(generateDrafts({ supabase, siteId: "site1", runId })).rejects.toThrow(/Email_Template_MU/);
    expect(supabase._tables.blog_posts).toHaveLength(0);
    expect(supabase._tables.emails).toHaveLength(0);
  });

  it("blocks generation when blog template contains ONLY passthrough tokens (per-region guard)", async () => {
    // Passthrough-only template passes the zero-token and unknown-token checks but
    // contains no per-region differentiation — every region would get identical HTML.
    const { supabase, runId } = await runWithBlogTemplate(
      "<p>{{HEADLINE}}</p><p>Check out our latest update! <a href='{{CTA_URL}}'>{{CTA_TEXT}}</a></p><a href='{{UNSUBSCRIBE_URL}}'>Unsubscribe</a>",
    );
    await expect(generateDrafts({ supabase, siteId: "site1", runId })).rejects.toThrow(
      /template validation failed/,
    );
    expect(supabase._tables.blog_posts).toHaveLength(0);
    expect(supabase._tables.emails).toHaveLength(0);
  });

  it("allows generation when both templates are properly tokenized (happy path unchanged)", async () => {
    (extractRegion as any).mockImplementation(async (_pdf: string, name: string) => ({
      metrics: fullMetrics(name),
      costCents: 1,
    }));
    const supabase = makeSupabase();
    const analyzed = await analyzeRun({
      supabase, siteId: "site1", periodMonth: 4, periodYear: 2026,
      blogTemplateId: "btpl", emailTemplateId: "etpl",
      regions: [regionInput("charlotte_county", "Charlotte County", { email: true })],
    });
    const gen = await generateDrafts({ supabase, siteId: "site1", runId: analyzed.runId });
    expect(gen.postIds).toHaveLength(1);
    expect(gen.emailIds).toHaveLength(1);
    expect(supabase._tables.blog_posts).toHaveLength(1);
  });

  it("does NOT block on a template with warnings (missing canonical tokens but not zero/unknown)", async () => {
    // Template has only a subset of canonical tokens — warnings only, not errors.
    (extractRegion as any).mockImplementation(async (_pdf: string, name: string) => ({
      metrics: fullMetrics(name),
      costCents: 1,
    }));
    const supabase = makeSupabase({
      blog_templates: [{ id: "btpl", name: "Blog Template", body_html: "<p>{{REGION_NAME}}</p>" }],
    });
    const analyzed = await analyzeRun({
      supabase, siteId: "site1", periodMonth: 4, periodYear: 2026,
      blogTemplateId: "btpl", emailTemplateId: null,
      regions: [regionInput("charlotte_county", "Charlotte County")],
    });
    const gen = await generateDrafts({ supabase, siteId: "site1", runId: analyzed.runId });
    expect(gen.postIds).toHaveLength(1);
    expect(supabase._tables.blog_posts).toHaveLength(1);
  });
});
