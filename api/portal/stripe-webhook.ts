import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
import { getSupabase } from "../../lib/db.js";
import { getStripe } from "../../lib/portal/stripe.js";
import { sendEmail, emailShell } from "../../lib/portal/email.js";
import { notifyClient, notifyOwner } from "../../lib/portal/notifications.js";

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
  let flow: string = "legacy";

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    portal_order_id = pi.metadata?.portal_order_id;
    flow = pi.metadata?.flow ?? "legacy";
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
    .select("id, owner_id, title, amount_cents, currency, status, customer_id")
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

  // ─── Phase 2: approve_pay flow ────────────────────────────────────────────
  // Client approved + paid on the review page. Flip to `paid`, notify owner,
  // email client a receipt with the download link. Return early — the legacy
  // owner-notification path below is for pre-Phase-2 PaymentIntents.
  if (flow === "approve_pay") {
    const { error: updErr } = await supabase
      .from("portal_orders")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", order.id);
    if (updErr) {
      console.error("[stripe-webhook] approve_pay order update failed", updErr);
      return res.status(500).json({ error: updErr.message });
    }

    // Customer email for the receipt
    const { data: custRow } = await supabase
      .from("portal_customers")
      .select("email")
      .eq("id", order.customer_id)
      .single();

    // Pick the most recent deliverable for the order to build the review +
    // download links. If we can't find one, skip the client email — the owner
    // notification is still load-bearing.
    const { data: delivRow } = await supabase
      .from("portal_deliverables")
      .select("review_token")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (custRow?.email && delivRow?.review_token) {
      const base = process.env.PUBLIC_BASE_URL ?? "";
      const reviewUrl = `${base}/review/${delivRow.review_token}`;
      try {
        await notifyClient(supabase, custRow.email, "payment_receipt", {
          order_title: order.title,
          amount: (order.amount_cents / 100).toFixed(0),
          currency: order.currency.toUpperCase(),
          review_url: reviewUrl,
          download_url: `${reviewUrl}/download`,
        });
      } catch (e) {
        console.error("[stripe-webhook] approve_pay client receipt failed", e);
      }
    }

    try {
      const { data: ownerProfile } = await supabase.auth.admin.getUserById(order.owner_id);
      const ownerEmail = ownerProfile?.user?.email;
      if (ownerEmail) {
        await notifyOwner(
          supabase,
          order.owner_id,
          "approval_received",
          ownerEmail,
          {
            order_title: order.title,
            amount: (order.amount_cents / 100).toFixed(0),
            currency: order.currency.toUpperCase(),
          },
          {
            kind: "order_paid",
            title: "Order paid",
            body: `${order.title} — $${(order.amount_cents / 100).toFixed(0)}`,
            orderId: order.id,
            linkPath: `/dashboard/orders/${order.id}`,
          },
        );
      }
    } catch (e) {
      console.error("[stripe-webhook] approve_pay owner notify failed", e);
    }

    return res.status(200).json({ ok: true });
  }

  // ─── Legacy onboarding-flow PaymentIntent ─────────────────────────────────
  // Orders created before Phase 2 still drain through here.
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
