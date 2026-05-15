import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PRICING_TIERS } from "../../src/v2/components/landing/Pricing.js";
import { FAQ_ITEMS } from "../../src/v2/components/landing/FAQ.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function buildKnowledge(): { pricingJson: string; faqJson: string } {
  if (!PRICING_TIERS || PRICING_TIERS.length === 0) {
    throw new Error(
      "PRICING_TIERS export is missing or empty in src/v2/components/landing/Pricing.tsx",
    );
  }
  if (!FAQ_ITEMS || FAQ_ITEMS.length === 0) {
    throw new Error(
      "FAQ_ITEMS export is missing or empty in src/v2/components/landing/FAQ.tsx",
    );
  }
  return {
    pricingJson: JSON.stringify(PRICING_TIERS, null, 2),
    faqJson: JSON.stringify(FAQ_ITEMS, null, 2),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pricingJson, faqJson } = buildKnowledge();
  writeFileSync(resolve(__dirname, "pricing.json"), pricingJson);
  writeFileSync(resolve(__dirname, "faq.json"), faqJson);
  console.log("[build-knowledge] wrote pricing.json + faq.json");
}
