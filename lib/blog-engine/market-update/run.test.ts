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
  const tables: Record<string, any[]> = { market_update_runs: [], blog_posts: [], emails: [], blog_templates: [{ id: "btpl", body_html: "<p>{{REGION_NAME}} {{SOLD}}</p>" }], email_templates: [{ id: "etpl", body_html: "<p>{{REGION_NAME}}</p>" }], ...seed };
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
