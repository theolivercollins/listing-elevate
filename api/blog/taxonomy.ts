import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../lib/auth.js";
import { getSupabase } from "../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  const { data: site, error } = await supabase
    .from("blog_sites")
    .select("id, taxonomy_cache")
    .eq("host_kind", "sierra")
    .single();
  if (error || !site) return res.status(500).json({ error: error?.message ?? "no Sierra site" });

  const cache = (site.taxonomy_cache ?? {}) as { authors?: any[]; categories?: any[] };
  return res.status(200).json({
    site_id: site.id,
    authors: Array.isArray(cache.authors) ? cache.authors : [],
    categories: Array.isArray(cache.categories) ? cache.categories : [],
  });
}
