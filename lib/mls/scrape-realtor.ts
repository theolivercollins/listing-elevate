/**
 * Realtor.com listing scraper using the epctex/realtor-scraper Apify actor.
 *
 * Used as fallback when Redfin returns no data. The actor handles anti-bot
 * protection automatically.
 *
 * Cost: ~$0.02/call → recorded as 2¢ in cost_events.
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
    const run = await client.actor("epctex/realtor-scraper").call(
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
      await recordCostEvent({
        propertyId,
        stage: "scripting",
        provider: "apify",
        unitsConsumed: 1,
        unitType: "compute_units",
        costCents: 2,
        metadata: { source: "realtor", address, result: "no_items" },
      }).catch((e) => console.error("[mls/scrape-realtor] cost_event insert failed:", e));
      return null;
    }

    result = {
      source: "realtor",
      address,
      price: toNum(first.price ?? first.listingPrice ?? first.list_price),
      bedrooms: toNum(first.bedrooms ?? first.beds),
      bathrooms: toNum(first.bathrooms ?? first.baths ?? first.full_baths),
      sqft: toNum(first.sqft ?? first.squareFootage ?? first.living_area ?? first.lot_sqft),
      agent:
        toStr(first.agent ?? first.listingAgent ?? first.agent_name) ??
        toStr(
          (first.agents as Record<string, unknown>[] | undefined)?.[0]?.name,
        ),
      description: toStr(
        first.description ?? first.remarks ?? first.text,
      ),
      listingUrl: toStr(first.url ?? first.listingUrl ?? first.permalink ?? first.link),
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
      metadata: { source: "realtor", address, error: errorMsg },
    }).catch((e) => console.error("[mls/scrape-realtor] cost_event insert failed:", e));

    throw new Error(`Realtor.com scrape failed: ${errorMsg}`);
  }

  await recordCostEvent({
    propertyId,
    stage: "scripting",
    provider: "apify",
    unitsConsumed: 1,
    unitType: "compute_units",
    costCents: 2,
    metadata: {
      source: "realtor",
      address,
      hasDescription: !!result?.description,
      listingUrl: result?.listingUrl,
    },
  }).catch((e) => console.error("[mls/scrape-realtor] cost_event insert failed:", e));

  return result;
}
