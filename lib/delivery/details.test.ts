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
