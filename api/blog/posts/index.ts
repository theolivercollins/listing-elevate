import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    const state = req.query.state as string | undefined;
    const q = (req.query.q as string | undefined)?.trim();
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);

    let qb = supabase
      .from("blog_posts")
      .select(`
        id, title, state, author_label, category_label, updated_at,
        cost_usd_cents, external_post_url, image_id, metadata,
        image:image_id (id, blob_url, vision_caption)
      `)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (state) {
      const states = state.split(",");
      qb = qb.in("state", states);
    }
    if (q) qb = qb.or(`title.ilike.%${q}%,meta_title.ilike.%${q}%`);
    if (cursor) qb = qb.lt("updated_at", cursor);

    const { data, error } = await qb;
    if (error) return res.status(500).json({ error: error.message });

    const posts = (data ?? []).map((row: any) => ({
      ...row,
      authored: row.metadata?.authored ?? "manual",
      image: Array.isArray(row.image) ? row.image[0] ?? null : row.image,
    }));
    const next_cursor = posts.length === limit ? posts[posts.length - 1].updated_at : null;
    return res.status(200).json({ posts, next_cursor });
  }

  if (req.method === "POST") {
    const b = req.body ?? {};
    if (!b.title || !b.body_html || !b.initial_state) {
      return res.status(400).json({ error: "title, body_html, initial_state required" });
    }
    if (!["awaiting_approval", "publish_due"].includes(b.initial_state)) {
      return res.status(400).json({ error: "initial_state must be awaiting_approval or publish_due" });
    }

    const { data: site } = await supabase
      .from("blog_sites").select("id").eq("host_kind", "sierra").single();
    if (!site) return res.status(500).json({ error: "no Sierra site" });

    const authored = b.authored ?? "manual";
    const { data: post, error } = await supabase.from("blog_posts").insert([{
      site_id: site.id,
      state: b.initial_state,
      title: b.title,
      body_html: b.body_html,
      meta_title: b.meta_title ?? null,
      meta_description: b.meta_description ?? null,
      meta_tags: b.meta_tags ?? [],
      author_label: b.author_label ?? null,
      category_label: b.category_label ?? null,
      image_id: b.image_id ?? null,
      publish_at: b.publish_at ?? null,
      metadata: { authored },
    }]).select("id").single();
    if (error) return res.status(500).json({ error: error.message });

    if (b.initial_state === "publish_due") {
      const { error: jErr } = await supabase.from("blog_jobs").insert([{
        site_id: site.id, post_id: post!.id, kind: "publish", payload: {},
      }]);
      if (jErr) return res.status(500).json({ error: `post created but enqueue failed: ${jErr.message}` });
    }

    return res.status(201).json({ id: post!.id });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
