import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Check, ExternalLink, MapPin } from "lucide-react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  fetchOnboardingSummary,
  submitOnboarding,
  type OnboardOrderSummary,
} from "@/lib/portalApi";
import { loadGoogleMaps, parsePlaceToAddress } from "@/lib/googleMaps";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export default function Onboard() {
  const { token } = useParams<{ token: string }>();

  const [summary, setSummary] = useState<OnboardOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state — grouped by section visually but flat for the API.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postal, setPostal] = useState("");
  const [country, setCountry] = useState("US");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);

  const [autocompleteReady, setAutocompleteReady] = useState(false);
  const addressInputRef = useRef<HTMLInputElement | null>(null);

  // Load existing customer data into form
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchOnboardingSummary(token)
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setFirstName(s.customer.first_name ?? "");
        setLastName(s.customer.last_name ?? "");
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

  // Attach Google Places Autocomplete to the street address input once both
  // the maps script and the input are ready.
  useEffect(() => {
    let mounted = true;
    loadGoogleMaps().then((ok) => {
      if (!mounted || !ok || !addressInputRef.current) return;
      const places = window.google?.maps?.places;
      if (!places) return;
      const ac = new places.Autocomplete(addressInputRef.current, {
        types: ["address"],
        fields: ["address_components", "formatted_address"],
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        const parsed = parsePlaceToAddress(place);
        if (parsed.line1) setLine1(parsed.line1);
        if (parsed.city) setCity(parsed.city);
        if (parsed.state) setState(parsed.state);
        if (parsed.postal_code) setPostal(parsed.postal_code);
        if (parsed.country) setCountry(parsed.country);
      });
      setAutocompleteReady(true);
    });
    return () => { mounted = false; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitOnboarding(token, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
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

        <form onSubmit={handleSubmit} className="space-y-12">
          {/* ─── 1. Billing address (with Google Places autocomplete) ──── */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="label text-muted-foreground">— Billing address</span>
              {autocompleteReady && (
                <span className="label inline-flex items-center gap-1 text-muted-foreground/70">
                  <MapPin className="h-3 w-3" /> Suggestions live
                </span>
              )}
            </div>
            <div>
              <label className="label mb-2 block">Street address</label>
              <Input
                ref={addressInputRef}
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                placeholder={autocompleteReady ? "Start typing to search…" : "123 Main St"}
                autoComplete="address-line1"
                required
              />
            </div>
            <div>
              <label className="label mb-2 block">Apartment / suite (optional)</label>
              <Input
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
                autoComplete="address-line2"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_120px_140px]">
              <div>
                <label className="label mb-2 block">City</label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" required />
              </div>
              <div>
                <label className="label mb-2 block">State</label>
                <Input value={state} onChange={(e) => setState(e.target.value)} autoComplete="address-level1" required />
              </div>
              <div>
                <label className="label mb-2 block">Postal code</label>
                <Input value={postal} onChange={(e) => setPostal(e.target.value)} autoComplete="postal-code" required />
              </div>
            </div>
            <div className="max-w-[200px]">
              <label className="label mb-2 block">Country</label>
              <Input
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="US"
                autoComplete="country"
                required
              />
              <p className="mt-2 text-xs text-muted-foreground">2-letter code (US, CA, GB, etc.)</p>
            </div>
          </section>

          {/* ─── 2. Customer name ────────────────────────────────────────── */}
          <section className="space-y-4 border-t border-border pt-12">
            <span className="label text-muted-foreground">— Customer name</span>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="label mb-2 block">First name</label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" required />
              </div>
              <div>
                <label className="label mb-2 block">Last name</label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" required />
              </div>
            </div>
            <div>
              <label className="label mb-2 block">Phone</label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                autoComplete="tel"
                inputMode="tel"
                required
              />
            </div>
          </section>

          {/* ─── 3. Legal business name ──────────────────────────────────── */}
          <section className="space-y-4 border-t border-border pt-12">
            <span className="label text-muted-foreground">— Legal business name</span>
            <div>
              <label className="label mb-2 block">Business name (optional)</label>
              <Input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Acme Studios LLC"
                autoComplete="organization"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                If you're billing under a company, enter the legal entity name. Leave blank if you're billing as an
                individual.
              </p>
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
