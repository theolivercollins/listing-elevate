import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../../lib/auth.js";
import { getSupabase } from "../../../../../lib/client.js";
import { generateListingSeoForProperty } from "../../../../../lib/seo/generate.js";
import { defaultSeoBaseUrl, fetchListingSeoArtifactByPropertyId } from "../../../../../lib/seo/repository.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const propertyId = String(req.query.id ?? "");
  if (!propertyId) return res.status(400).json({ error: "missing_property_id" });

  if (req.method === "GET") {
    try {
      const artifact = await fetchListingSeoArtifactByPropertyId(getSupabase(), propertyId);
      return res.status(200).json({ artifact });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (req.method === "POST") {
    try {
      const artifact = await generateListingSeoForProperty({
        propertyId,
        baseUrl: defaultSeoBaseUrl(),
        useAi: req.body?.use_ai !== false,
        force: req.body?.force === true,
      });
      return res.status(200).json({ artifact });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "public_preview_required") {
        return res.status(409).json({
          error: "public_preview_required",
          message: "Create an active public preview link before generating an indexable SEO package.",
        });
      }
      return res.status(500).json({ error: message });
    }
  }

  return res.status(405).json({ error: "method_not_allowed" });
}
