import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import { getPortalBaseUrl } from "../../../lib/portal/stripe.js";

const ORDER_SELECT =
  "id, order_number, customer_id, title, description, amount_cents, currency, line_items, status, onboarding_token, stripe_invoice_id, stripe_invoice_url, paid_at, canceled_at, created_at, updated_at";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("portal_orders")
      .select(`${ORDER_SELECT}, customer:portal_customers(id, email, first_name, last_name, business_name, phone, address_line1, address_city, address_state)`)
      .eq("id", id)
      .eq("owner_id", auth.user.id)
      .single();
    if (error || !data) return res.status(404).json({ error: "Order not found" });

    const onboarding_url = data.onboarding_token
      ? `${getPortalBaseUrl()}/onboard/${data.onboarding_token}`
      : null;

    const { data: deliverables } = await supabase
      .from("portal_deliverables")
      .select(`
        id, order_id, title, description, status, review_token, created_at, updated_at,
        versions:portal_deliverable_versions(id, version, file_name, file_size_bytes, mime_type, upload_note, upload_status, created_at)
      `)
      .eq("order_id", id)
      .order("created_at", { ascending: true });

    return res.json({ order: data, onboarding_url, deliverables: deliverables ?? [] });
  }

  if (req.method === "DELETE") {
    // Cancel an order. Stripe invoice (if issued) is voided in a follow-up.
    const { error } = await supabase
      .from("portal_orders")
      .update({ status: "canceled", canceled_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_id", auth.user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed" });
}
