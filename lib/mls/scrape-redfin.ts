/**
 * Redfin listing scraper using the free first-party apify/web-scraper actor.
 *
 * The epctex/redfin-scraper actor requires a paid rental (x402) — this
 * replacement uses apify/web-scraper (Puppeteer, compute-only billing) with
 * RESIDENTIAL proxy group to bypass Redfin CloudFront blocking.
 *
 * Cost: ~1¢/call (compute-only, no rental fee).
 */

import { ApifyClient } from "apify-client";
import { recordCostEvent } from "../db.js";

export interface RedfinScrapeResult {
  source: "redfin";
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
// It navigates from a Redfin search-results page to the first listing detail
// page and extracts structured data via data-rf-test-id selectors.
const REDFIN_PAGE_FUNCTION = /* js */ `
async function pageFunction(context) {
  const { page, request, log } = context;
  log.info('Loaded: ' + request.loadedUrl);

  // Step 1: if we landed on a search results page, jump to the first listing.
  const isAlreadyDetail = (request.loadedUrl || '').includes('/home/');

  if (!isAlreadyDetail) {
    await new Promise(r => setTimeout(r, 1500));

    const detailHref = await page.evaluate(() => {
      const candidates = [
        'a.HomeCardContainer__link',
        'a[data-rf-test-id="basicNode-homeCard"]',
        'a[href*="/home/"]',
        'a.bp-Homecard',
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
  await page.waitForSelector('[data-rf-test-id="abp-price"], .statsValue, h1', { timeout: 15000 }).catch(() => {});

  const data = await page.evaluate(() => {
    const grab = (selectors) => {
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
      }
      return null;
    };
    return {
      addressText: grab([
        '[data-rf-test-id="abp-streetLine"]',
        'h1[data-rf-test-id="address"]',
        'h1',
      ]),
      priceText: grab([
        '[data-rf-test-id="abp-price"] .statsValue',
        '[data-rf-test-id="abp-price"]',
        'div[class*="Price"]',
      ]),
      bedsText: grab([
        '[data-rf-test-id="abp-beds"] .statsValue',
        '[data-rf-test-id="abp-beds"]',
      ]),
      bathsText: grab([
        '[data-rf-test-id="abp-baths"] .statsValue',
        '[data-rf-test-id="abp-baths"]',
      ]),
      sqftText: grab([
        '[data-rf-test-id="abp-sqFt"] .statsValue',
        '[data-rf-test-id="abp-sqFt"]',
      ]),
      descriptionText: grab([
        '[data-rf-test-id="listingRemarks"]',
        '[data-rf-test-id="listing-description"]',
        '#marketing-remarks',
        '.remarks',
      ]),
      agentText: grab([
        '[data-rf-test-id="agent-info-name"]',
        '[data-rf-test-id="listingAgent-name"]',
        '.agent-name',
      ]),
      url: location.href,
    };
  });

  return data;
}
`;

/**
 * Scrape Redfin for a property by address.
 *
 * @param address    Full street address, city, state (e.g. "123 Main St, Austin, TX")
 * @param propertyId Owning property UUID for cost_events; pass null for pre-order calls.
 */
export async function scrapeRedfinByAddress(
  address: string,
  propertyId: string | null,
): Promise<RedfinScrapeResult | null> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN env var is not set");

  const client = new ApifyClient({ token });

  let result: RedfinScrapeResult | null = null;
  let errorMsg: string | undefined;

  try {
    const run = await client.actor("apify/web-scraper").call(
      {
        startUrls: [
          {
            url: `https://www.redfin.com/?location=${encodeURIComponent(address)}`,
          },
        ],
        pageFunction: REDFIN_PAGE_FUNCTION,
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
      // Actor ran but no results — not a hard error; caller treats as no-data
      await recordCostEvent({
        propertyId,
        stage: "scripting",
        provider: "apify",
        unitsConsumed: 1,
        unitType: "compute_units",
        costCents: 1,
        metadata: { source: "redfin", actor: "apify/web-scraper", address, result: "no_items" },
      }).catch((e) => console.error("[mls/scrape-redfin] cost_event insert failed:", e));
      return null;
    }

    result = {
      source: "redfin",
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
      metadata: { source: "redfin", actor: "apify/web-scraper", address, error: errorMsg },
    }).catch((e) => console.error("[mls/scrape-redfin] cost_event insert failed:", e));

    throw new Error(`Redfin scrape failed: ${errorMsg}`);
  }

  await recordCostEvent({
    propertyId,
    stage: "scripting",
    provider: "apify",
    unitsConsumed: 1,
    unitType: "compute_units",
    costCents: 1,
    metadata: {
      source: "redfin",
      actor: "apify/web-scraper",
      address,
      hasDescription: !!result?.description,
      listingUrl: result?.listingUrl,
    },
  }).catch((e) => console.error("[mls/scrape-redfin] cost_event insert failed:", e));

  return result;
}
