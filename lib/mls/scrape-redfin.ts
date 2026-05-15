/**
 * Redfin listing scraper using the epctex/redfin-scraper Apify actor.
 *
 * The actor handles anti-bot / Cloudflare automatically. We pass the address
 * as a search query with maxItems: 1 to get the first matching listing.
 *
 * Cost: ~$0.02/call → recorded as 2¢ in cost_events.
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
    const run = await client.actor("epctex/redfin-scraper").call(
      {
        search: address,
        maxItems: 1,
        endPage: 1,
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
        costCents: 2,
        metadata: { source: "redfin", address, result: "no_items" },
      }).catch((e) => console.error("[mls/scrape-redfin] cost_event insert failed:", e));
      return null;
    }

    result = {
      source: "redfin",
      address,
      price: toNum(first.price ?? first.listingPrice),
      bedrooms: toNum(first.bedrooms ?? first.beds),
      bathrooms: toNum(first.bathrooms ?? first.baths),
      sqft: toNum(first.sqft ?? first.squareFootage ?? first.livingArea),
      agent: toStr(first.agent ?? first.listingAgent ?? first.agentName),
      description: toStr(first.description ?? first.remarks ?? first.listingDescription),
      listingUrl: toStr(first.url ?? first.listingUrl ?? first.link),
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
      metadata: { source: "redfin", address, error: errorMsg },
    }).catch((e) => console.error("[mls/scrape-redfin] cost_event insert failed:", e));

    throw new Error(`Redfin scrape failed: ${errorMsg}`);
  }

  await recordCostEvent({
    propertyId,
    stage: "scripting",
    provider: "apify",
    unitsConsumed: 1,
    unitType: "compute_units",
    costCents: 2,
    metadata: {
      source: "redfin",
      address,
      hasDescription: !!result?.description,
      listingUrl: result?.listingUrl,
    },
  }).catch((e) => console.error("[mls/scrape-redfin] cost_event insert failed:", e));

  return result;
}
