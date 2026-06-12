// api/blog/email-templates/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("email_templates")
      .select("*")
      .eq("active", true)
      .order("updated_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ templates: data ?? [] });
  }

  if (req.method === "POST") {
    const b = req.body ?? {};
    if (!b.name) {
      return res.status(400).json({ error: "name required" });
    }
    const { data: site } = await supabase
      .from("blog_sites")
      .select("id")
      .eq("host_kind", "sierra")
      .single();
    const { data, error } = await supabase
      .from("email_templates")
      .insert([{
        site_id: site?.id ?? null,
        name: b.name,
        description: b.description ?? null,
        design_json: b.design_json ?? {},
        body_html: b.body_html ?? "",
        thumbnail_url: b.thumbnail_url ?? null,
        default_subject: b.default_subject ?? null,
        default_preheader: b.default_preheader ?? null,
        default_from_name: b.default_from_name ?? null,
        default_from_email: b.default_from_email ?? null,
        default_audience: b.default_audience ?? null,
        metadata: b.metadata ?? {},
      }])
      .select("id")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ id: data!.id });
  }

  return res.status(405).end();
}
