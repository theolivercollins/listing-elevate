import { describe, it, expect } from "vitest";
import { getPricingTiers } from "./pricing";
import { getFaqs } from "./faqs";

describe("getPricingTiers", () => {
  it("lead tier starts at 65", async () => {
    const tiers = await getPricingTiers();
    const lead = tiers.find(t => t.isLead);
    expect(lead?.priceUsd).toBe(65);
  });
});

describe("getFaqs", () => {
  it("returns at least 6 Q/A pairs", () => {
    const faqs = getFaqs();
    expect(faqs.length).toBeGreaterThanOrEqual(6);
    for (const f of faqs) {
      expect(f.question.length).toBeGreaterThan(0);
      expect(f.answer.length).toBeGreaterThan(0);
    }
  });
});
