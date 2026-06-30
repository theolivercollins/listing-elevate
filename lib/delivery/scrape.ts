import { scrapeRedfinByAddress, type RedfinScrapeResult } from '../mls/scrape-redfin.js';
import { getRun, setListingDetails, setRunError, advanceRun } from './runs.js';
import { getSupabase } from '../client.js';
import type { ListingDetails } from '../types/operator-studio.js';

export function listingDetailsFromRedfin(r: RedfinScrapeResult | null): ListingDetails {
  if (!r) return { source: 'scraped' };
  return {
    price: r.price ?? undefined,
    beds: r.bedrooms ?? undefined,
    baths: r.bathrooms ?? undefined,
    sqft: r.sqft ?? undefined,
    mls_description: r.description ?? undefined,
    source: 'scraped',
  };
}

/**
 * Stage side effect for 'scraping'. Never a blocker: a miss or error leaves
 * listing_details empty (amber manual-entry state in the UI), notes the
 * error on the run. The pipeline analysis stage advances to 'photo_selection'
 * once Gemini has actually selected photos, so operators never see an empty
 * photo checkpoint just because the scrape finished first.
 * scrapeRedfinByAddress records its own apify cost_event.
 *
 * NOTE (Task 16): The details UI keys off empty listing_details for the amber
 * manual-entry state; run.error is supplementary operator visibility only.
 * setRunError MUST be called AFTER advanceRun — advanceRun's CAS update sets
 * error:null, which would wipe any error message written before it.
 */
export async function runScrapeStage(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`runScrapeStage: run not found: ${runId}`);
  if (run.stage === 'intake') await advanceRun(runId, 'scraping');

  const { data: prop } = await getSupabase()
    .from('properties').select('address, bedrooms, bathrooms, price').eq('id', run.property_id).maybeSingle();

  // Drive-pull skip: when the pre-fill step already populated all three of
  // beds/baths/price, skip the Apify/Redfin scrape to avoid a double-charge.
  // Trade-off: mls_description is not fetched on this path; the operator sees
  // the prefill values immediately. This also applies to any non-Drive order
  // where an operator manually entered all three fields before submission —
  // that is intentional and acceptable (same skip condition).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- prop is untyped from the generic SupabaseClient
  const p = prop as any;
  if (p?.bedrooms != null && p?.bathrooms != null && p?.price != null) {
    await setListingDetails(runId, {
      price: p.price as number,
      beds: p.bedrooms as number,
      baths: p.bathrooms as number,
      sqft: undefined,
      mls_description: undefined,
      source: 'prefill',
    });
    return;
  }

  // Capture scrape result/error before advancing — write the error AFTER advance
  // so advanceRun's error:null CAS reset doesn't clobber the message.
  let scrapeError: string | null = null;
  try {
    const result = await scrapeRedfinByAddress(String(p?.address ?? ''), run.property_id);
    await setListingDetails(runId, listingDetailsFromRedfin(result));
    if (!result) scrapeError = 'Redfin scrape returned no listing — enter details manually.';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    scrapeError = `Redfin scrape failed: ${msg} — enter details manually.`;
  }

  // If intake was advanced to scraping above, write this after that CAS update
  // so advanceRun's error:null reset does not clobber the scrape message.
  if (scrapeError) await setRunError(runId, scrapeError);
}
