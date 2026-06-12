// TDD: tests written BEFORE the implementation of validateTemplateTokens.
import { describe, it, expect } from "vitest";
import { validateTemplateTokens } from "./validate-template.js";
import { allTokenNames, PASSTHROUGH_TOKENS } from "./types.js";

// A minimal snippet using only canonical tokens — uses a handful of valid ones.
const CANONICAL_HTML = "<p>{{SOLD}} sold in {{REGION_NAME}} for {{REPORT_MONTH}} {{REPORT_YEAR}}. {{MARKET_VERDICT}}.</p>";

// A template that uses EVERY canonical token — zero warnings.
function buildFullTemplate(): string {
  return allTokenNames().map((t) => `{{${t}}}`).join(" ");
}

describe("validateTemplateTokens", () => {
  it("returns no errors on a template using only canonical tokens (warns for unused ones)", () => {
    // Using a subset of canonical tokens is fine — no errors, but warnings for the absent ones.
    const result = validateTemplateTokens(CANONICAL_HTML, "blog");
    expect(result.errors).toHaveLength(0);
    // Warnings for absent canonical tokens are expected and non-blocking.
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns zero errors AND zero warnings when ALL canonical tokens are present", () => {
    const result = validateTemplateTokens(buildFullTemplate(), "blog");
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns a blocking error naming an unknown (typo'd) token", () => {
    const html = "<p>{{SOULD}} sold</p>"; // SOULD is not canonical
    const result = validateTemplateTokens(html, "blog");
    const err = result.errors.find((e) => e.includes("SOULD"));
    expect(err, "expected an error mentioning SOULD").toBeTruthy();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("does NOT flag passthrough tokens as unknown", () => {
    // All PASSTHROUGH_TOKENS must pass through without errors.
    const passthroughHtml = [...PASSTHROUGH_TOKENS]
      .map((t) => `{{${t}}}`)
      .join(" ");
    const result = validateTemplateTokens(passthroughHtml, "blog");
    expect(result.errors).toHaveLength(0);
  });

  it("returns a warning (not an error) for canonical tokens absent from the template", () => {
    const result = validateTemplateTokens(CANONICAL_HTML, "blog");
    // SOLD, REGION_NAME etc are present, but many others (e.g. AVG_SOLD_PRICE) are not.
    // Warnings expected; zero errors.
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    // Each warning should mention a canonical token name.
    const allNames = new Set(allTokenNames());
    for (const w of result.warnings) {
      const match = w.match(/[A-Z][A-Z0-9_]+/);
      expect(match, `warning "${w}" does not mention a token name`).toBeTruthy();
      if (match) expect(allNames.has(match[0]), `"${match[0]}" in warning is not canonical`).toBe(true);
    }
  });

  it("returns a blocking error when the HTML contains zero {{TOKEN}} placeholders", () => {
    const result = validateTemplateTokens("<p>Hello world, no tokens here.</p>", "blog");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => /no.*token|zero.*token|token.*found/i.test(e))).toBe(true);
  });

  it("does not error on HTML that contains only passthrough tokens (warns for missing canonical tokens)", () => {
    // A template with ONLY passthrough tokens has valid tokens but no canonical
    // tokens — warn but do not block.
    const passthroughOnly = "{{CTA_URL}} {{UNSUBSCRIBE_URL}}";
    const result = validateTemplateTokens(passthroughOnly, "blog");
    // Passthrough-only — no unknown-token errors, but canonical missing warnings apply.
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("works the same way for email role (same vocab)", () => {
    const html = `<p>{{SOLD}} sold in {{REGION_NAME}}. <a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a></p>`;
    const result = validateTemplateTokens(html, "email");
    expect(result.errors).toHaveLength(0);
  });

  it("returns multiple error entries when multiple unknown tokens are present", () => {
    const html = "<p>{{SOULD}} {{BOGUS_METRIC}} {{SOLD}}</p>";
    const result = validateTemplateTokens(html, "blog");
    // Two distinct unknown tokens — combined error message mentioning both.
    const combined = result.errors.join(" ");
    expect(combined).toContain("SOULD");
    expect(combined).toContain("BOGUS_METRIC");
  });
});
