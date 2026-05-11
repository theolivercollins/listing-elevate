import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;
  const fieldsChanged = (req.body?.fields_changed as string[] | undefined) ?? [];
  if (!Array.isArray(fieldsChanged) || fieldsChanged.length === 0) {
    return res.status(400).json({ error: "fields_changed must be a non-empty array" });
  }

  const { data: post, error: pErr } = await supabase
    .from("blog_posts").select("id, site_id, state, external_post_url").eq("id", id).single();
  if (pErr || !post) return res.status(404).json({ error: "not found" });
  if (post.state !== "live") return res.status(409).json({ error: "post is not live" });
  if (!post.external_post_url) return res.status(409).json({ error: "post has no external_post_url" });

  const { data: job, error: jErr } = await supabase.from("blog_jobs").insert([{
    site_id: post.site_id, post_id: id, kind: "edit",
    payload: { fields_changed: fieldsChanged },
  }]).select("id").single();
  if (jErr) return res.status(500).json({ error: jErr.message });
  return res.status(202).json({ job_id: job!.id });
}
