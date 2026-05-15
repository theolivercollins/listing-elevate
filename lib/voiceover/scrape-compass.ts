/**
 * Compass listing scraper using the Apify platform.
 *
 * Compass is a React SPA that requires JavaScript execution. We use the
 * apify/web-scraper actor (Puppeteer-backed) so the full page renders before
 * we query the DOM. The actor costs ~$0.005/page; we round up to 1¢.
 *
 * Selector notes (2026-05):
 *   - Primary:   [data-tn="listing-detail-description"]
 *   - Fallback:  .listing-description-text, .listing-details__description
 * Compass changes selectors frequently. Update COMPASS_SELECTORS if needed.
 */

import { ApifyClient } from "apify-client";
import { recordCostEvent } from "../db.js";

/** Ordered list of CSS selectors to try for the listing description text. */
const COMPASS_SELECTORS = [
  '[data-tn="listing-detail-description"]',
  '.listing-description-text',
  '.listing-details__description',
  '[class*="description"]',
] as const;

export interface ScrapeCompassResult {
  description: string;
}

/**
 * Scrape the property description from a Compass listing page.
 *
 * @param url          Full Compass listing URL (https://www.compass.com/listing/...)
 * @param propertyId   Owning property UUID — attached to the cost_event row.
 */
export async function scrapeCompassDescription(
  url: string,
  propertyId: string | null,
): Promise<ScrapeCompassResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN env var is not set");

  const client = new ApifyClient({ token });

  // Build the page function as a string — Apify runs it inside a browser context.
  // It tries each selector in order and returns the first non-empty result.
  const pageFunction = `
async function pageFunction(context) {
  const { page } = context;
  const selectors = ${JSON.stringify([...COMPASS_SELECTORS])};
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent && el.textContent.trim()) {
      return { description: el.textContent.trim() };
    }
  }
  // Last-resort: grab any large block of text on the page
  const paragraphs = Array.from(document.querySelectorAll('p'))
    .map(p => p.textContent?.trim() ?? '')
    .filter(t => t.length > 100);
  if (paragraphs.length) {
    return { description: paragraphs[0] };
  }
  return { description: '' };
}
`;

  let description = "";
  let errorMsg: string | undefined;

  try {
    const run = await client.actor("apify/web-scraper").call(
      {
        startUrls: [{ url }],
        pageFunction,
        maxRequestsPerCrawl: 1,
        navigationTimeout: 60,
        maxConcurrency: 1,
      },
      { waitForFinish: 60 }, // seconds
    );

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const first = items[0] as Record<string, unknown> | undefined;
    description = typeof first?.description === "string" ? first.description.trim() : "";

    if (!description) {
      throw new Error("Scrape returned empty description — selector may be stale");
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);

    // Record $0 cost event even on failure so we have an audit trail.
    await recordCostEvent({
      propertyId,
      stage: "scripting",
      provider: "apify",
      unitsConsumed: 1,
      unitType: "compute_units",
      costCents: 0,
      metadata: { url, error: errorMsg },
    }).catch((e) => console.error("[voiceover/scrape] cost_event insert failed:", e));

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
    metadata: { url, descriptionLength: description.length },
  }).catch((e) => console.error("[voiceover/scrape] cost_event insert failed:", e));

  return { description };
}
