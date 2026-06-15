/**
 * Redfin listing scraper using the tri_angle/redfin-detail Apify actor.
 *
 * tri_angle/redfin-detail accepts { addresses: ["123 Main St, City, ST"] }
 * directly — it searches Redfin internally and returns the full structured
 * listing payload. No pageFunction, no proxy config, no fragile selectors.
 *
 * Confirmed working 2026-05-15 for "470 Sorrento Ct, Punta Gorda, FL 33950"
 * — returned price=$899,000, beds=3, baths=2, sqft=1823, full description,
 * listing agent.
 *
 * Output field paths (verified empirically):
 *   addressSectionInfo.priceInfo.amount                       → price
 *   addressSectionInfo.beds                                   → bedrooms
 *   addressSectionInfo.baths                                  → bathrooms
 *   addressSectionInfo.sqFt.value                             → sqft
 *   addressSectionInfo.streetAddress.assembledAddress +
 *     city/state/zip                                          → address
 *   addressSectionInfo.url (relative)                         → listingUrl
 *   mainHouseInfo.listingAgents[0].agentInfo.agentName        → agent
 *   mainHouseInfo.marketingRemarks[0].marketingRemark         → description
 *
 * Cost: tri_angle/redfin-detail is rented (already paid in Oliver's account).
 * We record 1¢ per call as a placeholder; reconcile against Apify invoice.
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

function decodeEntities(s: string): string {
  return s
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "");
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    return isNaN(n) || n <= 0 ? null : n;
  }
  return null;
}

/**
 * Scrape Redfin for a property by address using tri_angle/redfin-detail.
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
    const run = await client.actor("tri_angle/redfin-detail").call({ addresses: [address] });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const item = items[0] as Record<string, unknown> | undefined;

    if (!item) {
      await recordCostEvent({
        propertyId,
        stage: "scripting",
        provider: "apify",
        unitsConsumed: 1,
        unitType: "compute_units",
        costCents: 1,
        metadata: { source: "redfin", actor: "tri_angle/redfin-detail", address, result: "no_items" },
      }).catch((e) => console.error("[mls/scrape-redfin] cost_event insert failed:", e));
      return null;
    }

    const addrInfo = (item.addressSectionInfo ?? {}) as Record<string, unknown>;
    const mainInfo = (item.mainHouseInfo ?? {}) as Record<string, unknown>;
    const street = ((addrInfo.streetAddress as Record<string, unknown>)?.assembledAddress as string) ?? "";
    const city = (addrInfo.city as string) ?? "";
    const state = (addrInfo.state as string) ?? "";
    const zip = (addrInfo.zip as string) ?? "";
    const fullAddress = [street, [city, state].filter(Boolean).join(", "), zip].filter(Boolean).join(", ");

    const remarks = mainInfo.marketingRemarks as Array<{ marketingRemark?: string }> | undefined;
    const rawDesc = remarks?.[0]?.marketingRemark ?? null;
    const description = rawDesc ? decodeEntities(rawDesc).trim() : null;

    const agents = mainInfo.listingAgents as Array<{ agentInfo?: { agentName?: string } }> | undefined;
    const agent = agents?.[0]?.agentInfo?.agentName?.trim() || null;

    const relativeUrl = addrInfo.url as string | undefined;
    const listingUrl = relativeUrl ? `https://www.redfin.com${relativeUrl}` : null;

    result = {
      source: "redfin",
      address: fullAddress || address,
      price: toNum((addrInfo.priceInfo as Record<string, unknown>)?.amount),
      bedrooms: toNum(addrInfo.beds),
      bathrooms: toNum(addrInfo.baths),
      sqft: toNum((addrInfo.sqFt as Record<string, unknown>)?.value),
      agent,
      description,
      listingUrl,
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
      metadata: { source: "redfin", actor: "tri_angle/redfin-detail", address, error: errorMsg },
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
      actor: "tri_angle/redfin-detail",
      address,
      hasDescription: !!result?.description,
      hasAgent: !!result?.agent,
      listingUrl: result?.listingUrl,
    },
  }).catch((e) => console.error("[mls/scrape-redfin] cost_event insert failed:", e));

  return result;
}
