import { describe, it, expect } from 'vitest';
import { validateListingDetails } from './details';

it('accepts a full valid payload', () => {
  const r = validateListingDetails({ price: 899000, beds: 3, baths: 2.5, sqft: 1823, mls_description: 'Nice.' });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.details).toEqual({ price: 899000, beds: 3, baths: 2.5, sqft: 1823, mls_description: 'Nice.', source: 'manual' });
});
it('accepts partial payloads (nulls allowed — never a blocker)', () => {
  const r = validateListingDetails({ price: null, beds: null, baths: null, sqft: null, mls_description: null });
  expect(r.ok).toBe(true);
});
it('rejects negative numbers and non-numeric strings', () => {
  expect(validateListingDetails({ price: -5 }).ok).toBe(false);
  expect(validateListingDetails({ beds: 'three' as unknown as number }).ok).toBe(false);
});

// ─── Integration: full-field-set submission guarantee ─────────────────────────
//
// The PATCH endpoint REPLACES the whole listing_details jsonb column — a partial
// payload would silently null scraped fields.  DeliveryDetails always submits the
// full 5-field set pre-filled from run.listing_details.  This test simulates that
// path using the REAL validator (not mocked) to prove unedited scraped fields are
// preserved when one field is changed.
describe('full-field-set preservation (integration — real validator)', () => {
  it('editing one field preserves all scraped fields in the output', () => {
    // Simulate scraped values stored in run.listing_details
    const scrapedDetails = {
      price: 750000,
      beds: 4,
      baths: 3,
      sqft: 2200,
      mls_description: 'Beautiful lakefront home.',
      source: 'scraped' as const,
    };

    // Operator changes only the price; all other fields are re-submitted from
    // the pre-filled form state (simulating DeliveryDetails always including the
    // full field set in the PATCH payload).
    const formPayload = {
      price: 799000,               // edited
      beds: scrapedDetails.beds,   // pre-filled, unchanged
      baths: scrapedDetails.baths, // pre-filled, unchanged
      sqft: scrapedDetails.sqft,   // pre-filled, unchanged
      mls_description: scrapedDetails.mls_description, // pre-filled, unchanged
    };

    const r = validateListingDetails(formPayload);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // The validator emits all 5 data fields + source:'manual'
    expect(r.details.price).toBe(799000);     // operator edit survived
    expect(r.details.beds).toBe(4);           // scraped value preserved
    expect(r.details.baths).toBe(3);          // scraped value preserved
    expect(r.details.sqft).toBe(2200);        // scraped value preserved
    expect(r.details.mls_description).toBe('Beautiful lakefront home.'); // preserved
    expect(r.details.source).toBe('manual');  // server stamps manual on PATCH
  });

  it('scrape-miss scenario: all nulls + manual entry produce a valid full output', () => {
    // Operator fills everything manually after scrape missed
    const formPayload = {
      price: 650000,
      beds: 3,
      baths: 2,
      sqft: 1500,
      mls_description: 'Charming bungalow in downtown.',
    };

    const r = validateListingDetails(formPayload);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.details.price).toBe(650000);
    expect(r.details.beds).toBe(3);
    expect(r.details.baths).toBe(2);
    expect(r.details.sqft).toBe(1500);
    expect(r.details.mls_description).toBe('Charming bungalow in downtown.');
    expect(r.details.source).toBe('manual');
  });

  it('partially-scraped details: unscraped fields submitted as null are preserved as null', () => {
    // e.g. scraper got price + beds but not baths/sqft/description
    const partialScrapedDetails = {
      price: 500000,
      beds: 2,
      baths: null,
      sqft: null,
      mls_description: null,
    };

    // Form pre-fills from the run — null fields are empty strings → parseNum → null.
    // The PATCH payload always has all 5 keys (matching DeliveryDetails behaviour).
    const formPayload = {
      price: partialScrapedDetails.price,
      beds: partialScrapedDetails.beds,
      baths: partialScrapedDetails.baths,    // null → submitted as null
      sqft: partialScrapedDetails.sqft,      // null → submitted as null
      mls_description: partialScrapedDetails.mls_description, // null
    };

    const r = validateListingDetails(formPayload);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Scraped fields intact
    expect(r.details.price).toBe(500000);
    expect(r.details.beds).toBe(2);
    // Unscraped fields preserved as null (not dropped / undefined)
    expect(r.details.baths).toBeNull();
    expect(r.details.sqft).toBeNull();
    expect(r.details.mls_description).toBeNull();
    expect(r.details.source).toBe('manual');
  });
});
