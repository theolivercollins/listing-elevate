import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

// PATCH  /api/admin/subscriptions/[id]  — update (status, amount, note, next_charge_at…)
// DELETE /api/admin/subscriptions/[id]  — soft-delete (sets status=cancelled)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const supabase = getSupabase();
  const id = String(req.query.id);

  if (req.method === "PATCH") {
    const allowed = ["provider", "amount_cents", "billing_period", "next_charge_at", "status", "note"];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in (req.body || {})) patch[key] = req.body[key];
    }
    if (patch.billing_period && !["monthly", "yearly"].includes(patch.billing_period as string)) {
      return res.status(400).json({ error: "billing_period must be 'monthly' or 'yearly'" });
    }
    if (patch.status && !["active", "paused", "cancelled"].includes(patch.status as string)) {
      return res.status(400).json({ error: "status must be 'active', 'paused', or 'cancelled'" });
    }
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from("subscriptions")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ subscription: data });
  }

  if (req.method === "DELETE") {
    const { data, error } = await supabase
      .from("subscriptions")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ subscription: data });
  }

  res.setHeader("Allow", "PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
