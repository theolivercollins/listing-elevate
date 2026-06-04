import { describe, it, expect } from "vitest";
import type { RegionMetrics, MetricKey, MetricStat } from "./types.js";
import { allTokenNames, METRIC_KEYS } from "./types.js";
import { buildTokenMap, formatValue, formatSignedPct, direction } from "./format.js";
import { fillTemplate, tokensInTemplate } from "./fill.js";
import { stripImages } from "./strip-images.js";
import { validateMetrics, hasBlockingIssues } from "./validate.js";

// Fixture built from the real "Burnt Store Isles, Punta Gorda Isles" Stellar
// report (October 2025 data, published Nov 2025) — The Isles.
function stat(p: Partial<MetricStat> & { current: number }): MetricStat {
  return { prev_month: null, prev_year: null, mom_pct: null, yoy_pct: null, ...p };
}

function islesFixture(): RegionMetrics {
  const metrics = {
    for_sale: stat({ current: 396, prev_month: 372, prev_year: 333, mom_pct: 6.5, yoy_pct: 18.9 }),
    sold: stat({ current: 66, prev_month: 54, prev_year: 52, mom_pct: 22.2, yoy_pct: 26.9 }),
    pended: stat({ current: 61, prev_month: 55, prev_year: 29, mom_pct: 10.9, yoy_pct: 110.3 }),
    avg_for_sale_price: stat({ current: 699000, prev_month: 636000, prev_year: 688000, mom_pct: 9.9, yoy_pct: 1.6 }),
    avg_sold_price: stat({ current: 488000, prev_month: 486000, prev_year: 562000, mom_pct: 0.4, yoy_pct: -13.2 }),
    median_sold_price: stat({ current: 400000, prev_month: 400000, prev_year: 443000, mom_pct: 0, yoy_pct: -9.7, trend: "depreciating" }),
    avg_ppsf: stat({ current: 231, prev_month: 230, prev_year: 245, mom_pct: 0.4, yoy_pct: -5.7, trend: "neutral" }),
    dom: stat({ current: 129, prev_month: 141, prev_year: 98, mom_pct: -8.5, yoy_pct: 31.6, trend: "neutral" }),
    sold_to_list: stat({ current: 89, prev_year: 87, yoy_pct: 2.3 }),
    moi_closed: stat({ current: 6, prev_year: 6.4, yoy_pct: -6.2 }),
    moi_pended: stat({ current: 6.5, prev_year: 11.5, yoy_pct: -43.5 }),
    absorption_closed: stat({ current: 16.7, prev_year: 15.6, yoy_pct: 7 }),
    absorption_pended: stat({ current: 15.4, prev_year: 8.7, yoy_pct: 76.9 }),
  } as Record<MetricKey, MetricStat>;
  return {
    region_name: "The Isles",
    report_month: "October",
    report_year: 2025,
    published_month: "November 2025",
    market_verdict: "Neutral",
    metrics,
  };
}

describe("format", () => {
  it("formats prices, percents, counts, months", () => {
    expect(formatValue(665000, "price")).toBe("$665,000");
    expect(formatValue(231, "price")).toBe("$231");
    expect(formatValue(90, "percent")).toBe("90%");
    expect(formatValue(16.7, "percent")).toBe("16.7%");
    expect(formatValue(2.8, "months")).toBe("2.8");
    expect(formatValue(108, "count")).toBe("108");
    expect(formatValue(null, "count")).toBe("");
  });

  it("formats signed percent and direction", () => {
    expect(formatSignedPct(22.2)).toBe("+22.2%");
    expect(formatSignedPct(-15.1)).toBe("-15.1%");
    expect(formatSignedPct(0)).toBe("0%");
    expect(formatSignedPct(null)).toBe("");
    expect(direction(22.2)).toBe("up");
    expect(direction(-5.3)).toBe("down");
    expect(direction(0)).toBe("flat");
  });

  it("builds a token map covering every canonical token", () => {
    const map = buildTokenMap(islesFixture());
    expect(map.REGION_NAME).toBe("The Isles");
    expect(map.MARKET_VERDICT).toBe("Neutral");
    expect(map.SOLD).toBe("66");
    expect(map.SOLD_MOM).toBe("+22.2%");
    expect(map.SOLD_MOM_DIR).toBe("up");
    expect(map.MEDIAN_SOLD_PRICE).toBe("$400,000");
    expect(map.MEDIAN_SOLD_PRICE_TREND).toBe("Depreciating");
    expect(map.DOM).toBe("129");
    expect(map.MOI_CLOSED).toBe("6");
    // every canonical token must be present in the map
    for (const name of allTokenNames()) {
      expect(map[name], `missing token ${name}`).toBeDefined();
    }
  });
});

