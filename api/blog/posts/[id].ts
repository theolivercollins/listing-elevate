import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

const EDITABLE = [
  "title", "body_html", "meta_title", "meta_description", "meta_tags",
  "author_label", "category_label", "image_id", "publish_at",
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  if (req.method === "GET") {
    const { data: post, error: pErr } = await supabase
      .from("blog_posts").select("*, image:image_id (id, blob_url, vision_caption, vision_tags)")
      .eq("id", id).single();
    if (pErr || !post) return res.status(404).json({ error: "not found" });

    const { data: jobs } = await supabase
      .from("blog_jobs")
      .select("id, kind, state, last_error, replay_url, started_at, finished_at, created_at")
      .eq("post_id", id)
      .order("created_at", { ascending: false })
      .limit(20);

    const { count: cost_events } = await supabase
      .from("cost_events").select("*", { count: "exact", head: true }).eq("post_id", id);

    return res.status(200).json({
      post: { ...post, authored: post.metadata?.authored ?? "manual" },
      jobs: jobs ?? [],
      cost_events: cost_events ?? 0,
    });
  }

  if (req.method === "PATCH") {
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) if (k in (req.body ?? {})) patch[k] = req.body[k];
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no editable fields in body" });
    patch.updated_at = new Date().toISOString();

    const { error } = await supabase.from("blog_posts").update(patch).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
