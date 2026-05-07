import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { createOrder } from "@/lib/portalApi";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

interface LineItemRow {
  description: string;
  amountDollars: string;
  quantity: string;
}

export default function OrderNew() {
  const navigate = useNavigate();

  const [customerEmail, setCustomerEmail] = useState("");
  const [customerFirstName, setCustomerFirstName] = useState("");
  const [customerLastName, setCustomerLastName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [flatAmountDollars, setFlatAmountDollars] = useState("");
  const [useLineItems, setUseLineItems] = useState(false);
  const [lineItems, setLineItems] = useState<LineItemRow[]>([
    { description: "", amountDollars: "", quantity: "1" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addLine() {
    setLineItems((rows) => [...rows, { description: "", amountDollars: "", quantity: "1" }]);
  }
  function removeLine(idx: number) {
    setLineItems((rows) => rows.filter((_, i) => i !== idx));
  }
  function updateLine(idx: number, patch: Partial<LineItemRow>) {
    setLineItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  const computedTotalCents = useLineItems
    ? lineItems.reduce((sum, li) => {
        const amt = Math.round(parseFloat(li.amountDollars || "0") * 100);
        const qty = parseInt(li.quantity || "1", 10) || 1;
        return sum + (Number.isFinite(amt) ? amt * qty : 0);
      }, 0)
    : Math.round(parseFloat(flatAmountDollars || "0") * 100);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!customerEmail || !customerFirstName || !customerLastName || !title) {
      setError("Customer name, email, and order title are all required.");
      return;
    }
    if (!Number.isFinite(computedTotalCents) || computedTotalCents <= 0) {
      setError("Order amount must be greater than $0.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        customer_email: customerEmail.trim().toLowerCase(),
        customer_first_name: customerFirstName.trim(),
        customer_last_name: customerLastName.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        amount_cents: computedTotalCents,
        line_items: useLineItems
          ? lineItems
              .filter((li) => li.description.trim() && parseFloat(li.amountDollars || "0") > 0)
              .map((li) => ({
                description: li.description.trim(),
                amount_cents: Math.round(parseFloat(li.amountDollars) * 100),
                quantity: parseInt(li.quantity || "1", 10) || 1,
              }))
          : undefined,
      };
      const { order, onboarding_url } = await createOrder(payload);
      toast.success(
        onboarding_url
          ? `Order created — onboarding link sent to ${customerEmail}`
          : "Order created — customer already onboarded, Stripe invoice next"
      );
      navigate(`/dashboard/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-12">
      <div>
        <Link
          to="/dashboard"
          className="label inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to overview
        </Link>
        <span className="label mt-8 block text-muted-foreground">— New order</span>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] md:text-3xl">Create a deliverable order</h2>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Enter the client's email + name and the order amount. We'll send them a link to confirm
          billing details, then Stripe issues an invoice. Once paid, you can upload deliverables.
        </p>
      </div>

      <motion.form
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        onSubmit={handleSubmit}
        className="space-y-12"
      >
        {/* Customer */}
        <section className="space-y-6">
          <span className="label text-muted-foreground">— Client</span>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="label mb-2 block text-foreground">First name</label>
              <Input value={customerFirstName} onChange={(e) => setCustomerFirstName(e.target.value)} required />
            </div>
            <div>
              <label className="label mb-2 block text-foreground">Last name</label>
              <Input value={customerLastName} onChange={(e) => setCustomerLastName(e.target.value)} required />
            </div>
            <div className="md:col-span-2">
              <label className="label mb-2 block text-foreground">Email</label>
              <Input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                required
              />
              <p className="mt-2 text-xs text-muted-foreground">
                We'll send the onboarding link here. If they've ordered before we'll skip onboarding and go
                straight to invoice.
              </p>
            </div>
          </div>
        </section>

        {/* Order */}
        <section className="space-y-6 border-t border-border pt-12">
          <span className="label text-muted-foreground">— Order</span>
          <div>
            <label className="label mb-2 block text-foreground">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Podcast Ep 47 — Main video"
              required
            />
          </div>
          <div>
            <label className="label mb-2 block text-foreground">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="Internal notes for the invoice"
            />
          </div>

          {/* Pricing */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setUseLineItems(false)}
              className={`label px-4 py-2 transition-colors ${
                !useLineItems ? "border-b-2 border-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Flat amount
            </button>
            <button
              type="button"
              onClick={() => setUseLineItems(true)}
              className={`label px-4 py-2 transition-colors ${
                useLineItems ? "border-b-2 border-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Line items
            </button>
          </div>

          {!useLineItems ? (
            <div>
              <label className="label mb-2 block text-foreground">Amount (USD)</label>
              <div className="relative max-w-[220px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={flatAmountDollars}
                  onChange={(e) => setFlatAmountDollars(e.target.value)}
                  className="pl-7 tabular"
                  placeholder="0.00"
                  required={!useLineItems}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4 md:space-y-3">
              {lineItems.map((li, i) => (
                <div key={i} className="space-y-2 border border-border p-3 md:grid md:grid-cols-[1fr_140px_80px_40px] md:items-center md:gap-3 md:space-y-0 md:border-0 md:p-0">
                  <Input
                    value={li.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    placeholder="Description"
                  />
                  <div className="grid grid-cols-[1fr_80px_40px] gap-2 md:contents">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={li.amountDollars}
                        onChange={(e) => updateLine(i, { amountDollars: e.target.value })}
                        className="pl-7 tabular"
                        placeholder="0.00"
                      />
                    </div>
                    <Input
                      type="number"
                      min="1"
                      value={li.quantity}
                      onChange={(e) => updateLine(i, { quantity: e.target.value })}
                      className="tabular"
                    />
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="flex h-9 w-9 items-center justify-center text-muted-foreground hover:text-destructive"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addLine}
                className="label inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> Add line item
              </button>
            </div>
          )}

          <div className="border-t border-border pt-6">
            <div className="flex items-baseline justify-between">
              <span className="label text-muted-foreground">Total</span>
              <span className="tabular text-2xl font-semibold tracking-[-0.02em]">
                ${(computedTotalCents / 100).toFixed(2)}
              </span>
            </div>
          </div>
        </section>

        {error && (
          <div className="border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
        )}

        <div className="flex items-center gap-4 border-t border-border pt-8">
          <Button type="submit" disabled={submitting} className="min-w-[180px]">
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create + send link
          </Button>
          <Link to="/dashboard" className="label text-muted-foreground hover:text-foreground">
            Cancel
          </Link>
        </div>
      </motion.form>
    </div>
  );
}
