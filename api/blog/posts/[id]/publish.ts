import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;

  const { data: post, error: pErr } = await supabase
    .from("blog_posts").select("id, site_id, state").eq("id", id).single();
  if (pErr || !post) return res.status(404).json({ error: "not found" });

  if (!["awaiting_approval", "draft_ready", "publish_due"].includes(post.state)) {
    return res.status(409).json({ error: `cannot publish from state '${post.state}'` });
  }

  if (post.state !== "publish_due") {
    await supabase.from("blog_posts").update({ state: "publish_due", updated_at: new Date().toISOString() }).eq("id", id);
  }
  const { data: job, error: jErr } = await supabase
    .from("blog_jobs").insert([{ site_id: post.site_id, post_id: id, kind: "publish", payload: {} }])
    .select("id").single();
  if (jErr) return res.status(500).json({ error: jErr.message });
  return res.status(202).json({ job_id: job!.id });
}