describe("fill", () => {
  it("replaces known tokens and reports unknowns", () => {
    const map = buildTokenMap(islesFixture());
    const tpl = "<p>{{SOLD}} sold, {{SOLD_MOM}} MoM in {{REGION_NAME}}. {{BOGUS_TOKEN}}</p>";
    const r = fillTemplate(tpl, map);
    expect(r.html).toContain("66 sold, +22.2% MoM in The Isles.");
    expect(r.html).toContain("{{BOGUS_TOKEN}}"); // unknown left visible
    expect(r.unknownTokens).toEqual(["BOGUS_TOKEN"]);
  });

  it("tolerates whitespace inside braces and lists template tokens", () => {
    const map = buildTokenMap(islesFixture());
    const r = fillTemplate("{{ SOLD }}", map);
    expect(r.html).toBe("66");
    expect(tokensInTemplate("{{SOLD}} {{DOM}} {{SOLD}}")).toEqual(["SOLD", "DOM"]);
  });

  it("flags empty tokens", () => {
    const region = islesFixture();
    region.metrics.sold.mom_pct = null; // SOLD_MOM becomes empty
    const map = buildTokenMap(region);
    const r = fillTemplate("x{{SOLD_MOM}}y", map);
    expect(r.html).toBe("xy");
    expect(r.emptyTokens).toContain("SOLD_MOM");
  });
});

describe("stripImages", () => {
  it("removes img, picture and MU:IMAGE markers", () => {
    const html =
      '<div><img src="a.jpg" alt="x"/><picture><source srcset="b"><img src="c"></picture>' +
      "<!-- MU:IMAGE hero --><figure></figure><p>keep</p></div>";
    const out = stripImages(html);
    expect(out).not.toMatch(/<img|<picture|MU:IMAGE|<figure>\s*<\/figure>/);
    expect(out).toContain("<p>keep</p>");
  });
});

describe("validate", () => {
  it("passes clean real-report data with no errors", () => {
    const issues = validateMetrics(islesFixture());
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors, JSON.stringify(errors)).toHaveLength(0);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("flags a wrong MoM percentage as an error", () => {
    const region = islesFixture();
    region.metrics.sold.mom_pct = 50; // truth is ~22.2%
    const issues = validateMetrics(region);
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.find((i) => i.field === "sold.mom_pct")?.severity).toBe("error");
  });

  it("flags a missing current value as an error", () => {
    const region = islesFixture();
    // @ts-expect-error intentionally break it
    region.metrics.dom.current = null;
    const issues = validateMetrics(region);
    expect(issues.find((i) => i.field === "dom.current")?.severity).toBe("error");
  });

  it("warns when verdict disagrees with MOI", () => {
    const region = islesFixture();
    region.market_verdict = "Seller's"; // MOI 6 implies Neutral
    const issues = validateMetrics(region);
    const w = issues.find((i) => i.field === "market_verdict");
    expect(w?.severity).toBe("warning");
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("covers all 13 metric keys in the fixture", () => {
    const region = islesFixture();
    for (const k of METRIC_KEYS) expect(region.metrics[k], `fixture missing ${k}`).toBeDefined();
  });
});
