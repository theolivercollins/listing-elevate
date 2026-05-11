import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("portal_deliverables")
    .select("order:portal_orders(status)")
    .eq("review_token", token)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "not found" });
  const order = data.order as { status: string } | null;
  return res.json({ order_status: order?.status ?? null });
}
