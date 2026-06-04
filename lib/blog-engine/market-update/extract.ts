// Extract a region's RegionMetrics from a Stellar MLS report PDF using Claude
// tool-use with a forced JSON schema. This is the ONLY AI step that touches
// numbers — every figure it emits is re-derived and checked by validate.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, MU_MODEL } from "./client.js";
import { recordBlogCost } from "../cost.js";
import { computeClaudeCost } from "../../utils/claude-cost.js";
import { METRIC_KEYS, type RegionMetrics } from "./types.js";

const TREND_VALUES = [
  "appreciating",
  "depreciating",
  "neutral",
  "upward",
  "downward",
  "rising",
  "falling",
];

function metricStatSchema() {
  return {
    type: "object",
    properties: {
      current: { type: ["number", "null"], description: "the reported figure for the data month; null if the metric is absent from the report" },
      prev_month: { type: ["number", "null"], description: "prior month's figure if stated, else null" },
      prev_year: { type: ["number", "null"], description: "same month last year if stated, else null" },
      mom_pct: { type: ["number", "null"], description: "reported month-over-month percent, signed (e.g. -15.1)" },
      yoy_pct: { type: ["number", "null"], description: "reported year-over-year percent, signed" },
      trend: { type: ["string", "null"], enum: [...TREND_VALUES, null], description: "reported 6-month trend label if stated" },
    },
    required: ["current", "prev_month", "prev_year", "mom_pct", "yoy_pct"],
    additionalProperties: false,
  };
}

function buildSchema() {
  const metricProps: Record<string, unknown> = {};
  for (const key of METRIC_KEYS) metricProps[key] = metricStatSchema();
  return {
    type: "object",
    properties: {
      region_name: { type: "string" },
      report_month: { type: "string", description: "the DATA month, e.g. 'March' (report is published the following month)" },
      report_year: { type: "integer" },
      published_month: { type: ["string", "null"] },
      market_verdict: { type: "string", enum: ["Seller's", "Buyer's", "Neutral"] },
      metrics: {
        type: "object",
        properties: metricProps,
        required: [...METRIC_KEYS],
        additionalProperties: false,
      },
    },
    required: ["region_name", "report_month", "report_year", "market_verdict", "metrics"],
    additionalProperties: false,
  };
}

const SYSTEM = `You are a meticulous real-estate data extractor. You are given a monthly Stellar MLS market report PDF for ONE region.
Extract every metric EXACTLY as printed. Do not compute, round, or infer values — copy the numbers the report states.
- For prices, strip "$" and commas (e.g. $665,000 -> 665000).
- For percentages, use the signed number only (e.g. "down 15.1%" -> -15.1, "up 22.2%" -> 22.2).
- "current" is the value for the data month. "prev_month" is last month's value, "prev_year" is the same month a year ago — only when the report explicitly states them, otherwise null.
- months of inventory (MOI) and absorption rate appear in two bases: "based on Closed Sales" (-> *_closed) and "based on Pended Sales" (-> *_pended).
- avg_ppsf is "Average Sold Price per Square Footage". sold_to_list is "Sold Price vs. Original List Price" ratio as a whole percent (e.g. 89).
- report_month is the month the DATA covers (often one month before the publish date).
- CRITICAL: if a metric is NOT shown in the report, set its current (and every field) to null. NEVER use 0 as a placeholder and NEVER invent or guess a value. A genuine zero only appears if the report literally prints 0.
Call emit_metrics exactly once with the full structured result.`;

export interface ExtractResult {
  metrics: RegionMetrics;
  costCents: number;
}

/**
 * Extract one region's metrics from a base64-encoded PDF.
 * Records a `blog_mu_extract` cost event when siteId is provided.
 */
export async function extractRegion(
  pdfBase64: string,
  regionName: string,
  opts: { supabase?: SupabaseClient; siteId?: string | null; runId?: string | null } = {},
): Promise<ExtractResult> {
  const result = await anthropic().messages.create({
    model: MU_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [
      {
        name: "emit_metrics",
        description: "Return the fully structured metrics extracted from the report.",
        input_schema: buildSchema() as any,
      },
    ],
    tool_choice: { type: "tool", name: "emit_metrics" },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: `Region: ${regionName}. Extract all metrics from this report.` },
        ],
      },
    ],
  });

  const toolUse = result.content.find((c: any) => c.type === "tool_use");
  if (!toolUse) throw new Error(`extractRegion(${regionName}): model did not return tool_use`);
  const metrics = (toolUse as any).input as RegionMetrics;
  // Trust the operator-facing region label over whatever the model echoed.
  metrics.region_name = regionName;

  const cost = computeClaudeCost(result.usage, MU_MODEL);
  if (opts.supabase && opts.siteId) {
    await recordBlogCost(opts.supabase, {
      stage: "blog_mu_extract",
      cost_cents: cost.costCents,
      post_id: null,
      site_id: opts.siteId,
      provider: "anthropic",
      metadata: { model: MU_MODEL, region: regionName, run_id: opts.runId ?? null, usage: result.usage },
    });
  }

  return { metrics, costCents: cost.costCents };
}
