/**
 * POST /api/properties/scrape-mls
 *
 * Scrapes a listing URL and returns structured property details for auto-filling
 * the order intake form. Auth-gated. Returns all fields optional.
 *
 * Body:  { url: string }
 * Returns: { address?, price?, bedrooms?, bathrooms?, agent?, description? }
 *
 * Cost: 1¢ per call (Apify compute) — recorded to cost_events with null property_id.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../../lib/auth.js";
import { scrapeCompassListing } from "../../lib/compass/scrape-listing.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { url } = req.body ?? {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "url is required" });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  if (!parsedUrl.hostname.includes("compass.com")) {
    return res.status(400).json({ error: "Only compass.com listing URLs are supported" });
  }

  try {
    const result = await scrapeCompassListing(url, null);
    return res.status(200).json({
      address: result.address ?? null,
      price: result.price ?? null,
      bedrooms: result.bedrooms ?? null,
      bathrooms: result.bathrooms ?? null,
      agent: result.agent ?? null,
      description: result.description || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scrape failed";
    console.error("[scrape-mls] error:", message);
    return res.status(502).json({ error: message });
  }
}
