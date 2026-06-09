import { describe, it, expect } from 'vitest';
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
