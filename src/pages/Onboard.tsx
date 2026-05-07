import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Check, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  fetchOnboardingSummary,
  submitOnboarding,
  type OnboardOrderSummary,
} from "@/lib/portalApi";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export default function Onboard() {
  const { token } = useParams<{ token: string }>();

  const [summary, setSummary] = useState<OnboardOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // form state
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postal, setPostal] = useState("");
  const [country, setCountry] = useState("US");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchOnboardingSummary(token)
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setBusinessName(s.customer.business_name ?? "");
        setPhone(s.customer.phone ?? "");
        setLine1(s.customer.address_line1 ?? "");
        setLine2(s.customer.address_line2 ?? "");
        setCity(s.customer.address_city ?? "");
        setState(s.customer.address_state ?? "");
        setPostal(s.customer.address_postal_code ?? "");
        setCountry(s.customer.address_country ?? "US");
        if (s.order.status !== "awaiting_onboarding" && s.order.stripe_invoice_url) {
          setInvoiceUrl(s.order.stripe_invoice_url);
        }
      })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await submitOnboarding(token, {
        business_name: businessName.trim() || undefined,
        phone: phone.trim(),
        address_line1: line1.trim(),
        address_line2: line2.trim() || undefined,
        address_city: city.trim(),
        address_state: state.trim(),
        address_postal_code: postal.trim(),
        address_country: country.trim().toUpperCase(),
      });
      setInvoiceUrl(res.stripe_invoice_url);
      // Auto-redirect to Stripe-hosted invoice
      setTimeout(() => {
        window.location.href = res.stripe_invoice_url;
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError || !summary) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md border border-border bg-background p-12 text-center">
          <span className="label text-muted-foreground">— Link expired</span>
          <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em]">This link is no longer active</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            {loadError ?? "Please reach out to whoever sent it for a fresh link."}
          </p>
        </div>
      </div>
    );
  }

  // Already onboarded → show "go to invoice" CTA
  if (invoiceUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="max-w-md border border-border bg-background p-12 text-center"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-foreground bg-foreground text-background">
            <Check className="h-5 w-5" />
          </div>
          <span className="label mt-6 block text-muted-foreground">— All set</span>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">Redirecting to your invoice…</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            If nothing happens, click below.
          </p>
          <a
            href={invoiceUrl}
            className="mt-8 inline-flex items-center gap-2 border border-foreground bg-foreground px-6 py-3 text-sm font-medium text-background"
          >
            Open invoice <ExternalLink className="h-4 w-4" />
          </a>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
        className="mx-auto max-w-2xl"
      >
        <div className="mb-12">
          <span className="label text-muted-foreground">— Listing Elevate</span>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
            Confirm your billing details
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Hi {summary.customer.first_name} — your order is ready. Confirm your details below and you'll get a Stripe
            invoice for <strong>${(summary.order.amount_cents / 100).toFixed(2)}</strong>.
          </p>
        </div>

        <div className="mb-12 border border-border p-8">
          <span className="label text-muted-foreground">— Order</span>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.01em]">{summary.order.title}</h2>
          {summary.order.description && (
            <p className="mt-3 text-sm text-muted-foreground">{summary.order.description}</p>
          )}
          <div className="mt-6 border-t border-border pt-6">
            {summary.order.line_items.length === 0 ? (
              <div className="flex items-baseline justify-between">
                <span className="text-sm">{summary.order.title}</span>
                <span className="tabular text-sm font-medium">
                  ${(summary.order.amount_cents / 100).toFixed(2)}
                </span>
              </div>
            ) : (
              <ul className="space-y-3">
                {summary.order.line_items.map((li, i) => (
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
            <div className="mt-6 flex items-baseline justify-between border-t border-border pt-4">
              <span className="label text-muted-foreground">Total</span>
              <span className="tabular text-2xl font-semibold tracking-[-0.02em]">
                ${(summary.order.amount_cents / 100).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <section className="space-y-4">
            <span className="label text-muted-foreground">— Billing</span>
            <div>
              <label className="label mb-2 block">Business name (optional)</label>
              <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Studios LLC" />
            </div>
            <div>
              <label className="label mb-2 block">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" required />
            </div>
            <div>
              <label className="label mb-2 block">Street address</label>
              <Input value={line1} onChange={(e) => setLine1(e.target.value)} required />
            </div>
            <div>
              <label className="label mb-2 block">Apartment / suite (optional)</label>
              <Input value={line2} onChange={(e) => setLine2(e.target.value)} />
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_120px_140px]">
              <div>
                <label className="label mb-2 block">City</label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} required />
              </div>
              <div>
                <label className="label mb-2 block">State</label>
                <Input value={state} onChange={(e) => setState(e.target.value)} required />
              </div>
              <div>
                <label className="label mb-2 block">Postal code</label>
                <Input value={postal} onChange={(e) => setPostal(e.target.value)} required />
              </div>
            </div>
            <div className="max-w-[200px]">
              <label className="label mb-2 block">Country</label>
              <Input
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="US"
                required
              />
              <p className="mt-2 text-xs text-muted-foreground">2-letter code (US, CA, GB, etc.)</p>
            </div>
          </section>

          {error && (
            <div className="border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
          )}

          <Button type="submit" disabled={submitting} className="min-w-[220px]">
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Confirm + view invoice
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
