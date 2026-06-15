import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { listingDetailsFromRedfin } from './scrape';

describe('listingDetailsFromRedfin', () => {
  it('maps a Redfin result to listing_details with source=scraped', () => {
    expect(listingDetailsFromRedfin({
      source: 'redfin', address: '470 Sorrento Ct, Punta Gorda, FL, 33950',
      price: 899000, bedrooms: 3, bathrooms: 2, sqft: 1823,
      agent: 'A. Gent', description: 'Waterfront pool home.', listingUrl: 'https://www.redfin.com/x',
    })).toEqual({
      price: 899000, beds: 3, baths: 2, sqft: 1823,
      mls_description: 'Waterfront pool home.', source: 'scraped',
    });
  });

  it('null result maps to empty details (manual-entry state)', () => {
    expect(listingDetailsFromRedfin(null)).toEqual({ source: 'scraped' });
  });
});

// ─── runScrapeStage mocked-flow tests ─────────────────────────────────────────
//
// We mock at module boundary so the unit under test uses injected fakes,
// keeping the test free of any Supabase/Apify I/O.

const mockGetRun = vi.fn();
const mockAdvanceRun = vi.fn();
const mockSetRunError = vi.fn();
const mockSetListingDetails = vi.fn();
const mockScrapeRedfin = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock('./runs', () => ({
  getRun: (...a: unknown[]) => mockGetRun(...a),
  advanceRun: (...a: unknown[]) => mockAdvanceRun(...a),
  setRunError: (...a: unknown[]) => mockSetRunError(...a),
  setListingDetails: (...a: unknown[]) => mockSetListingDetails(...a),
}));

vi.mock('../mls/scrape-redfin', () => ({
  scrapeRedfinByAddress: (...a: unknown[]) => mockScrapeRedfin(...a),
}));

// Supabase stub: returns a property row with a dummy address.
vi.mock('../client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

// Dynamic import so the vi.mock calls above are hoisted first.
const { runScrapeStage } = await import('./scrape');

const RUN_ID = 'run-abc';
const PROP_ID = 'prop-xyz';

/** Build a minimal fake run. */
function fakeRun(stage: string) {
  return { id: RUN_ID, property_id: PROP_ID, stage } as {
    id: string; property_id: string; stage: string;
  };
}

/** Supabase chain stub: from().select().eq().maybeSingle() → { data, error } */
function stubSupabase(address = '123 Main St') {
  const chain = { data: { address }, error: null };
  const eq = () => ({ maybeSingle: () => Promise.resolve(chain) });
  const select = () => ({ eq });
  const from = () => ({ select });
  mockGetSupabase.mockReturnValue({ from });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: advance resolves immediately with the advanced run.
  mockAdvanceRun.mockResolvedValue(fakeRun('scraping'));
  mockSetRunError.mockResolvedValue(fakeRun('scraping'));
  mockSetListingDetails.mockResolvedValue(fakeRun('scraping'));
  stubSupabase();
});

describe('runScrapeStage', () => {
  it('scrape miss at scraping stage -> saves manual-entry error without advancing to photo_selection', async () => {
    // Arrange: run is in 'scraping' (advance already happened), scrape returns null (miss).
    const calls: string[] = [];
    mockGetRun.mockResolvedValueOnce(fakeRun('scraping'));
    mockScrapeRedfin.mockResolvedValue(null); // miss
    mockAdvanceRun.mockImplementation(async () => { calls.push('advance'); return fakeRun('scraping'); });
    mockSetRunError.mockImplementation(async () => { calls.push('setRunError'); return fakeRun('scraping'); });

    await runScrapeStage(RUN_ID);

    expect(calls).toEqual(['setRunError']);
    expect(mockAdvanceRun).not.toHaveBeenCalled();
    // listing_details written with source 'scraped' even on miss
    expect(mockSetListingDetails).toHaveBeenCalledWith(RUN_ID, { source: 'scraped' });
    // error message mentions manual entry
    expect(mockSetRunError).toHaveBeenCalledWith(
      RUN_ID,
      expect.stringContaining('manually'),
    );
  });

  it('scrapeRedfinByAddress throws at scraping stage -> stores error without advancing to photo_selection', async () => {
    const calls: string[] = [];
    mockGetRun.mockResolvedValueOnce(fakeRun('scraping'));
    mockScrapeRedfin.mockRejectedValue(new Error('network timeout'));
    mockAdvanceRun.mockImplementation(async () => { calls.push('advance'); return fakeRun('scraping'); });
    mockSetRunError.mockImplementation(async () => { calls.push('setRunError'); return fakeRun('scraping'); });

    await runScrapeStage(RUN_ID);

    expect(calls).toEqual(['setRunError']);
    expect(mockAdvanceRun).not.toHaveBeenCalled();
    expect(mockSetRunError).toHaveBeenCalledWith(
      RUN_ID,
      expect.stringContaining('network timeout'),
    );
    // No listing_details written on throw (scrape never resolved)
    expect(mockSetListingDetails).not.toHaveBeenCalled();
  });

  it('run already past intake (stage=generating) → no advance calls, no crash', async () => {
    // The guard blocks intake->scraping advance when already past intake.
    mockGetRun
      .mockResolvedValueOnce(fakeRun('generating')) // initial: skip intake→scraping advance
      .mockResolvedValueOnce(fakeRun('generating'));
    mockScrapeRedfin.mockResolvedValue({ price: 500000, bedrooms: 3, bathrooms: 2, sqft: 1500, description: 'Nice', listingUrl: 'http://x', agent: 'B', source: 'redfin', address: '1 A St' });

    await expect(runScrapeStage(RUN_ID)).resolves.toBeUndefined();

    expect(mockAdvanceRun).not.toHaveBeenCalled();
    expect(mockSetRunError).not.toHaveBeenCalled();
  });
});
