export interface PricingTier {
  id: string;
  name: string;
  priceUsd: number;
  tagline: string;
  features: string[];
  isLead: boolean;
}

const MOCK_TIERS: PricingTier[] = [
  {
    id: "starter",
    name: "Single Listing",
    priceUsd: 65,
    tagline: "One listing, one video.",
    features: ["Up to 60 photos", "16:9 and 9:16 delivered", "Under 24 hours", "Unlimited minor edits"],
    isLead: true,
  },
  {
    id: "pro",
    name: "Five-Pack",
    priceUsd: 275,
    tagline: "$55 per listing.",
    features: ["Everything in Single", "Voiceover included", "Priority queue"],
    isLead: false,
  },
  {
    id: "brokerage",
    name: "Brokerage",
    priceUsd: 0,
    tagline: "Talk to us.",
    features: ["Volume pricing", "Brand kit on every video", "Dedicated account manager"],
    isLead: false,
  },
];

export async function getPricingTiers(): Promise<PricingTier[]> {
  return MOCK_TIERS;
}
