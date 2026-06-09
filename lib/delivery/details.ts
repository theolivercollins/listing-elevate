import type { ListingDetails } from '../types/operator-studio.js';

type Result = { ok: true; details: ListingDetails } | { ok: false; error: string };

function num(v: unknown, field: string): number | null | string {
  if (v == null || v === '') return null;
  if (typeof v !== 'number' || !isFinite(v) || v < 0) return `${field} must be a non-negative number`;
  return v;
}

/** Manual entry validation. Partial payloads OK; bad values rejected. */
export function validateListingDetails(input: Record<string, unknown>): Result {
  const out: ListingDetails = { source: 'manual' };
  for (const field of ['price', 'beds', 'baths', 'sqft'] as const) {
    const v = num(input[field], field);
    if (typeof v === 'string') return { ok: false, error: v };
    if (v !== null) out[field] = v;
    else out[field] = null;
  }
  const desc = input.mls_description;
  if (desc != null && typeof desc !== 'string') return { ok: false, error: 'mls_description must be a string' };
  out.mls_description = (desc as string | null) ?? null;
  return { ok: true, details: out };
}
