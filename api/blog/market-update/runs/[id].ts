// GET /api/blog/market-update/runs/:id — fetch a single run (full region_results).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("market_update_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return res.status(404).json({ error: error.message });
  return res.status(200).json({ run: data });
}
