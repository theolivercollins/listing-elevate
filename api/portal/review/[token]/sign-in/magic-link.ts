import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const supabase = getSupabase();
  const { data: deliv } = await supabase
    .from("portal_deliverables")
    .select("order:portal_orders(customer_id)")
    .eq("review_token", token)
    .maybeSingle();
  if (!deliv) return res.status(404).json({ error: "not found" });
  const order = deliv.order as { customer_id: string };
  const { data: cust } = await supabase
    .from("portal_customers").select("email").eq("id", order.customer_id).single();
  if (!cust) return res.status(404).json({ error: "no customer" });

  const { error } = await supabase.auth.signInWithOtp({
    email: cust.email,
    options: { emailRedirectTo: `${process.env.PUBLIC_BASE_URL ?? ""}/review/${token}` },
  });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, email: cust.email });
}
