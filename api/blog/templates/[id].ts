// api/blog/templates/[id].ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

const EDITABLE = [
  "name",
  "description",
  "body_html",
  "default_author_label",
  "default_category_label",
  "default_meta_title",
  "default_meta_description",
  "default_meta_tags",
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  if (req.method === "GET") {
    const { data, error } = await supabase.from("blog_templates").select("*").eq("id", id).single();
    if (error || !data) return res.status(404).json({ error: "not found" });
    return res.status(200).json({ template: data });
  }

  if (req.method === "PATCH") {
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) if (k in (req.body ?? {})) patch[k] = (req.body as any)[k];
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no editable fields" });
    patch.updated_at = new Date().toISOString();
    const { error } = await supabase.from("blog_templates").update(patch).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { error } = await supabase.from("blog_templates").update({ active: false }).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
