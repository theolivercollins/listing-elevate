// api/blog/email-templates/[id].ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

const EDITABLE = [
  "name",
  "description",
  "design_json",
  "body_html",
  "thumbnail_url",
  "default_subject",
  "default_preheader",
  "default_from_name",
  "default_from_email",
  "default_audience",
  "metadata",
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("email_templates")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) return res.status(404).json({ error: "not found" });
    return res.status(200).json({ template: data });
  }

  if (req.method === "PATCH") {
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) {
      if (k in (req.body ?? {})) patch[k] = (req.body as Record<string, unknown>)[k];
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no editable fields" });
    patch.updated_at = new Date().toISOString();
    const { error } = await supabase.from("email_templates").update(patch).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { error } = await supabase
      .from("email_templates")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
