// Pure formatting: turn a RegionMetrics object into a flat token -> string map.
// No AI, no I/O. This is the deterministic core of "replace all placeholders".

import {
  METRIC_KEYS,
  METRIC_FORMAT,
  type MetricKey,
  type MetricStat,
  type RegionMetrics,
} from "./types.js";

/** Format a raw numeric figure according to its metric's display kind. */
export function formatValue(
  value: number | null,
  kind: "count" | "price" | "percent" | "days" | "months",
): string {
  if (value === null || Number.isNaN(value)) return "";
  switch (kind) {
    case "price":
      return "$" + Math.round(value).toLocaleString("en-US");
    case "percent":
      // One decimal unless it's a whole number (e.g. 90% not 90.0%).
      return trimDecimal(value) + "%";
    case "months":
      return trimDecimal(value);
    case "days":
    case "count":
      return Math.round(value).toLocaleString("en-US");
  }
}

/** Signed percent string, e.g. "+22.2%", "-15.1%", "0%". Empty when null. */
export function formatSignedPct(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) return "";
  const sign = pct > 0 ? "+" : "";
  return sign + trimDecimal(pct) + "%";
}

/** Direction flag driving ↑/↓ glyphs + colour in templates. */
export function direction(pct: number | null): "up" | "down" | "flat" {
  if (pct === null || Number.isNaN(pct)) return "flat";
  if (pct > 0.05) return "up";
  if (pct < -0.05) return "down";
  return "flat";
}

function trimDecimal(n: number): string {
  // Round to 1 decimal, then drop a trailing ".0".
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function metricTokens(key: MetricKey, stat: MetricStat): Record<string, string> {
  const upper = key.toUpperCase();
  const kind = METRIC_FORMAT[key];
  return {
    [upper]: formatValue(stat.current, kind),
    [`${upper}_MOM`]: formatSignedPct(stat.mom_pct),
    [`${upper}_YOY`]: formatSignedPct(stat.yoy_pct),
    [`${upper}_PREV_MONTH`]: formatValue(stat.prev_month, kind),
    [`${upper}_PREV_YEAR`]: formatValue(stat.prev_year, kind),
    [`${upper}_TREND`]: stat.trend ? capitalize(stat.trend) : "",
    [`${upper}_MOM_DIR`]: direction(stat.mom_pct),
    [`${upper}_YOY_DIR`]: direction(stat.yoy_pct),
  };
}

/** Build the full token -> value map for one region. */
export function buildTokenMap(region: RegionMetrics): Record<string, string> {
  const map: Record<string, string> = {
    REGION_NAME: region.region_name,
    REPORT_MONTH: region.report_month,
    REPORT_YEAR: String(region.report_year),
    MARKET_VERDICT: region.market_verdict,
  };
  for (const key of METRIC_KEYS) {
    Object.assign(map, metricTokens(key, region.metrics[key]));
  }
  return map;
}
