import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import { generateToken } from "../../../lib/portal/tokens.js";
import { getPortalBaseUrl } from "../../../lib/portal/stripe.js";
import { sendEmail, emailShell } from "../../../lib/portal/email.js";

const ORDER_SELECT =
  "id, customer_id, title, description, amount_cents, currency, line_items, status, onboarding_token, stripe_invoice_id, stripe_invoice_url, paid_at, created_at, updated_at";

interface LineItem {
  description: string;
  amount_cents: number;
  quantity: number;
}

function parseLineItems(raw: unknown): LineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: LineItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    if (typeof i.description !== "string" || typeof i.amount_cents !== "number") continue;
    out.push({
      description: i.description,
      amount_cents: Math.round(i.amount_cents),
      quantity: typeof i.quantity === "number" && i.quantity > 0 ? Math.round(i.quantity) : 1,
    });
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const supabase = getSupabase();

  // ─── List orders for this owner ────────────────────────────────────────
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("portal_orders")
      .select(`${ORDER_SELECT}, customer:portal_customers(id, email, first_name, last_name, business_name)`)
      .eq("owner_id", auth.user.id)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ orders: data ?? [] });
  }

  // ─── Create new order ──────────────────────────────────────────────────
  if (req.method === "POST") {
    const b = (req.body ?? {}) as Record<string, unknown>;

    const customer_email = typeof b.customer_email === "string" ? b.customer_email.trim().toLowerCase() : "";
    const customer_first_name = typeof b.customer_first_name === "string" ? b.customer_first_name.trim() : "";
    const customer_last_name = typeof b.customer_last_name === "string" ? b.customer_last_name.trim() : "";
    const title = typeof b.title === "string" ? b.title.trim() : "";
    const description = typeof b.description === "string" ? b.description.trim() : "";
    const amount_cents = typeof b.amount_cents === "number" ? Math.round(b.amount_cents) : NaN;

    if (!customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
      return res.status(400).json({ error: "Valid customer_email required" });
    }
    if (!customer_first_name || !customer_last_name) {
      return res.status(400).json({ error: "customer_first_name and customer_last_name required" });
    }
    if (!title) return res.status(400).json({ error: "title required" });
    if (!Number.isFinite(amount_cents) || amount_cents <= 0) {
      return res.status(400).json({ error: "amount_cents must be a positive integer" });
    }

    const line_items = parseLineItems(b.line_items);
    const sumLines = line_items.reduce((s, li) => s + li.amount_cents * li.quantity, 0);
    if (line_items.length > 0 && sumLines !== amount_cents) {
      return res.status(400).json({
        error: `Line items sum (${sumLines}¢) doesn't match amount_cents (${amount_cents}¢)`,
      });
    }

    // Upsert customer (one per (owner, email))
    const { data: existingCustomer } = await supabase
      .from("portal_customers")
      .select("id, stripe_customer_id, onboarded_at, first_name, last_name")
      .eq("owner_id", auth.user.id)
      .eq("email", customer_email)
      .maybeSingle();

    let customer_id: string;
    let already_onboarded = false;
    if (existingCustomer) {
      customer_id = existingCustomer.id;
      already_onboarded = existingCustomer.onboarded_at != null;
    } else {
      const { data: created, error: custErr } = await supabase
        .from("portal_customers")
        .insert({
          owner_id: auth.user.id,
          email: customer_email,
          first_name: customer_first_name,
          last_name: customer_last_name,
        })
        .select("id, stripe_customer_id, onboarded_at")
        .single();
      if (custErr || !created) {
        return res.status(500).json({ error: custErr?.message ?? "Failed to create customer" });
      }
      customer_id = created.id;
    }

    // Generate onboarding token (skipped if customer already onboarded — we go
    // straight to Stripe invoice creation in that case, handled below).
    const onboarding_token = already_onboarded ? null : generateToken();
    const initial_status = already_onboarded ? "awaiting_payment" : "awaiting_onboarding";

    const { data: order, error: ordErr } = await supabase
      .from("portal_orders")
      .insert({
        owner_id: auth.user.id,
        customer_id,
        title,
        description: description || null,
        amount_cents,
        currency: "usd",
        line_items,
        status: initial_status,
        onboarding_token,
      })
      .select(ORDER_SELECT)
      .single();
    if (ordErr || !order) {
      return res.status(500).json({ error: ordErr?.message ?? "Failed to create order" });
    }

    // Send onboarding email if needed
    const portalBase = getPortalBaseUrl();
    if (!already_onboarded && onboarding_token) {
      const onboardUrl = `${portalBase}/onboard/${onboarding_token}`;
      const greeting = customer_first_name ? `Hi ${customer_first_name},` : "Hi,";
      try {
        await sendEmail({
          to: customer_email,
          subject: `Confirm your details for "${title}"`,
          html: emailShell({
            heading: `Order ready: ${title}`,
            body: `<p>${greeting}</p><p>Your order is queued and ready to start. Click below to confirm your billing details — once that's done you'll receive a Stripe invoice for <strong>$${(amount_cents / 100).toFixed(2)}</strong>.</p>`,
            cta: { label: "Confirm details", url: onboardUrl },
          }),
        });
      } catch (e) {
        console.error("[orders] failed to send onboarding email", e);
        // Order is still created — owner can resend.
      }
    }

    return res.status(201).json({ order, onboarding_url: onboarding_token ? `${portalBase}/onboard/${onboarding_token}` : null });
  }

  res.status(405).json({ error: "Method not allowed" });
}
