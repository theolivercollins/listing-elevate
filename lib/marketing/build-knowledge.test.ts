import { describe, it, expect } from "vitest";
import { buildKnowledge } from "./build-knowledge";
import { PRICING_TIERS } from "../../src/v2/components/landing/Pricing";
import { FAQ_ITEMS } from "../../src/v2/components/landing/FAQ";

describe("buildKnowledge", () => {
  it("emits pricing.json matching PRICING_TIERS", () => {
    const out = buildKnowledge();
    expect(JSON.parse(out.pricingJson)).toEqual(PRICING_TIERS);
  });

  it("emits faq.json matching FAQ_ITEMS", () => {
    const out = buildKnowledge();
    expect(JSON.parse(out.faqJson)).toEqual(FAQ_ITEMS);
  });

  it("PRICING_TIERS and FAQ_ITEMS are non-empty (regression guard)", () => {
    expect(PRICING_TIERS.length).toBeGreaterThan(0);
    expect(FAQ_ITEMS.length).toBeGreaterThan(0);
  });
});
