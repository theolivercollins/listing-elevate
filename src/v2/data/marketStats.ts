export interface MarketStatValue {
  label: string;
  numericMax?: number;
}

export interface MarketStatRow {
  id: string;
  dimension: string;
  market: MarketStatValue;
  elevate: MarketStatValue;
  source: { label: string; url: string };
  counterStat?: { pct: number; label: string };
}

// Four rows, each tied to an external primary or trade-body source.
// A fifth "agent effort per video" row was dropped because no independent
// survey cleanly quantifies the hours spent coordinating a traditional
// listing video — better to ship four cited rows than five with one
// fabricated (per plan Task 22 rules).
const MOCK_ROWS: MarketStatRow[] = [
  {
    id: "cost",
    dimension: "Cost per listing video",
    // HomeJab 2024 guide: "on average, a professionally produced real
    // estate video in the U.S. ranges from $300 to $1,500 per video,"
    // with premium/cinematic packages running $1,000–$1,500+.
    market: { label: "$300–$1,500", numericMax: 1500 },
    elevate: { label: "$65 starting", numericMax: 65 },
    source: {
      label: "HomeJab Real Estate Videography Pricing Guide (2024)",
      url: "https://homejab.com/how-much-do-real-estate-videos-cost/",
    },
  },
  {
    id: "turnaround",
    dimension: "Turnaround",
    // Fotober pricing guide: "a turnaround window of 48 to 72 hours is
    // within the industry's acceptable tolerance, typically costing
    // between $400 and $800."
    market: { label: "48–72 hours", numericMax: 72 },
    elevate: { label: "Under 24 hours", numericMax: 24 },
    source: {
      label: "Fotober Real Estate Video Pricing (2025)",
      url: "https://fotober.com/real-estate-video-pricing",
    },
  },
  {
    id: "preference",
    dimension: "Sellers preferring agents who market with video",
    // Properties Online, Real Estate Tech Trends report (©2018, p. 9):
    // "73% of homeowners say they're more likely to list with a realtor
    // offering to do a video but only 11% of agents do."
    market: { label: "73% prefer video agents", numericMax: 73 },
    elevate: { label: "Every listing, default", numericMax: 100 },
    source: {
      label: "Properties Online Real Estate Tech Trends (2018)",
      url: "https://propertiesonline.com/Reports/annual-real-estate-trends-report.pdf",
    },
    counterStat: { pct: 11, label: "of agents actually offer it" },
  },
  {
    id: "demand",
    dimension: "Consumer demand for video",
    // Wyzowl State of Video Marketing 2026: "84% of consumers want to
    // see more videos from brands in 2026" and "85% of people have been
    // convinced to buy a product or service by watching a video."
    market: { label: "84% want more video", numericMax: 84 },
    elevate: { label: "Every listing gets one", numericMax: 100 },
    source: {
      label: "Wyzowl State of Video Marketing (2026)",
      url: "https://wyzowl.com/video-marketing-statistics/",
    },
  },
];

export async function getMarketStats(): Promise<MarketStatRow[]> {
  return MOCK_ROWS;
}
