import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

/**
 * GET /api/admin/prompt-lab/listing-assemblies?listing_id=<uuid>
 *
 * Returns prompt_lab_listing_assemblies rows for the given listing, ordered by
 * created_at DESC, limited to 20 rows.
 *
 * Response: PromptLabListingAssembly[]
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const listingId = req.query.listing_id as string | undefined;
  if (!listingId) {
    return res.status(400).json({ error: "listing_id query parameter required" });
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("prompt_lab_listing_assemblies")
    .select(
      "id, status, assembled_url, duration_seconds, iteration_order, pipeline_version, created_at, completed_at, error",
    )
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json(data ?? []);
}
