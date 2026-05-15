/**
 * Compass listing scraper using the Apify platform.
 *
 * Compass is a React SPA that requires JavaScript execution. We use the
 * apify/web-scraper actor (Puppeteer-backed) so the full page renders before
 * we query the DOM. The actor costs ~$0.005/page; we round up to 1¢.
 *
 * Selector notes (2026-05):
 *   - Address:     h1[data-tn="listing-address"], h1.listing-address, h1
 *   - Price:       [data-tn="home-price"], .listing-price, [class*="Price"]
 *   - Bedrooms:    [data-tn="bedrooms"], [class*="bedrooms"]
 *   - Bathrooms:   [data-tn="bathrooms"], [class*="bathrooms"]
 *   - Description: [data-tn="listing-detail-description"], .listing-description-text, [class*="description"]
 *   - Agent:       [data-tn="listing-agent-name"], [class*="agent-name"]
 * Compass changes selectors frequently. Update if needed.
 */

import { ApifyClient } from "apify-client";
import { recordCostEvent } from "../db.js";

export interface ScrapeCompassResult {
  description: string;
  address?: string;
  priceText?: string;
  price?: number;
  bedrooms?: number;
  bathrooms?: number;
  agent?: string;
}

/**
 * Scrape property details from a Compass listing page.
 *
 * @param url          Full Compass listing URL (https://www.compass.com/listing/...)
 * @param propertyId   Owning property UUID — attached to the cost_event row.
 */
export async function scrapeCompassListing(
  url: string,
  propertyId: string | null,
): Promise<ScrapeCompassResult> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN env var is not set");

  const client = new ApifyClient({ token });

  const pageFunction = `
async function pageFunction(context) {
  const grab = (selectors) => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    }
    return null;
  };

  const description = grab([
    '[data-tn="listing-detail-description"]',
    '.listing-description-text',
    '.listing-details__description',
    '[class*="description"]',
  ]) || (() => {
    const paragraphs = Array.from(document.querySelectorAll('p'))
      .map(p => p.textContent?.trim() ?? '')
      .filter(t => t.length > 100);
    return paragraphs.length ? paragraphs[0] : '';
  })();

  return {
    address: grab(['h1[data-tn="listing-address"]', 'h1.listing-address', 'h1']),
    priceText: grab(['[data-tn="home-price"]', '.listing-price', '[class*="Price"]']),
    bedrooms: grab(['[data-tn="bedrooms"]', '[class*="bedrooms"]']),
    bathrooms: grab(['[data-tn="bathrooms"]', '[class*="bathrooms"]']),
    description,
    agent: grab(['[data-tn="listing-agent-name"]', '[class*="agent-name"]']),
  };
}
`;

  let result: ScrapeCompassResult = { description: "" };
  let errorMsg: string | undefined;

  try {
    const run = await client.actor("apify/web-scraper").call(
      {
        startUrls: [{ url }],
        pageFunction,
        maxRequestsPerCrawl: 1,
        navigationTimeoutSecs: 60,
        maxConcurrency: 1,
      },
      { waitSecs: 60 },
    );

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const first = items[0] as Record<string, unknown> | undefined;

    const description = typeof first?.description === "string" ? first.description.trim() : "";
    if (!description) {
      throw new Error("Scrape returned empty description — selector may be stale");
    }

    // Parse price: strip "$", ",", whitespace → number
    let price: number | undefined;
    const priceText = typeof first?.priceText === "string" ? first.priceText.trim() : undefined;
    if (priceText) {
      const numeric = priceText.replace(/[$,\s]/g, "");
      const parsed = Number(numeric);
      if (!isNaN(parsed) && parsed > 0) price = parsed;
    }

    // Parse bedrooms/bathrooms: strip non-numeric except "."
    const parseDim = (raw: unknown): number | undefined => {
      if (typeof raw !== "string") return undefined;
      const n = Number(raw.replace(/[^\d.]/g, ""));
      return isNaN(n) || n <= 0 ? undefined : n;
    };

    result = {
      description,
      address: typeof first?.address === "string" ? first.address.trim() || undefined : undefined,
      priceText,
      price,
      bedrooms: parseDim(first?.bedrooms),
      bathrooms: parseDim(first?.bathrooms),
      agent: typeof first?.agent === "string" ? first.agent.trim() || undefined : undefined,
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
      metadata: { url, error: errorMsg },
    }).catch((e) => console.error("[compass/scrape] cost_event insert failed:", e));

    throw new Error(`Compass scrape failed: ${errorMsg}`);
  }

  // Success — record 1¢ cost event.
  await recordCostEvent({
    propertyId,
    stage: "scripting",
    provider: "apify",
    unitsConsumed: 1,
    unitType: "compute_units",
    costCents: 1,
    metadata: { url, descriptionLength: result.description.length },
  }).catch((e) => console.error("[compass/scrape] cost_event insert failed:", e));

  return result;
}

// ---------------------------------------------------------------------------
// Backward-compat shim — voiceover pipeline imports scrapeCompassDescription
// from this module (after the import-site update in scrape-compass.ts shim).
// ---------------------------------------------------------------------------
export async function scrapeCompassDescription(
  url: string,
  propertyId: string | null,
): Promise<{ description: string }> {
  const r = await scrapeCompassListing(url, propertyId);
  return { description: r.description };
}
