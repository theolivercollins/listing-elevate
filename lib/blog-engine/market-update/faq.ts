// Rewrite ONLY the FAQ block of a filled MU template so the questions and
// answers reflect the new month's trends. Bounded by <!-- MU:FAQ_START --> /
// <!-- MU:FAQ_END --> markers; if absent, the HTML is returned unchanged.

import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, MU_MODEL } from "./client.js";
import { recordBlogCost } from "../cost.js";
import { computeClaudeCost } from "../../utils/claude-cost.js";
import type { RegionMetrics } from "./types.js";

const FAQ_RE = /(<!--\s*MU:FAQ_START\s*-->)([\s\S]*?)(<!--\s*MU:FAQ_END\s*-->)/i;

export interface FaqResult {
  html: string;
  costCents: number;
  rewritten: boolean;
}

function metricsBrief(region: RegionMetrics): string {
  const m = region.metrics;
  const line = (label: string, key: keyof typeof m) => {
    const s = m[key];
    if (!s) return "";
    const mom = s.mom_pct === null ? "" : ` (${s.mom_pct > 0 ? "+" : ""}${s.mom_pct}% MoM)`;
    const yoy = s.yoy_pct === null ? "" : ` (${s.yoy_pct > 0 ? "+" : ""}${s.yoy_pct}% YoY)`;
    return `- ${label}: ${s.current}${mom}${yoy}`;
  };
  return [
    `${region.region_name} — ${region.report_month} ${region.report_year} — ${region.market_verdict} market`,
    line("For sale", "for_sale"),
    line("Sold", "sold"),
    line("Pending", "pended"),
    line("Median sold price", "median_sold_price"),
    line("Avg $/sqft", "avg_ppsf"),
    line("Days on market", "dom"),
    line("Sold/list ratio", "sold_to_list"),
    line("Months of inventory (closed)", "moi_closed"),
  ].filter(Boolean).join("\n");
}

const SYSTEM = `You rewrite the FAQ section of a real-estate market-update blog post.
You are given (1) the current FAQ HTML and (2) this month's market data.
Rewrite the questions and answers so they directly reflect the new numbers and trend (e.g. if it shifted to a seller's market, the Q&A should say so).
Rules:
- Keep the SAME HTML structure/tags as the input FAQ (same heading levels, same number of Q&A items unless the data clearly warrants one more or fewer).
- Use only the data provided — never invent figures. Quote numbers from the data verbatim.
- Keep it concise and locally relevant. No competitor mentions. No images.
- Output ONLY the inner FAQ HTML (what goes between the markers), nothing else — no markdown fences, no commentary.`;

/**
 * Rewrite the FAQ block in `filledHtml`. Records a `blog_mu_faq` cost event
 * when siteId is provided. Returns the HTML unchanged (rewritten:false) when no
 * FAQ markers are present.
 */
export async function rewriteFaq(
  filledHtml: string,
  region: RegionMetrics,
  opts: { supabase?: SupabaseClient; siteId?: string | null; runId?: string | null } = {},
): Promise<FaqResult> {
  const match = filledHtml.match(FAQ_RE);
  if (!match) return { html: filledHtml, costCents: 0, rewritten: false };

  const currentFaq = match[2].trim();
  const result = await anthropic().messages.create({
    model: MU_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `CURRENT FAQ HTML:\n${currentFaq}\n\nTHIS MONTH'S DATA:\n${metricsBrief(region)}\n\n` +
          `Rewrite the FAQ inner HTML to reflect this month's data.`,
      },
    ],
  });

  const newFaq = result.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("")
    .trim();

  const cost = computeClaudeCost(result.usage, MU_MODEL);
  if (opts.supabase && opts.siteId) {
    await recordBlogCost(opts.supabase, {
      stage: "blog_mu_faq",
      cost_cents: cost.costCents,
      post_id: null,
      site_id: opts.siteId,
      provider: "anthropic",
      metadata: { model: MU_MODEL, region: region.region_name, run_id: opts.runId ?? null, usage: result.usage },
    });
  }

  // Defensive: if the model returned nothing usable, keep the original FAQ.
  const safeFaq = newFaq.length > 0 ? newFaq : currentFaq;
  const html = filledHtml.replace(FAQ_RE, `$1\n${safeFaq}\n$3`);
  return { html, costCents: cost.costCents, rewritten: newFaq.length > 0 };
}
