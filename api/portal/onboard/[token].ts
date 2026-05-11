import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../lib/db.js";
import { getStripe } from "../../../lib/portal/stripe.js";

// PUBLIC endpoint — no auth required. Validated via the unguessable
// onboarding_token. After successful submit, the token is consumed (set to NULL)
// and the order moves to status='awaiting_payment'.

interface OnboardingPayload {
  first_name?: string;
  last_name?: string;
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
      "id, owner_id, customer_id, title, description, amount_cents, currency, line_items, status, onboarding_token, stripe_payment_intent_id"
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
    // If the order has an active PaymentIntent, hand its client_secret back
    // so the page can skip the form and mount Payment Element directly. Lets
    // the customer resume payment after refreshing / closing the tab.
    let client_secret: string | null = null;
    if (
      order.status === "awaiting_payment" &&
      (order as { stripe_payment_intent_id?: string }).stripe_payment_intent_id
    ) {
      try {
        const stripe = getStripe();
        const pi = await stripe.paymentIntents.retrieve(
          (order as { stripe_payment_intent_id: string }).stripe_payment_intent_id
        );
        if (pi.status === "requires_payment_method" || pi.status === "requires_confirmation") {
          client_secret = pi.client_secret;
        }
      } catch (e) {
        console.error("[onboard GET] failed to retrieve PaymentIntent", e);
      }
    }

    return res.json({
      order: {
        id: order.id,
        title: order.title,
        description: order.description,
        amount_cents: order.amount_cents,
        currency: order.currency,
        line_items: order.line_items,
        status: order.status,
      },
      // Present if the customer is mid-flow and can resume payment.
      client_secret,
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

  // ─── POST: submit billing details → create Stripe Customer + PaymentIntent ───
  if (req.method === "POST") {
    if (order.status !== "awaiting_onboarding") {
      // Re-open: if we have an active PaymentIntent in `requires_payment_method`,
      // hand its client_secret back so Payment Element can re-mount.
      const existingPiId = (order as { stripe_payment_intent_id?: string }).stripe_payment_intent_id;
      if (existingPiId) {
        try {
          const stripe = getStripe();
          const existing = await stripe.paymentIntents.retrieve(existingPiId);
          if (existing.status === "requires_payment_method" || existing.status === "requires_confirmation") {
            return res.json({ status: order.status, client_secret: existing.client_secret });
          }
        } catch (e) {
          console.error("[onboard] failed to retrieve existing PaymentIntent", e);
        }
      }
      return res.status(409).json({ error: `Order is in status '${order.status}', cannot onboard` });
    }

    const body = (req.body ?? {}) as OnboardingPayload;
    const err = validate(body);
    if (err) return res.status(400).json({ error: err });

    let stripe;
    try {
      stripe = getStripe();
    } catch (e) {
      console.error("[onboard] getStripe failed", e);
      return res.status(500).json({ error: "Stripe not configured (STRIPE_SECRET_KEY missing)" });
    }

    let stripe_customer_id = customer.stripe_customer_id;
    let paymentIntent: import("stripe").Stripe.PaymentIntent | undefined;
    try {
      // 1. Create or reuse Stripe Customer. Idempotency key scoped to
      // portal_customer.id so retries return the same Stripe Customer
      // instead of creating duplicates.
      if (!stripe_customer_id) {
        const stripeCustomer = await stripe.customers.create(
          {
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
            metadata: { portal_customer_id: customer.id, owner_id: order.owner_id },
          },
          { idempotencyKey: `portal-customer-${customer.id}` }
        );
        stripe_customer_id = stripeCustomer.id;
      }

      // 2. Persist customer billing details + Stripe linkage. Customer can
      // also edit their first/last name during onboarding (the owner may have
      // typed it wrong, or the client prefers a different name on file).
      const { error: updCustErr } = await supabase
        .from("portal_customers")
        .update({
          first_name: body.first_name?.trim() || customer.first_name,
          last_name: body.last_name?.trim() || customer.last_name,
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
      if (updCustErr) {
        console.error("[onboard] customer update failed", updCustErr);
        return res.status(500).json({ error: updCustErr.message });
      }

      // 3. Create a PaymentIntent. Returns a client_secret we hand to the
      // frontend to mount Stripe's Payment Element (just the card field +
      // wallet buttons, no full-page checkout iframe). The actual Stripe
      // invoice gets auto-created in the webhook after payment succeeds —
      // see api/portal/stripe-webhook.ts.
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: order.amount_cents,
          currency: order.currency,
          customer: stripe_customer_id,
          description: order.description || order.title,
          automatic_payment_methods: { enabled: true },
          metadata: {
            portal_order_id: order.id,
            owner_id: order.owner_id,
            portal_customer_id: customer.id,
          },
        },
        { idempotencyKey: `portal-pi-${order.id}` }
      );
    } catch (stripeErr) {
      // Stripe SDK errors carry .type, .code, .message — surface enough to debug.
      const e = stripeErr as { type?: string; code?: string; message?: string; raw?: { message?: string } };
      const detail = e?.raw?.message || e?.message || String(stripeErr);
      console.error("[onboard] Stripe error", { type: e?.type, code: e?.code, detail });
      return res.status(500).json({
        error: `Stripe: ${detail}`,
        type: e?.type,
        code: e?.code,
      });
    }

    // 5. Update order — consume token, save PaymentIntent ID.
    if (!paymentIntent?.client_secret) {
      return res.status(500).json({ error: "PaymentIntent missing client_secret" });
    }
    // NOTE: deliberately NOT nulling onboarding_token here. Keeping it alive
    // lets the customer resume payment if they refresh / close the tab — the
    // GET handler will detect the active PaymentIntent and remount Payment
    // Element on the same link. The token is unguessable (256 bits) so this
    // doesn't reduce security in any meaningful way.
    const { error: updOrdErr } = await supabase
      .from("portal_orders")
      .update({
        status: "awaiting_payment",
        stripe_payment_intent_id: paymentIntent.id,
      })
      .eq("id", order.id);
    if (updOrdErr) return res.status(500).json({ error: updOrdErr.message });

    // 6. In-app notification that onboarding is done. Owner email fires on
    // payment success (in the webhook), not here.
    await supabase.from("portal_notifications").insert({
      user_id: order.owner_id,
      kind: "onboarding_completed",
      title: `${customer.first_name} ${customer.last_name} confirmed details`,
      body: `Awaiting payment for "${order.title}" — $${(order.amount_cents / 100).toFixed(2)}`,
      link_path: `/dashboard/orders/${order.id}`,
      order_id: order.id,
    });

    return res.json({
      status: "awaiting_payment",
      client_secret: paymentIntent.client_secret,
    });
  }

  res.status(405).json({ error: "Method not allowed" });
}
