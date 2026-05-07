import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../lib/db.js";
import { getStripe } from "../../../lib/portal/stripe.js";

// PUBLIC endpoint — no auth required. Validated via the unguessable
// onboarding_token. After successful submit, the token is consumed (set to NULL)
// and the order moves to status='awaiting_payment'.

interface OnboardingPayload {
  business_name?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  address_city?: string;
  address_state?: string;
  address_postal_code?: string;
  address_country?: string;
}

function validate(p: OnboardingPayload): string | null {
  if (!p.address_line1 || typeof p.address_line1 !== "string") return "Street address required";
  if (!p.address_city || typeof p.address_city !== "string") return "City required";
  if (!p.address_state || typeof p.address_state !== "string") return "State / region required";
  if (!p.address_postal_code || typeof p.address_postal_code !== "string") return "Postal code required";
  if (!p.address_country || typeof p.address_country !== "string" || p.address_country.length !== 2) {
    return "Country required (2-letter code, e.g. US)";
  }
  if (!p.phone || typeof p.phone !== "string") return "Phone required";
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const supabase = getSupabase();

  // Resolve token → order + customer
  const { data: order, error: ordErr } = await supabase
    .from("portal_orders")
    .select(
      "id, owner_id, customer_id, title, description, amount_cents, currency, line_items, status, onboarding_token, stripe_invoice_url"
    )
    .eq("onboarding_token", token)
    .maybeSingle();

  if (ordErr) return res.status(500).json({ error: ordErr.message });
  if (!order) return res.status(404).json({ error: "Invalid or expired link" });

  const { data: customer, error: custErr } = await supabase
    .from("portal_customers")
    .select(
      "id, email, first_name, last_name, business_name, phone, address_line1, address_line2, address_city, address_state, address_postal_code, address_country, stripe_customer_id, onboarded_at"
    )
    .eq("id", order.customer_id)
    .single();
  if (custErr || !customer) return res.status(404).json({ error: "Customer not found" });

  // ─── GET: return order summary so the page can render ───────────────────
  if (req.method === "GET") {
    return res.json({
      order: {
        id: order.id,
        title: order.title,
        description: order.description,
        amount_cents: order.amount_cents,
        currency: order.currency,
        line_items: order.line_items,
        status: order.status,
        stripe_invoice_url: order.stripe_invoice_url,
      },
      customer: {
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        business_name: customer.business_name,
        phone: customer.phone,
        address_line1: customer.address_line1,
        address_line2: customer.address_line2,
        address_city: customer.address_city,
        address_state: customer.address_state,
        address_postal_code: customer.address_postal_code,
        address_country: customer.address_country,
      },
    });
  }

  // ─── POST: submit billing details → create Stripe Customer + Invoice ───
  if (req.method === "POST") {
    if (order.status !== "awaiting_onboarding") {
      // Idempotent: if invoice already exists, return its URL.
      if (order.stripe_invoice_url) {
        return res.json({ status: order.status, stripe_invoice_url: order.stripe_invoice_url });
      }
      return res.status(409).json({ error: `Order is in status '${order.status}', cannot onboard` });
    }

    const body = (req.body ?? {}) as OnboardingPayload;
    const err = validate(body);
    if (err) return res.status(400).json({ error: err });

    const stripe = getStripe();

    // 1. Create or reuse Stripe Customer
    let stripe_customer_id = customer.stripe_customer_id;
    if (!stripe_customer_id) {
      const stripeCustomer = await stripe.customers.create({
        email: customer.email,
        name: body.business_name || `${customer.first_name} ${customer.last_name}`,
        phone: body.phone,
        address: {
          line1: body.address_line1,
          line2: body.address_line2 || undefined,
          city: body.address_city,
          state: body.address_state,
          postal_code: body.address_postal_code,
          country: body.address_country!.toUpperCase(),
        },
        metadata: {
          portal_customer_id: customer.id,
          owner_id: order.owner_id,
        },
      });
      stripe_customer_id = stripeCustomer.id;
    }

    // 2. Persist customer billing details + Stripe linkage
    const { error: updCustErr } = await supabase
      .from("portal_customers")
      .update({
        business_name: body.business_name || null,
        phone: body.phone,
        address_line1: body.address_line1,
        address_line2: body.address_line2 || null,
        address_city: body.address_city,
        address_state: body.address_state,
        address_postal_code: body.address_postal_code,
        address_country: body.address_country!.toUpperCase(),
        stripe_customer_id,
        onboarded_at: new Date().toISOString(),
      })
      .eq("id", customer.id);
    if (updCustErr) return res.status(500).json({ error: updCustErr.message });

    // 3. Create invoice items (one per line, or single from title/amount)
    const items =
      Array.isArray(order.line_items) && order.line_items.length > 0
        ? (order.line_items as Array<{ description: string; amount_cents: number; quantity: number }>)
        : [{ description: order.title, amount_cents: order.amount_cents, quantity: 1 }];

    for (const li of items) {
      await stripe.invoiceItems.create({
        customer: stripe_customer_id,
        amount: li.amount_cents * li.quantity,
        currency: order.currency,
        description: li.description,
        metadata: { portal_order_id: order.id },
      });
    }

    // 4. Create + finalize the invoice (Stripe emails it automatically)
    const invoice = await stripe.invoices.create({
      customer: stripe_customer_id,
      collection_method: "send_invoice",
      days_until_due: 14,
      auto_advance: true,
      description: order.description || order.title,
      metadata: {
        portal_order_id: order.id,
        owner_id: order.owner_id,
      },
    });

    if (!invoice.id) {
      return res.status(500).json({ error: "Stripe invoice missing id" });
    }

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    // sendInvoice triggers Stripe's hosted email with the pay-link.
    await stripe.invoices.sendInvoice(invoice.id);

    // 5. Update order, consume token
    const { error: updOrdErr } = await supabase
      .from("portal_orders")
      .update({
        status: "awaiting_payment",
        onboarding_token: null,
        stripe_invoice_id: invoice.id,
        stripe_invoice_url: finalized.hosted_invoice_url,
      })
      .eq("id", order.id);
    if (updOrdErr) return res.status(500).json({ error: updOrdErr.message });

    // 6. Notify owner
    await supabase.from("portal_notifications").insert({
      user_id: order.owner_id,
      kind: "onboarding_completed",
      title: `${customer.first_name} ${customer.last_name} confirmed details`,
      body: `Stripe invoice issued for "${order.title}" — $${(order.amount_cents / 100).toFixed(2)}`,
      link_path: `/dashboard/orders/${order.id}`,
      order_id: order.id,
    });

    return res.json({
      status: "awaiting_payment",
      stripe_invoice_url: finalized.hosted_invoice_url,
    });
  }

  res.status(405).json({ error: "Method not allowed" });
}
