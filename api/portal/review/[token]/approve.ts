import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";
import { getStripe } from "../../../../lib/portal/stripe.js";
import { computeNextOrderStatus, type OrderStatus } from "../../../../lib/portal/state.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "session required" });
  const supabase = getSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7));
  if (userErr || !userData.user) return res.status(401).json({ error: "invalid session" });

  const { data: deliv, error: dErr } = await supabase
    .from("portal_deliverables")
    .select("id, order:portal_orders(id, status, amount_cents, currency, customer_id, stripe_payment_intent_id), versions:portal_deliverable_versions(id, version, upload_status)")
    .eq("review_token", token)
    .maybeSingle();
  if (dErr) return res.status(500).json({ error: dErr.message });
  if (!deliv) return res.status(404).json({ error: "invalid link" });

  const order = deliv.order as { id: string; status: OrderStatus; amount_cents: number; currency: string; customer_id: string; stripe_payment_intent_id: string | null };
  const { data: cust } = await supabase
    .from("portal_customers").select("user_id, stripe_customer_id").eq("id", order.customer_id).single();
  if (cust?.user_id !== userData.user.id) return res.status(403).json({ error: "must be customer" });
  if (!cust.stripe_customer_id) return res.status(409).json({ error: "no stripe customer; complete onboarding first" });

  const latestUploaded = (deliv.versions as { id: string; version: number; upload_status: string }[])
    .filter((v) => v.upload_status === "uploaded")
    .sort((a, b) => b.version - a.version)[0];
  if (!latestUploaded) return res.status(409).json({ error: "no uploaded version" });

  // Idempotency: if we already have a PaymentIntent for this order in
  // requires_payment_method state, return its client_secret instead of creating a new one.
  const stripe = getStripe();
  if (order.stripe_payment_intent_id) {
    try {
      const existing = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
      if (existing.status === "requires_payment_method" || existing.status === "requires_confirmation") {
        return res.json({ client_secret: existing.client_secret });
      }
    } catch (e) {
      console.warn("[approve] failed to retrieve existing PI; creating new", e);
    }
  }

  // Write the approval comment + advance state to approved
  await supabase.from("portal_comments").insert({
    deliverable_id: deliv.id,
    version_id: latestUploaded.id,
    author_user_id: userData.user.id,
    author_first_name: "Customer",
    author_last_name: "",
    author_email: userData.user.email ?? "",
    kind: "approval",
  });

  try {
    const next1 = computeNextOrderStatus(order.status, "approved");
    await supabase.from("portal_orders").update({ status: next1, approved_at: new Date().toISOString() }).eq("id", order.id);
  } catch (e) {
    return res.status(409).json({ error: e instanceof Error ? e.message : "cannot approve from current state" });
  }

  // Create PaymentIntent
  const pi = await stripe.paymentIntents.create(
    {
      amount: order.amount_cents,
      currency: order.currency,
      customer: cust.stripe_customer_id,
      automatic_payment_methods: { enabled: true },
      metadata: {
        portal_order_id: order.id,
        flow: "approve_pay",
      },
    },
    { idempotencyKey: `portal-approve-${order.id}` },
  );

  await supabase.from("portal_orders")
    .update({ status: "awaiting_payment", stripe_payment_intent_id: pi.id })
    .eq("id", order.id);

  return res.json({ client_secret: pi.client_secret });
}
