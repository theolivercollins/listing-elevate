import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";
import { requireOwner } from "../../../../lib/portal/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });

  const orderId = req.query.id as string;
  if (!orderId) return res.status(400).json({ error: "order id required" });

  const supabase = getSupabase();
  const ownerCheck = await requireOwner(req, supabase, orderId);
  if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ error: ownerCheck.error });

  const { data, error } = await supabase
    .from("portal_notifications")
    .select("id, kind, title, body, link_path, created_at, read_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ activity: data ?? [] });
}
