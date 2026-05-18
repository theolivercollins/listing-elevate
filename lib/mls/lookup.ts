/**
 * MLS address lookup chain: Redfin first, Realtor.com fallback.
 *
 * "Meaningful data" = at least one of: price, bedrooms, description is non-null.
 * If both scrapers return no meaningful data, throws so the caller can surface
 * a user-facing error.
 */

import { scrapeRedfinByAddress, type RedfinScrapeResult } from "./scrape-redfin.js";
import { scrapeRealtorByAddress, type RealtorScrapeResult } from "./scrape-realtor.js";

export type MlsLookupResult = RedfinScrapeResult | RealtorScrapeResult;

// Sentinel thrown when the upstream scraper provider isn't configured. The
// API endpoint catches this and returns a clean 503 with a fill-in-manually
// hint instead of leaking the env-var name to the customer.
export class MlsProviderUnconfiguredError extends Error {
  constructor() {
    super("MLS provider not configured");
    this.name = "MlsProviderUnconfiguredError";
  }
}

function hasMeaningfulData(result: MlsLookupResult | null): boolean {
  if (!result) return false;
  return result.price !== null || result.bedrooms !== null || result.description !== null;
}

/**
 * Look up MLS data for an address.
 * Tries Redfin first; falls back to Realtor.com if no meaningful data.
 * Throws if BOTH sources fail to return meaningful data.
 *
 * @param address    Full street address (e.g. "123 Main St, Austin, TX 78701")
 * @param propertyId Owning property UUID; pass null for pre-order lookups.
 */
export async function lookupMlsByAddress(
  address: string,
  propertyId: string | null,
): Promise<MlsLookupResult> {
  // Fail fast + cleanly if the underlying scraper provider isn't configured.
  // Both scrapers use the same Apify token; checking once here avoids two
  // identical 500s and lets the API layer return a friendly 503.
  if (!process.env.APIFY_API_TOKEN) {
    console.error("[mls/lookup] APIFY_API_TOKEN env var not set — MLS auto-fill disabled");
    throw new MlsProviderUnconfiguredError();
  }

  let redfinError: Error | undefined;
  let realtorError: Error | undefined;

  // ── Attempt 1: Redfin ──
  try {
    const redfinResult = await scrapeRedfinByAddress(address, propertyId);
    if (hasMeaningfulData(redfinResult)) {
      return redfinResult!;
    }
    console.info("[mls/lookup] Redfin returned no meaningful data, trying Realtor.com");
  } catch (err) {
    redfinError = err instanceof Error ? err : new Error(String(err));
    console.warn("[mls/lookup] Redfin failed:", redfinError.message, "— trying Realtor.com");
  }

  // ── Attempt 2: Realtor.com ──
  try {
    const realtorResult = await scrapeRealtorByAddress(address, propertyId);
    if (hasMeaningfulData(realtorResult)) {
      return realtorResult!;
    }
    console.info("[mls/lookup] Realtor.com also returned no meaningful data");
  } catch (err) {
    realtorError = err instanceof Error ? err : new Error(String(err));
    console.warn("[mls/lookup] Realtor.com failed:", realtorError.message);
  }

  // Both sources failed
  const details = [
    redfinError ? `Redfin: ${redfinError.message}` : "Redfin: no results",
    realtorError ? `Realtor.com: ${realtorError.message}` : "Realtor.com: no results",
  ].join("; ");

  throw new Error(`MLS lookup failed for "${address}": ${details}`);
}
