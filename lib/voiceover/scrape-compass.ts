/**
 * @deprecated Import from lib/compass/scrape-listing.ts instead.
 *
 * This file is kept as a re-export shim so that any existing import sites
 * continue to resolve without changes. The implementation moved to
 * lib/compass/scrape-listing.ts when the scraper was generalised beyond
 * voiceover (2026-05-15 — MLS auto-fill feature).
 */

export {
  scrapeCompassDescription,
  scrapeCompassListing,
  type ScrapeCompassResult,
} from "../compass/scrape-listing.js";
