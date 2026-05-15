// src/components/blog/ally-starters.ts
//
// Pool of new-post topic ideas. Four are surfaced per day, picked deterministically
// from the day of year + a small rolling offset so the user sees a fresh set without
// the chips reshuffling every page load. Pool is intentionally diverse — market
// updates, neighborhood spotlights, buyer/seller guides, lifestyle, FAQs — so any
// rotation lands a useful mix.

const POOL: string[] = [
  // Market updates / data-driven
  "Punta Gorda month-over-month market update with current stats",
  "Charlotte County housing trends YTD with sources",
  "Burnt Store Isles vs Punta Gorda Isles — comparing the two markets",
  "Florida mortgage rate trends and what they mean for buyers right now",
  "Days-on-market trend for waterfront homes in The Isles",
  "Where Charlotte County prices are heading next quarter",

  // Neighborhood spotlights
  "Neighborhood spotlight: Burnt Store Isles",
  "Neighborhood spotlight: Punta Gorda Isles",
  "Living in Babcock Ranch — what locals love",
  "Why families choose Deep Creek over downtown Punta Gorda",
  "Englewood beaches: pros, cons, and the homes nearby",
  "Charlotte Harbor downtown — restaurants, marinas, and the lifestyle",

  // Buyer guides
  "First-time buyer's guide to Punta Gorda — financing, neighborhoods, timing",
  "How to buy a waterfront home in The Isles: dock rights, seawalls, insurance",
  "Punta Gorda relocation guide for snowbirds",
  "Out-of-state buyer's checklist for Charlotte County",
  "VA-loan buyers: which Punta Gorda neighborhoods qualify",

  // Seller guides
  "Top 5 ways to prep your Punta Gorda Isles home for spring listing",
  "How much does staging actually add to a Charlotte County sale price",
  "When to list your waterfront home for the best price",
  "Why your home isn't selling — and what to change",

  // Lifestyle
  "Best fishing spots within 20 minutes of Punta Gorda Isles",
  "Top boating restaurants in Charlotte Harbor",
  "Day trips from Punta Gorda for new residents",
  "Pickleball and tennis around Charlotte County — where to play",

  // FAQs / explainers
  "FAQ: HOA fees in Punta Gorda Isles vs Burnt Store Isles",
  "Hurricane prep checklist for Charlotte County homeowners",
  "Property tax basics for new Florida residents",
  "Flood zones explained — what AE, X, and VE actually mean for buyers",
  "What does Punta Gorda's recent waterfront permit moratorium mean for buyers?",
];

export function dailyStarters(count = 4): string[] {
  // Day-of-year (UTC) drives a deterministic rotation. Two-day offset so a
  // user revisiting next morning sees a fully fresh set, not a partial shift.
  const now = new Date();
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86_400_000);
  const start = (dayOfYear * 2) % POOL.length;
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(POOL[(start + i) % POOL.length]);
  return out;
}
