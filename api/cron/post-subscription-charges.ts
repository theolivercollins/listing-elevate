import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../lib/client.js";

// POST /api/cron/post-subscription-charges
//
// Runs daily. Finds active subscriptions where next_charge_at <= today,
// posts a row to cost_events (scope=subscription) and expenses, then
// advances next_charge_at by 1 month or 1 year.
//
// NOT wired in vercel.json — enable manually once migration 064 is applied.

export const maxDuration = 60;

function advanceDate(dateStr: string, period: "monthly" | "yearly"): string {
  const d = new Date(dateStr);
  if (period === "monthly") {
    d.setMonth(d.getMonth() + 1);
  } else {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false });
  }
  if (process.env.VERCEL_ENV !== "production") {
    return res.status(200).json({ ok: true, skipped: "non-prod" });
  }

  const supabase = getSupabase();
  const today = new Date().toISOString().slice(0, 10);

  // Find subscriptions due today or overdue
  const { data: due, error: fetchErr } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("status", "active")
    .lte("next_charge_at", today);

  if (fetchErr) {
    console.error("[post-subscription-charges] fetch error", fetchErr);
    return res.status(500).json({ ok: false, error: fetchErr.message });
  }

  const charged: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const sub of due ?? []) {
    try {
      // 1. Write cost_event
      const { error: ceErr } = await supabase.from("cost_events").insert({
        stage: "assembly", // closest available stage; subscription is a meta-stage
        provider: sub.provider,
        units_consumed: 1,
        unit_type: "credits",
        cost_cents: sub.amount_cents,
        metadata: {
          scope: "subscription",
          subscription_id: sub.id,
          billing_period: sub.billing_period,
          charge_date: today,
        },
      });
      if (ceErr) throw ceErr;

      // 2. Write expense for ledger visibility
      const { error: expErr } = await supabase.from("expenses").insert({
        category: `Subscription — ${sub.provider}`,
        amount_cents: sub.amount_cents,
        description: sub.note
          ? `${sub.billing_period} charge · ${sub.note}`
          : `${sub.billing_period} charge`,
        incurred_at: new Date(today).toISOString(),
      });
      if (expErr) throw expErr;

      // 3. Advance next_charge_at
      const nextDate = advanceDate(sub.next_charge_at, sub.billing_period as "monthly" | "yearly");
      const { error: updErr } = await supabase
        .from("subscriptions")
        .update({ next_charge_at: nextDate, updated_at: new Date().toISOString() })
        .eq("id", sub.id);
      if (updErr) throw updErr;

      charged.push(sub.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[post-subscription-charges] error on sub ${sub.id}:`, msg);
      errors.push({ id: sub.id, error: msg });
    }
  }

  return res.status(200).json({
    ok: true,
    charged: charged.length,
    errors: errors.length,
    details: { charged, errors },
  });
}
