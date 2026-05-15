// lib/blog-engine/source-allowlist.ts
//
// Rule: research sources may come from real-estate portals, news outlets,
// government / institutional sites, and our own posts. NEVER from another
// agent / team / brokerage site — they're competitors and citing them
// hurts SEO + brand. Applied both as a Gemini system-prompt rule and as a
// post-hoc filter on Gemini's returned source list, since the model can't
// be perfectly trusted to follow the rule alone.

const PORTAL_DOMAINS = new Set([
  "realtor.com",
  "zillow.com",
  "redfin.com",
  "trulia.com",
  "homes.com",
  "homefinder.com",
  "movoto.com",
  "estately.com",
  "realtytrac.com",
  "auction.com",
  "loopnet.com",
  "land.com",
]);

const BROKERAGE_DOMAINS = new Set([
  // National
  "century21.com",
  "remax.com",
  "kw.com",
  "kellerwilliams.com",
  "coldwellbanker.com",
  "berkshirehathawayhs.com",
  "berkshirehathaway.com",
  "exprealty.com",
  "compass.com",
  "douglaselliman.com",
  "sothebysrealty.com",
  "weichert.com",
  "longandfoster.com",
  "engelvoelkers.com",
  "realogy.com",
  "century21commercial.com",
  // Real estate franchises often spawn subdomains like name.century21.com —
  // host-suffix match catches those via the endsWith check below.
]);

const ALLOWED_NEWS_OR_GOV_SUFFIXES = [
  ".gov",
  ".edu",
];

const ALLOWED_DOMAINS_EXACT = new Set([
  // National news + finance
  "reuters.com", "apnews.com", "bloomberg.com", "wsj.com", "nytimes.com",
  "washingtonpost.com", "cnn.com", "cnbc.com", "marketwatch.com",
  "yahoo.com", "finance.yahoo.com", "businessinsider.com",
  // Real estate trade press
  "inman.com", "housingwire.com",
  // Industry data + portals (also covered by PORTAL_DOMAINS — kept for clarity)
  "nar.realtor",
  "freddiemac.com", "fanniemae.com",
  // Florida-specific outlets that come up for Punta Gorda / Charlotte County
  "wsj.com",
  "tampabay.com",
  "miamiherald.com",
  "sun-sentinel.com",
  "yoursun.com", // Charlotte Sun (Punta Gorda local paper)
  "wink.com", "nbc-2.com", "fox4now.com", // SW FL TV
  "wfla.com", "abcactionnews.com",
  // State / county data sources
  "floridarealtors.org", // FL Realtors trade group — data is fine to cite
  "myfloridacfo.com",
  "charlottecountyfl.gov",
  "puntagordafl.com", // city govt
]);

function rootDomain(host: string): string {
  // crude: take last two labels. Good enough for our blocklist patterns.
  const parts = host.toLowerCase().split(".");
  if (parts.length < 2) return host.toLowerCase();
  return parts.slice(-2).join(".");
}

/**
 * Returns true when the URL is acceptable for Ally to cite.
 *
 * Order matters:
 *  1. Any explicit ALLOWED_DOMAINS_EXACT match → allow (catches some
 *     gray-area domains that share a root with blocked ones).
 *  2. `.gov` / `.edu` suffix → allow.
 *  3. Known portal → allow.
 *  4. Known brokerage → BLOCK.
 *  5. Agent-page URL patterns on otherwise-unknown sites → BLOCK.
 *  6. Otherwise allow with a conservative "looks like an agent site"
 *     heuristic: if the domain contains "realestate", "realtor", or
 *     "homes" AND it's NOT in the portal list, treat as competitor.
 */
export function isAllowedSource(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const root = rootDomain(host);

    if (ALLOWED_DOMAINS_EXACT.has(host) || ALLOWED_DOMAINS_EXACT.has(root)) return true;
    if (ALLOWED_NEWS_OR_GOV_SUFFIXES.some((s) => host.endsWith(s))) return true;
    if (PORTAL_DOMAINS.has(root) || PORTAL_DOMAINS.has(host)) return true;
    if (BROKERAGE_DOMAINS.has(root) || BROKERAGE_DOMAINS.has(host)) return false;

    // Agent-page paths on non-portal, non-allowed domains
    if (/\/(agents?|our-team|meet-(the-)?team|about-(us|our-team))\b/i.test(u.pathname)) {
      return false;
    }

    // Heuristic: "realtor" / "realestate" / "homes" in domain → likely an
    // agent or brokerage site. We've already let the major portals through
    // above, so anything left here is almost certainly a competitor.
    if (/(^|\.)(realtor|realestate|homes(forsale|sale)?|sothebys|berkshire)/i.test(host)) {
      return false;
    }
    if (/team|group|partners|associates|properties|realty|brokerage/i.test(host)) {
      return false;
    }

    // Default to allow — better to let a news outlet through than to over-filter.
    return true;
  } catch {
    return false; // malformed URL → drop
  }
}

export const SOURCE_RULE_TEXT = `
SOURCE RULES — STRICT.

Permitted sources for stats and citations:
- Real-estate portals: Realtor.com, Zillow, Redfin, Trulia, Homes.com, Movoto, Estately, Homefinder
- News outlets: Reuters, AP, Bloomberg, WSJ, NYT, MarketWatch, CNBC, Yahoo Finance, local TV (WINK / NBC-2 / Fox 4), local papers (yoursun.com, Tampa Bay Times, Miami Herald)
- Industry data: NAR (nar.realtor), Freddie Mac, Fannie Mae, Florida Realtors (floridarealtors.org), Inman, HousingWire
- Government / institutional: any .gov or .edu domain (Charlotte County, City of Punta Gorda, etc.)
- THE TEAM'S OWN POSTS in the archive above

NEVER cite or link to:
- Other real estate agents, teams, or brokerages (Century 21, RE/MAX, KW, Coldwell Banker, Compass, eXp, Sotheby's, Douglas Elliman, etc. — and any individual agent / team site)
- Pages with /agent/, /agents/, /our-team/, /meet-the-team/ in the path on non-portal domains
- Domains that look like competitor brokerages or teams (e.g. *.realestate, *realty.com agent pages)

If a piece of data is ONLY available from a competitor site, OMIT it and note "data not available" — never quote it.
`;
