import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

// GET  /api/admin/subscriptions  — list all (active by default, ?all=true for all)
// POST /api/admin/subscriptions  — create

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase = getSupabase();

  if (req.method === "GET") {
    let q = supabase.from("subscriptions").select("*").order("created_at", { ascending: false });
    if (req.query.all !== "true") {
      q = q.neq("status", "cancelled");
    }
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ subscriptions: data });
  }

  if (req.method === "POST") {
    const { provider, amount_cents, billing_period, started_at, next_charge_at, note } = req.body || {};
    if (!provider || !amount_cents || !billing_period || !started_at || !next_charge_at) {
      return res.status(400).json({ error: "Missing required fields: provider, amount_cents, billing_period, started_at, next_charge_at" });
    }
    if (!["monthly", "yearly"].includes(billing_period)) {
      return res.status(400).json({ error: "billing_period must be 'monthly' or 'yearly'" });
    }
    const { data, error } = await supabase
      .from("subscriptions")
      .insert({ provider, amount_cents: Number(amount_cents), billing_period, started_at, next_charge_at, note: note || null })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ subscription: data });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
