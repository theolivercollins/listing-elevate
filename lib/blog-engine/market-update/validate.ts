// Pure deterministic math validation — the programmatic double-check the spec
// requires. Re-derives MoM% / YoY% from the reported values and flags drift,
// plus sanity-checks market verdict and absorption against months of inventory.

import { METRIC_KEYS, type MetricKey, type RegionMetrics, type MathIssue } from "./types.js";

/** Allowed gap (percentage points) between reported and re-derived MoM/YoY. */
export const PCT_TOLERANCE = 0.75;
/** Allowed gap for the absorption≈100/MOI inverse sanity check (percentage points). */
const ABSORPTION_TOLERANCE = 2.0;

function deriveAndCheck(
  key: MetricKey,
  label: "MoM" | "YoY",
  current: number,
  prior: number | null,
  reported: number | null,
  issues: MathIssue[],
): void {
  if (prior === null || reported === null) return; // nothing to cross-check
  if (prior === 0) return; // division guard; source wouldn't report a % here
  const derived = ((current - prior) / Math.abs(prior)) * 100;
  if (Math.abs(derived - reported) > PCT_TOLERANCE) {
    issues.push({
      severity: "error",
      field: `${key}.${label.toLowerCase()}_pct`,
      message: `${key} ${label} reported ${reported}% but ${current} vs ${prior} implies ${derived.toFixed(1)}%`,
      expected: Number(derived.toFixed(1)),
      got: reported,
    });
  }
}

function verdictFromMoi(moi: number): "Seller's" | "Buyer's" | "Neutral" {
  if (moi < 3) return "Seller's";
  if (moi > 6) return "Buyer's";
  return "Neutral";
}

/**
 * Validate one region's metrics. Returns issues; `error`-severity issues must
 * block draft creation, `warning`-severity issues surface but don't block.
 */
export function validateMetrics(region: RegionMetrics): MathIssue[] {
  const issues: MathIssue[] = [];
  const m = region.metrics;

  // 1. Required meta present.
  if (!region.region_name) issues.push({ severity: "error", field: "region_name", message: "region_name missing" });
  if (!region.report_month) issues.push({ severity: "error", field: "report_month", message: "report_month missing" });
  if (!region.report_year) issues.push({ severity: "error", field: "report_year", message: "report_year missing" });

  // 2. Each metric: a current value must exist, and MoM/YoY must reconcile.
  for (const key of METRIC_KEYS) {
    const stat = m[key];
    if (!stat || stat.current === null || stat.current === undefined || Number.isNaN(stat.current)) {
      issues.push({ severity: "error", field: `${key}.current`, message: `${key} current value missing` });
      continue;
    }
    deriveAndCheck(key, "MoM", stat.current, stat.prev_month, stat.mom_pct, issues);
    deriveAndCheck(key, "YoY", stat.current, stat.prev_year, stat.yoy_pct, issues);
  }

  // 3. Market verdict vs months-of-inventory (closed). Warning — source labels
  //    the market on varying bases, so a mismatch is worth surfacing, not blocking.
  const moiClosed = m.moi_closed?.current;
  if (typeof moiClosed === "number" && !Number.isNaN(moiClosed)) {
    const implied = verdictFromMoi(moiClosed);
    if (implied !== region.market_verdict) {
      issues.push({
        severity: "warning",
        field: "market_verdict",
        message: `verdict "${region.market_verdict}" but MOI(closed)=${moiClosed} implies "${implied}"`,
        expected: implied,
        got: region.market_verdict,
      });
    }
  }

  // 4. Absorption ≈ 100 / MOI (inverse relationship). Warning only.
  checkAbsorptionInverse("closed", m.absorption_closed?.current, moiClosed, issues);
  checkAbsorptionInverse("pended", m.absorption_pended?.current, m.moi_pended?.current, issues);

  return issues;
}

function checkAbsorptionInverse(
  basis: string,
  absorption: number | undefined,
  moi: number | undefined,
  issues: MathIssue[],
): void {
  if (typeof absorption !== "number" || typeof moi !== "number" || moi === 0) return;
  const implied = 100 / moi;
  if (Math.abs(implied - absorption) > ABSORPTION_TOLERANCE) {
    issues.push({
      severity: "warning",
      field: `absorption_${basis}`,
      message: `absorption(${basis})=${absorption}% but 100/MOI=${implied.toFixed(1)}%`,
      expected: Number(implied.toFixed(1)),
      got: absorption,
    });
  }
}

/** Convenience: true when no error-severity issues are present. */
export function hasBlockingIssues(issues: MathIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
