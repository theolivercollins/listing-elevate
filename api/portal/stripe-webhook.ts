import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
import { getSupabase } from "../../lib/db.js";
import { getStripe } from "../../lib/portal/stripe.js";
import { sendEmail, emailShell } from "../../lib/portal/email.js";

// Vercel serverless: opt out of body parsing so we can verify the signature
// against the raw body. Parsing JSON would change byte-for-byte content.
export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(typeof c === "string" ? Buffer.from(c) : c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return res.status(500).json({ error: "Webhook not configured" });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") return res.status(400).json({ error: "Missing signature" });

  const stripe = getStripe();
  const raw = await readRawBody(req);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed", err);
    return res.status(400).json({ error: "Invalid signature" });
  }

  const supabase = getSupabase();

  // Resolve the portal_order_id from whichever event we get:
  //   - payment_intent.succeeded → primary path (Payment Element charge)
  //   - checkout.session.completed → legacy / fallback if we ever revert
  //   - invoice.paid / invoice.payment_succeeded → if invoices are involved
  let portal_order_id: string | undefined;
  let invoice_id: string | undefined;
  let invoice_url: string | undefined;

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    portal_order_id = pi.metadata?.portal_order_id;
  } else if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    portal_order_id = session.metadata?.portal_order_id;
    invoice_id = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
    if (session.payment_status !== "paid") {
      return res.json({ received: true, ignored: true, reason: "not_paid" });
    }
  } else if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    portal_order_id = invoice.metadata?.portal_order_id;
    invoice_id = invoice.id;
    invoice_url = invoice.hosted_invoice_url ?? undefined;
  } else {
    return res.json({ received: true, ignored_type: event.type });
  }

  if (!portal_order_id) {
    console.warn("[stripe-webhook] event without portal_order_id metadata", event.type, event.id);
    return res.json({ received: true, ignored: true });
  }

  // ─── Shared completion logic ───────────────────────────────────────────
  // Lookup order. Idempotent: if already paid, skip.
  const { data: order } = await supabase
    .from("portal_orders")
    .select("id, owner_id, title, amount_cents, status, customer_id")
    .eq("id", portal_order_id)
    .maybeSingle();

  if (!order) return res.json({ received: true, unknown_order: portal_order_id });
  if (
    order.status === "paid" ||
    order.status === "in_progress" ||
    order.status === "delivered" ||
    order.status === "in_review" ||
    order.status === "approved"
  ) {
    // Still backfill the invoice id/url if the checkout.session.completed event
    // arrived after we already saw invoice.paid (or vice-versa).
    if (invoice_id || invoice_url) {
      await supabase
        .from("portal_orders")
        .update({
          ...(invoice_id ? { stripe_invoice_id: invoice_id } : {}),
          ...(invoice_url ? { stripe_invoice_url: invoice_url } : {}),
        })
        .eq("id", order.id);
    }
    return res.json({ received: true, already_paid: true });
  }

  await supabase
    .from("portal_orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      ...(invoice_id ? { stripe_invoice_id: invoice_id } : {}),
      ...(invoice_url ? { stripe_invoice_url: invoice_url } : {}),
    })
    .eq("id", order.id);

  // Fetch customer for email body
  const { data: customer } = await supabase
    .from("portal_customers")
    .select("email, first_name, last_name")
    .eq("id", order.customer_id)
    .single();

  // In-app notification for the owner
  await supabase.from("portal_notifications").insert({
    user_id: order.owner_id,
    kind: "order_paid",
    title: `Payment received: ${order.title}`,
    body: customer
      ? `${customer.first_name} ${customer.last_name} paid $${(order.amount_cents / 100).toFixed(2)}`
      : `$${(order.amount_cents / 100).toFixed(2)} received`,
    link_path: `/dashboard/orders/${order.id}`,
    order_id: order.id,
  });

  // Owner email
  const { data: ownerUser } = await supabase.auth.admin.getUserById(order.owner_id);
  const ownerEmail = ownerUser?.user?.email;
  if (ownerEmail) {
    try {
      await sendEmail({
        to: ownerEmail,
        subject: `Paid: ${order.title}`,
        html: emailShell({
          heading: `Payment received`,
          body: `<p><strong>${order.title}</strong></p><p>${customer?.first_name ?? ""} ${customer?.last_name ?? ""} just paid <strong>$${(order.amount_cents / 100).toFixed(2)}</strong>. You can now upload deliverables.</p>`,
          cta: { label: "Open order", url: `${process.env.PORTAL_BASE_URL ?? "https://portal.listingelevate.com"}/dashboard/orders/${order.id}` },
        }),
      });
    } catch (e) {
      console.error("[stripe-webhook] owner email failed", e);
    }
  }

  return res.json({ received: true });
}
