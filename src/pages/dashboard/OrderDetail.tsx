import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Copy, ExternalLink, Mail } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { getOrder, formatStatus, formatOrderNumber, type PortalOrder } from "@/lib/portalApi";
import { getRelativeTime } from "@/lib/types";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const STAGES = [
  { key: "awaiting_onboarding", label: "Onboarding" },
  { key: "awaiting_payment", label: "Invoice" },
  { key: "paid", label: "Paid" },
  { key: "delivered", label: "Delivered" },
  { key: "approved", label: "Approved" },
] as const;

function stageIndex(status: PortalOrder["status"]): number {
  if (status === "awaiting_onboarding") return 0;
  if (status === "awaiting_payment") return 1;
  if (status === "paid" || status === "in_progress") return 2;
  if (status === "delivered" || status === "in_review" || status === "revision_requested") return 3;
  if (status === "approved") return 4;
  return -1;
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<PortalOrder | null>(null);
  const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getOrder(id)
      .then((res) => {
        if (cancelled) return;
        setOrder(res.order);
        setOnboardingUrl(res.onboarding_url);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  function copy(value: string, label: string) {
    navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`));
  }

  if (loading) {
    return (
      <div className="flex justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !order) {
    return <div className="border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">{error ?? "Not found"}</div>;
  }

  const idx = stageIndex(order.status);
  const customer = order.customer;
  const fmt = formatStatus(order.status);

  return (
    <div className="space-y-12">
      <div>
        <Link to="/dashboard/orders" className="label inline-flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> All orders
        </Link>
        <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 flex-1">
            <span className="label text-muted-foreground">— Order {formatOrderNumber(order.order_number)}</span>
            <h2 className="mt-3 break-words text-2xl font-semibold tracking-[-0.02em] md:text-3xl">{order.title}</h2>
            {order.description && <p className="mt-3 text-sm text-muted-foreground">{order.description}</p>}
          </div>
          <div className="text-left md:text-right">
            <div className="tabular text-3xl font-semibold tracking-[-0.02em]">
              ${(order.amount_cents / 100).toFixed(2)}
            </div>
            <p className="label mt-2 text-muted-foreground">{order.currency.toUpperCase()}</p>
          </div>
        </div>
      </div>

      {/* Stage timeline — horizontal on tablet+, compact dot row on mobile */}
      <section className="border border-border p-6 md:p-8">
        <span className="label text-muted-foreground">— Stage</span>

        {/* Mobile: simple dot row + current label */}
        <div className="mt-6 md:hidden">
          <div className="flex items-center gap-2">
            {STAGES.map((s, i) => {
              const reached = i <= idx;
              return (
                <div key={s.key} className="flex flex-1 items-center gap-2">
                  <div
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      reached ? "bg-foreground" : "bg-border"
                    }`}
                  />
                  {i < STAGES.length - 1 && (
                    <div className={`h-px flex-1 ${i < idx ? "bg-foreground" : "bg-border"}`} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4">
            <span className="label text-muted-foreground">Step {Math.max(idx, 0) + 1} of {STAGES.length}</span>
            <p className="mt-1 text-sm font-medium">{STAGES[Math.max(idx, 0)]?.label ?? "—"}</p>
          </div>
        </div>

        {/* Tablet+: full horizontal timeline */}
        <div className="mt-6 hidden items-center gap-4 md:flex">
          {STAGES.map((s, i) => {
            const reached = i <= idx;
            const current = i === idx;
            return (
              <div key={s.key} className="flex flex-1 items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                      reached ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"
                    }`}
                  >
                    <span className="tabular text-xs font-medium">{i + 1}</span>
                  </div>
                  <span className={`label mt-3 ${current ? "text-foreground" : "text-muted-foreground"}`}>
                    {s.label}
                  </span>
                </div>
                {i < STAGES.length - 1 && (
                  <motion.div
                    className="mx-3 h-px flex-1 bg-border"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: i < idx ? 1 : 0.2 }}
                    transition={{ duration: 1, ease: EASE }}
                    style={{ transformOrigin: "left" }}
                  >
                    {i < idx && <div className="h-full bg-foreground" />}
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-baseline gap-3 border-t border-border pt-4 md:border-t-0 md:pt-0">
          <span className="label text-muted-foreground">Status</span>
          <span className="text-sm font-medium">{fmt.label}</span>
          {order.paid_at && (
            <span className="tabular ml-auto text-xs text-muted-foreground">
              Paid {getRelativeTime(order.paid_at)}
            </span>
          )}
        </div>
      </section>

      {/* Action card depending on stage */}
      {order.status === "awaiting_onboarding" && onboardingUrl && (
        <section className="border border-amber-600/40 bg-amber-600/5 p-8">
          <span className="label text-amber-600">— Awaiting client</span>
          <h3 className="mt-3 text-lg font-semibold tracking-[-0.01em]">
            Onboarding link is live
          </h3>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            We sent this link to <strong>{customer?.email}</strong>. They confirm billing details, then Stripe issues
            the invoice. You can re-share if needed.
          </p>
          <div className="mt-6 space-y-3">
            <code className="tabular block w-full overflow-x-auto whitespace-nowrap border border-border bg-background px-3 py-2 text-xs">
              {onboardingUrl}
            </code>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => copy(onboardingUrl, "Link")}
                className="label inline-flex items-center gap-2 border border-border px-3 py-2 hover:bg-secondary/40"
              >
                <Copy className="h-3 w-3" /> Copy
              </button>
              <a
                href={`mailto:${customer?.email}?subject=${encodeURIComponent(order.title)}&body=${encodeURIComponent(`Hi ${customer?.first_name ?? ""},\n\nHere's the link to confirm your details:\n${onboardingUrl}`)}`}
                className="label inline-flex items-center gap-2 border border-border px-3 py-2 hover:bg-secondary/40"
              >
                <Mail className="h-3 w-3" /> Email
              </a>
            </div>
          </div>
        </section>
      )}

      {order.stripe_invoice_url && (order.status === "awaiting_payment" || order.status === "paid") && (
        <section className="border border-border p-8">
          <span className="label text-muted-foreground">— Stripe</span>
          <h3 className="mt-3 text-lg font-semibold tracking-[-0.01em]">
            {order.status === "awaiting_payment" ? "Invoice issued" : "Invoice paid"}
          </h3>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            {order.status === "awaiting_payment"
              ? "Stripe has emailed the invoice to the client. We'll flip this order to Paid automatically when they pay."
              : "Payment confirmed by Stripe."}
          </p>
          <a
            href={order.stripe_invoice_url}
            target="_blank"
            rel="noreferrer"
            className="label mt-6 inline-flex items-center gap-2 text-foreground hover:opacity-70"
          >
            View invoice on Stripe <ExternalLink className="h-3 w-3" />
          </a>
        </section>
      )}

      {/* Customer + line items */}
      <section className="grid gap-px border border-border bg-border md:grid-cols-2">
        <div className="bg-background p-8">
          <span className="label text-muted-foreground">— Client</span>
          {customer ? (
            <>
              <h3 className="mt-3 text-lg font-semibold tracking-[-0.01em]">
                {customer.first_name} {customer.last_name}
              </h3>
              {customer.business_name && (
                <p className="mt-2 text-sm text-muted-foreground">{customer.business_name}</p>
              )}
              <p className="mt-4 text-sm text-foreground">{customer.email}</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">—</p>
          )}
        </div>
        <div className="bg-background p-8">
          <span className="label text-muted-foreground">— Line items</span>
          {order.line_items.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{order.title}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {order.line_items.map((li, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4">
                  <span className="text-sm">
                    {li.description}
                    {li.quantity > 1 && <span className="tabular ml-2 text-muted-foreground">× {li.quantity}</span>}
                  </span>
                  <span className="tabular text-sm font-medium">
                    ${((li.amount_cents * li.quantity) / 100).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Deliverables placeholder — Phase 2 */}
      <section className="border border-dashed border-border p-12 text-center">
        <span className="label text-muted-foreground">— Deliverables</span>
        <p className="mt-4 text-sm text-muted-foreground">
          {order.status === "paid" || order.status === "in_progress" || order.status === "delivered"
            ? "Upload deliverable — coming next session."
            : "Deliverable upload unlocks once the client pays."}
        </p>
      </section>
    </div>
  );
}
