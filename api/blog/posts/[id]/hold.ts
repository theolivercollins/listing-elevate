// api/blog/posts/[id]/hold.ts
//
// Toggle a post between `live` and `on_hold` inside the LE dashboard. Doesn't touch
// Sierra — flipping to on_hold here keeps the post visible in this dashboard but
// hides it from your "Live" filter. Use the Sierra-side delete (DELETE /api/blog/posts/[id]
// with fromSierra=true) if you also want it off the public site.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  const body = (req.body ?? {}) as { hold?: boolean };
  if (typeof body.hold !== "boolean") {
    return res.status(400).json({ error: "body.hold (boolean) required" });
  }

  const supabase = getSupabase();
  const { data: post, error: pErr } = await supabase
    .from("blog_posts").select("state").eq("id", id).single();
  if (pErr || !post) return res.status(404).json({ error: "post not found" });

  // Only valid transitions: live -> on_hold, on_hold -> live.
  if (body.hold && post.state !== "live") {
    return res.status(409).json({ error: `cannot hold from state '${post.state}'; expected 'live'` });
  }
  if (!body.hold && post.state !== "on_hold") {
    return res.status(409).json({ error: `cannot resume from state '${post.state}'; expected 'on_hold'` });
  }

  const nextState = body.hold ? "on_hold" : "live";
  const { error } = await supabase
    .from("blog_posts")
    .update({ state: nextState, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true, state: nextState });
}
