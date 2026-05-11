import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../../lib/db.js";
import { createSignedStreamUrl } from "../../../../../../lib/portal/storage.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  const vid = req.query.vid as string;
  if (!token || !vid) return res.status(400).json({ error: "token + vid required" });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("portal_deliverable_versions")
    .select("id, storage_path, upload_status, deliverable:portal_deliverables(review_token)")
    .eq("id", vid)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  const deliverable = data?.deliverable as { review_token: string } | null;
  if (!data || !deliverable || deliverable.review_token !== token) return res.status(404).json({ error: "not found" });
  if (data.upload_status !== "uploaded") return res.status(409).json({ error: "version not ready" });

  const stream_url = await createSignedStreamUrl(supabase, data.storage_path);
  return res.json({ stream_url });
}
