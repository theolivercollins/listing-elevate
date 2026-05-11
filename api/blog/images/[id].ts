import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

const VOCAB = ["aerial","exterior","interior","team","area","lifestyle","event",
  "seasonal_spring","seasonal_summer","seasonal_fall","seasonal_winter","data_chart"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;

  if (req.method === "PATCH") {
    const patch: Record<string, unknown> = {};
    if (Array.isArray(req.body?.vision_tags)) {
      const tags = req.body.vision_tags.filter((t: any) => typeof t === "string" && VOCAB.includes(t));
      patch.vision_tags = tags;
    }
    if (typeof req.body?.active === "boolean") patch.active = req.body.active;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no editable fields" });
    const { error } = await supabase.from("blog_images").update(patch).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { error } = await supabase.from("blog_images").update({ active: false }).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
