import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 30;

import { getSupabase } from "../../../lib/client.js";

const ALLOWED_KINDS = new Set([
  "research", "distill_topics", "draft", "image_match",
  "publish", "edit", "fetch_taxonomy", "distill_correction",
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  if (req.headers.authorization !== `Bearer ${process.env.BLOG_CRON_SECRET}`) {
    return res.status(401).json({ ok: false });
  }
  const { kind, site_id, post_id, payload } = req.body ?? {};
  if (!kind || !site_id) {
    return res.status(400).json({ ok: false, error: "kind and site_id required" });
  }
  if (!ALLOWED_KINDS.has(kind)) {
    return res.status(400).json({ ok: false, error: `invalid kind: ${kind}` });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("blog_jobs")
    .insert([{ kind, site_id, post_id: post_id ?? null, payload: payload ?? {} }])
    .select("id")
    .single();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, job_id: data!.id });
}
