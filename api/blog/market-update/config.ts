// GET /api/blog/market-update/config
// Returns everything the setup screen needs: the seeded regions and the
// market-update blog/email templates to choose from.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const supabase = getSupabase();
  const { data: site } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) return res.status(500).json({ error: "no Sierra site" });

  const [regionsRes, blogTplRes, emailTplRes] = await Promise.all([
    supabase.from("mu_regions")
      .select("slug, display_name, strip_images, emits_email, sort_order")
      .eq("site_id", site.id).eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase.from("blog_templates")
      .select("id, name, description, metadata")
      .eq("site_id", site.id).eq("active", true)
      .order("updated_at", { ascending: false }),
    supabase.from("email_templates")
      .select("id, name, description, metadata")
      .eq("site_id", site.id).eq("active", true)
      .order("updated_at", { ascending: false }),
  ]);

  if (regionsRes.error) return res.status(500).json({ error: regionsRes.error.message });

  const isMu = (t: any, role: string) =>
    t.metadata?.kind === "market_update" && t.metadata?.mu_role === role;

  return res.status(200).json({
    regions: regionsRes.data ?? [],
    // MU templates first (preselected), but expose all so the operator can pick any.
    blog_templates: (blogTplRes.data ?? []).sort((a: any, b: any) => Number(isMu(b, "blog")) - Number(isMu(a, "blog"))),
    email_templates: (emailTplRes.data ?? []).sort((a: any, b: any) => Number(isMu(b, "email")) - Number(isMu(a, "email"))),
  });
}
