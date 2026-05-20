// api/admin/studio/mls-lookup.ts
//
// Look up listing details by address. Wraps RentCast's
// /v1/properties endpoint when RENTCAST_API_KEY is set.
// Returns 501 with a clear message when no MLS provider is configured.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../../lib/auth';
import type { MlsLookupResult } from '../../../lib/types/operator-studio';

type RentCastProperty = {
  formattedAddress?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  lastSalePrice?: number;
  price?: number;
  estimatedValue?: number;
  yearBuilt?: number;
  propertyType?: string;
  [k: string]: unknown;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { address } = (req.body ?? {}) as { address?: string };
  if (!address || !address.trim()) {
    return res.status(400).json({ error: 'address required' });
  }

  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) {
    return res.status(501).json({
      error: 'mls_lookup_not_configured',
      detail:
        'Set RENTCAST_API_KEY (or wire a different MLS provider in api/admin/studio/mls-lookup.ts) to enable address-based listing lookup.',
    });
  }

  try {
    const url = new URL('https://api.rentcast.io/v1/properties');
    url.searchParams.set('address', address.trim());

    const r = await fetch(url.toString(), {
      headers: { accept: 'application/json', 'X-Api-Key': apiKey },
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(r.status).json({ error: 'mls_provider_error', detail });
    }

    const data = (await r.json()) as RentCastProperty | RentCastProperty[];
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return res.status(404).json({ error: 'no_match' });

    const result: MlsLookupResult = {
      source: 'rentcast',
      matched_address: row.formattedAddress ?? address,
      bedrooms: row.bedrooms ?? null,
      bathrooms: row.bathrooms ?? null,
      square_footage: row.squareFootage ?? null,
      price: row.price ?? row.estimatedValue ?? row.lastSalePrice ?? null,
      year_built: row.yearBuilt ?? null,
      property_type: row.propertyType ?? null,
      raw: row as Record<string, unknown>,
    };
    return res.status(200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/studio/mls-lookup]', err);
    return res.status(500).json({ error: 'mls_lookup_failed', detail: msg });
  }
}
