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
 * error on the run, and STILL advances to 'generating' so the pipeline
 * (kicked in parallel by StudioNew) is never gated on Redfin.
 * scrapeRedfinByAddress records its own apify cost_event.
 */
export async function runScrapeStage(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error(`runScrapeStage: run not found: ${runId}`);
  if (run.stage === 'intake') await advanceRun(runId, 'scraping');

  const { data: prop } = await getSupabase()
    .from('properties').select('address').eq('id', run.property_id).maybeSingle();

  try {
    const result = await scrapeRedfinByAddress(String(prop?.address ?? ''), run.property_id);
    await setListingDetails(runId, listingDetailsFromRedfin(result));
    if (!result) await setRunError(runId, 'Redfin scrape returned no listing — enter details manually.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await setRunError(runId, `Redfin scrape failed: ${msg} — enter details manually.`);
  }

  // Advance regardless of scrape outcome (resumable; details editable later).
  const after = await getRun(runId);
  if (after?.stage === 'scraping') await advanceRun(runId, 'generating');
}
