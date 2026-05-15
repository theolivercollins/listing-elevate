/**
 * POST /api/properties/lookup-mls
 *
 * Auth-gated. Looks up MLS data for an address via Redfin → Realtor.com chain.
 *
 * Body:    { address: string }
 * Returns: { source, address, price, bedrooms, bathrooms, sqft, agent, description, listingUrl }
 * Error:   422 { error, hint: "Try filling in details manually" }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../../lib/auth.js";
import { lookupMlsByAddress } from "../../lib/mls/lookup.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return; // requireAuth already sent 401

  const { address } = req.body ?? {};
  if (!address || typeof address !== "string" || address.trim().length === 0) {
    return res.status(400).json({ error: "address is required" });
  }

  try {
    const result = await lookupMlsByAddress(address.trim(), null);
    return res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "MLS lookup failed";
    console.error("[lookup-mls] error:", message);
    return res.status(422).json({
      error: message,
      hint: "Try filling in details manually",
    });
  }
}
