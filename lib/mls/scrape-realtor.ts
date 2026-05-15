/**
 * Realtor.com listing scraper using the free first-party apify/web-scraper actor.
 *
 * The epctex/realtor-scraper actor requires a paid rental (x402) — this
 * replacement uses apify/web-scraper (Puppeteer, compute-only billing) with
 * RESIDENTIAL proxy group to bypass CloudFront blocking.
 *
 * Used as fallback when Redfin returns no data.
 * Cost: ~1¢/call (compute-only, no rental fee).
 */

import { ApifyClient } from "apify-client";
import { recordCostEvent } from "../db.js";

export interface RealtorScrapeResult {
  source: "realtor";
  address: string;
  price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  agent: string | null;
  description: string | null;
  listingUrl: string | null;
}

function toNum(val: unknown): number | null {
  if (val == null) return null;
  const n = Number(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) || n <= 0 ? null : n;
}

function toStr(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const s = val.trim();
  return s.length > 0 ? s : null;
}

// pageFunction is passed as a string to apify/web-scraper.
// It navigates from a Realtor.com search-results page to the first listing
// detail page and extracts structured data via data-testid selectors.
const REALTOR_PAGE_FUNCTION = /* js */ `
async function pageFunction(context) {
  const { page, request, log } = context;
  log.info('Loaded: ' + request.loadedUrl);

  // Step 1: if we landed on a search results page, jump to the first listing.
  const isAlreadyDetail = (request.loadedUrl || '').includes('/realestateandhomes-detail/');

  if (!isAlreadyDetail) {
    await new Promise(r => setTimeout(r, 1500));

    const detailHref = await page.evaluate(() => {
      const candidates = [
        'a[href*="/realestateandhomes-detail/"]',
        'a[data-testid="card-anchor"]',
        'a.property-anchor',
      ];
      for (const sel of candidates) {
        const a = document.querySelector(sel);
        if (a && a.href) return a.href;
      }
      return null;
    });

    if (detailHref) {
      await page.goto(detailHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
  }

  // Step 2: extract from detail page.
  await page.waitForSelector('[data-testid="price"], [data-label="property-price"], h1', { timeout: 15000 }).catch(() => {});

  const data = await page.evaluate(() => {
    const grab = (selectors) => {
      for (const s of selectors) {
        let el;
        try { el = document.querySelector(s); } catch (e) { continue; }
        if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
      }
      return null;
    };
    return {
      addressText: grab([
        '[data-testid="address"]',
        'h1[data-testid="pdp-main-header"]',
        'h1',
      ]),
      priceText: grab([
        '[data-testid="price"]',
        '[data-label="property-price"]',
        '.price',
        '[class*="Price"]',
      ]),
      bedsText: grab([
        '[data-testid="property-meta-beds"]',
        '[data-label="property-meta-beds"]',
        'li[data-testid="beds"]',
      ]),
      bathsText: grab([
        '[data-testid="property-meta-baths"]',
        '[data-label="property-meta-baths"]',
        'li[data-testid="baths"]',
      ]),
      sqftText: grab([
        '[data-testid="property-meta-sqft"]',
        '[data-label="property-meta-sqft"]',
        'li[data-testid="sqft"]',
      ]),
      descriptionText: grab([
        '[data-testid="description"]',
        '#ldp-detail-overview',
        '[data-label="property-description"]',
        '.description',
      ]),
      agentText: grab([
        '[data-testid="agent-name"]',
        '.agent-name',
        '[data-label="agent-name"]',
      ]),
      url: location.href,
    };
  });

  return data;
}
`;

/**
 * Scrape Realtor.com for a property by address.
 *
 * @param address    Full street address, city, state (e.g. "123 Main St, Austin, TX")
 * @param propertyId Owning property UUID for cost_events; pass null for pre-order calls.
 */
export async function scrapeRealtorByAddress(
  address: string,
  propertyId: string | null,
): Promise<RealtorScrapeResult | null> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN env var is not set");

  const client = new ApifyClient({ token });

  let result: RealtorScrapeResult | null = null;
  let errorMsg: string | undefined;

  try {
    const run = await client.actor("apify/web-scraper").call(
      {
        startUrls: [
          {
            url: `https://www.realtor.com/realestateandhomes-search?location=${encodeURIComponent(address)}`,
          },
        ],
        pageFunction: REALTOR_PAGE_FUNCTION,
        proxyConfiguration: {
          useApifyProxy: true,
          apifyProxyGroups: ["RESIDENTIAL"],
        },
        maxRequestsPerCrawl: 2,
        maxPagesPerCrawl: 2,
        pageLoadTimeoutSecs: 60,
        maxScrollHeightPixels: 0,
        initialCookies: [],
        preNavigationHooks: `[
          async ({ page }) => {
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
          }
        ]`,
      },
      { waitSecs: 120 },
    );

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const first = items[0] as Record<string, unknown> | undefined;

    if (!first) {
      await recordCostEvent({
        propertyId,
        stage: "scripting",
        provider: "apify",
        unitsConsumed: 1,
        unitType: "compute_units",
        costCents: 1,
        metadata: { source: "realtor", actor: "apify/web-scraper", address, result: "no_items" },
      }).catch((e) => console.error("[mls/scrape-realtor] cost_event insert failed:", e));
      return null;
    }

    result = {
      source: "realtor",
      address,
      price: toNum(first.priceText),
      bedrooms: toNum(first.bedsText),
      bathrooms: toNum(first.bathsText),
      sqft: toNum(first.sqftText),
      agent: toStr(first.agentText),
      description: toStr(first.descriptionText),
      listingUrl: toStr(first.url),
    };
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);

    await recordCostEvent({
      propertyId,
      stage: "scripting",
      provider: "apify",
      unitsConsumed: 1,
      unitType: "compute_units",
      costCents: 0,
      metadata: { source: "realtor", actor: "apify/web-scraper", address, error: errorMsg },
    }).catch((e) => console.error("[mls/scrape-realtor] cost_event insert failed:", e));

    throw new Error(`Realtor.com scrape failed: ${errorMsg}`);
  }

  await recordCostEvent({
    propertyId,
    stage: "scripting",
    provider: "apify",
    unitsConsumed: 1,
    unitType: "compute_units",
    costCents: 1,
    metadata: {
      source: "realtor",
      actor: "apify/web-scraper",
      address,
      hasDescription: !!result?.description,
      listingUrl: result?.listingUrl,
    },
  }).catch((e) => console.error("[mls/scrape-realtor] cost_event insert failed:", e));

  return result;
}
