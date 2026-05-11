// api/blog/templates/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("blog_templates").select("*")
      .eq("active", true)
      .order("updated_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ templates: data ?? [] });
  }

  if (req.method === "POST") {
    const b = req.body ?? {};
    if (!b.name || typeof b.body_html !== "string") {
      return res.status(400).json({ error: "name and body_html required" });
    }
    const { data: site } = await supabase.from("blog_sites").select("id").eq("host_kind", "sierra").single();
    const { data, error } = await supabase.from("blog_templates").insert([{
      site_id: site?.id ?? null,
      name: b.name,
      description: b.description ?? null,
      body_html: b.body_html,
      default_author_label: b.default_author_label ?? null,
      default_category_label: b.default_category_label ?? null,
      default_meta_title: b.default_meta_title ?? null,
      default_meta_description: b.default_meta_description ?? null,
      default_meta_tags: Array.isArray(b.default_meta_tags) ? b.default_meta_tags : [],
    }]).select("id").single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ id: data!.id });
  }

  return res.status(405).end();
}
