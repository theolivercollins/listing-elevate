// Market Update workflow — shared types + the canonical metric/token vocabulary.
// See docs/superpowers/specs/2026-06-04-market-update-workflow-design.md.

export type Trend =
  | "appreciating"
  | "depreciating"
  | "neutral"
  | "upward"
  | "downward"
  | "rising"
  | "falling";

export type MarketVerdict = "Seller's" | "Buyer's" | "Neutral";

/** One metric's value plus its month-over-month and year-over-year context. */
export interface MetricStat {
  /** The reported figure for the data month (e.g. 163 listings, 665000 dollars). */
  current: number;
  /** Prior month's figure, when the report states it (used to re-derive MoM%). */
  prev_month: number | null;
  /** Same month one year ago, when the report states it (used to re-derive YoY%). */
  prev_year: number | null;
  /** Reported month-over-month change, signed percent (e.g. 22.2 or -15.1). */
  mom_pct: number | null;
  /** Reported year-over-year change, signed percent. */
  yoy_pct: number | null;
  /** Reported 6-month trend label, when present. */
  trend?: Trend | null;
}

/** The 13 canonical metric keys, in display order. */
export const METRIC_KEYS = [
  "for_sale",
  "sold",
  "pended",
  "avg_for_sale_price",
  "avg_sold_price",
  "median_sold_price",
  "avg_ppsf",
  "dom",
  "sold_to_list",
  "moi_closed",
  "moi_pended",
  "absorption_closed",
  "absorption_pended",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

/** How each metric formats into template tokens. */
export const METRIC_FORMAT: Record<MetricKey, "count" | "price" | "percent" | "days" | "months"> = {
  for_sale: "count",
  sold: "count",
  pended: "count",
  avg_for_sale_price: "price",
  avg_sold_price: "price",
  median_sold_price: "price",
  avg_ppsf: "price",
  dom: "days",
  sold_to_list: "percent",
  moi_closed: "months",
  moi_pended: "months",
  absorption_closed: "percent",
  absorption_pended: "percent",
};

export interface RegionMetrics {
  region_name: string;
  /** The DATA month, e.g. "March" (report published the following month). */
  report_month: string;
  report_year: number;
  /** Month the report was published, e.g. "April 2026" — optional. */
  published_month: string | null;
  market_verdict: MarketVerdict;
  metrics: Record<MetricKey, MetricStat>;
}

export interface MathIssue {
  severity: "error" | "warning";
  field: string;
  message: string;
  expected?: string | number;
  got?: string | number;
}

/** Meta tokens that are not per-metric. */
export const META_TOKENS = [
  "REGION_NAME",
  "REPORT_MONTH",
  "REPORT_YEAR",
  "MARKET_VERDICT",
] as const;

/** Per-metric token suffixes appended to the uppercased metric key. */
export const METRIC_TOKEN_SUFFIXES = [
  "", // current value, e.g. {{SOLD}}
  "_MOM",
  "_YOY",
  "_PREV_MONTH",
  "_PREV_YEAR",
  "_TREND",
  "_MOM_DIR",
  "_YOY_DIR",
] as const;

/** The complete set of valid token names (without the surrounding {{ }}). */
export function allTokenNames(): string[] {
  const out: string[] = [...META_TOKENS];
  for (const key of METRIC_KEYS) {
    const upper = key.toUpperCase();
    for (const suffix of METRIC_TOKEN_SUFFIXES) {
      out.push(upper + suffix);
    }
  }
  return out;
}
