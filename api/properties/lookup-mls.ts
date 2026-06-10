/**
 * POST /api/properties/lookup-mls
 *
 * Auth-gated. Looks up MLS data for an address via Redfin → Realtor.com chain.
 * Apify actor duration is wildly variable (19s–26min observed in prod). This
 * function raises maxDuration to 300s (Vercel Pro limit) and self-imposes a
 * 240s timeout so the platform never kills it mid-scrape without a clear error.
 *
 * Body:    { address: string }
 * Returns: { source, address, price, bedrooms, bathrooms, sqft, agent, description, listingUrl }
 * Error:   504 { error, hint: "Fill in details manually" }   (timeout)
 *          503 { error, hint }                               (provider not configured)
 *          422 { error, hint }                               (scraper error)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../../lib/auth.js";
import { lookupMlsByAddress, MlsProviderUnconfiguredError } from "../../lib/mls/lookup.js";

// Raise the Vercel function timeout ceiling to 300s (Pro max).
// Observed Apify actor durations: 19s–26min. Without this the default 10s/60s
// cap kills the function before the scraper finishes.
export const maxDuration = 300;

// Self-imposed client-side timeout (ms). Fires before Vercel's 300s kill so
// we can return a clean 504 JSON body instead of an empty platform timeout.
const MLS_CLIENT_TIMEOUT_MS = 240_000;

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
    // Race the MLS lookup against a client-side timeout so we return a useful
    // 504 body rather than letting the Vercel platform kill the function silently.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("__MLS_TIMEOUT__")),
        MLS_CLIENT_TIMEOUT_MS,
      ),
    );
    const result = await Promise.race([
      lookupMlsByAddress(address.trim(), null),
      timeoutPromise,
    ]);
    return res.status(200).json(result);
  } catch (err) {
    // Self-imposed 240s timeout — return a 504 with a fill-in-manually hint.
    if (err instanceof Error && err.message === "__MLS_TIMEOUT__") {
      console.warn("[lookup-mls] timed out after 240s for:", address.trim());
      return res.status(504).json({
        error: "MLS lookup timed out — the scraper is taking too long.",
        hint: "Fill in details manually",
      });
    }
    // Provider not configured (missing APIFY_API_TOKEN, etc) — clean 503.
    if (err instanceof MlsProviderUnconfiguredError) {
      return res.status(503).json({
        error: "MLS auto-fill is temporarily unavailable.",
        hint: "Fill in the property details manually for now.",
      });
    }
    const message = err instanceof Error ? err.message : "MLS lookup failed";
    console.error("[lookup-mls] error:", message);
    return res.status(422).json({
      error: message,
      hint: "Try filling in details manually",
    });
  }
}
