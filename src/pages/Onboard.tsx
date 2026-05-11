import { useEffect, useMemo, useRef, useState, type ReactNode, type InputHTMLAttributes } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Check, User, Phone, MapPin, Building2, Globe2, Hash, Mail } from "lucide-react";
import { motion } from "framer-motion";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import {
  fetchOnboardingSummary,
  submitOnboarding,
  type OnboardOrderSummary,
} from "@/lib/portalApi";
import { loadGoogleMaps, parsePlaceToAddress } from "@/lib/googleMaps";

// Singleton Stripe.js loader. Returns null if the publishable key isn't
// configured — the embedded checkout view shows a clear error in that case.
let stripeSingleton: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> {
  if (stripeSingleton) return stripeSingleton;
  const pk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
  if (!pk) {
    console.warn("[Onboard] VITE_STRIPE_PUBLISHABLE_KEY not set — embedded checkout disabled");
    stripeSingleton = Promise.resolve(null);
    return stripeSingleton;
  }
  stripeSingleton = loadStripe(pk);
  return stripeSingleton;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ─── Field primitive ────────────────────────────────────────────────────────
// Editorial monochrome input with an icon slot on the left, label above,
// and an optional hint underneath. Borrows the icon-in-field affordance
// from the reference design without picking up its rounded/blue chrome.
interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  icon?: ReactNode;
  hint?: string;
  /** Ref passthrough (for the Google Places attachment). */
  inputRef?: React.Ref<HTMLInputElement>;
}

function Field({ label, icon, hint, inputRef, className, ...rest }: FieldProps) {
  return (
    <label className="block">
      <span className="label mb-2 block text-muted-foreground">{label}</span>
      <span className="relative block">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70">
            {icon}
          </span>
        )}
        <input
          ref={inputRef}
          {...rest}
          className={[
            "h-11 w-full border border-border bg-background text-sm",
            "placeholder:text-muted-foreground/60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:border-foreground/40",
            "transition-colors",
            icon ? "pl-10" : "pl-3",
            "pr-3",
            className ?? "",
          ].join(" ")}
        />
      </span>
      {hint && <span className="mt-2 block text-xs text-muted-foreground/70">{hint}</span>}
    </label>
  );
}

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
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentComplete, setPaymentComplete] = useState(false);

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
        // No-op: if the order is past onboarding we'll let the user
        // re-submit to get a fresh client_secret from the API (which retrieves
        // the existing session). This avoids the form being permanently
        // locked if a payment was abandoned partway.
      })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  // Attach Google Places Autocomplete to the street address input.
  // Silent if the Maps script isn't available — user can still type manually.
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
      setClientSecret(res.client_secret);
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

  // ─── Payment complete (set by EmbeddedCheckout's onComplete callback) ──
  if (paymentComplete) {
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
          <span className="label mt-6 block text-muted-foreground">— Payment received</span>
          <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">Thanks {summary.customer.first_name}!</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Your payment for <strong className="text-foreground">{summary.order.title}</strong> went through.
            We'll get to work and email you when the deliverable is ready.
          </p>
          <p className="mt-6 text-xs text-muted-foreground">A Stripe receipt will arrive at {summary.customer.email}.</p>
        </motion.div>
      </div>
    );
  }

  const ICON_CLS = "h-4 w-4";

  // ─── Embedded Stripe Checkout view ───────────────────────────────────
  // Mounted as soon as the API returns a client_secret. Stripe's iframe
  // handles card / Apple Pay / Link inside our page. onComplete fires when
  // the charge succeeds; redirect_on_completion='never' on the session keeps
  // the user on our origin.
  if (clientSecret) {
    return (
      <CheckoutView
        clientSecret={clientSecret}
        summary={summary}
        onComplete={() => setPaymentComplete(true)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background px-6 py-12 md:py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
        className="mx-auto max-w-2xl"
      >
        {/* ─── Header ────────────────────────────────────────────────── */}
        <div className="mb-10">
          <span className="label text-muted-foreground">— Listing Elevate</span>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
            Confirm your details
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Hi {summary.customer.first_name} — your order is ready. Fill in the details below and you'll receive a
            Stripe invoice for <strong className="text-foreground">${(summary.order.amount_cents / 100).toFixed(2)}</strong>.
          </p>
        </div>

        {/* ─── Order summary card ────────────────────────────────────── */}
        <div className="mb-12 border border-border bg-background p-6 md:p-8">
          <div className="flex items-baseline justify-between">
            <span className="label text-muted-foreground">— Order</span>
            <span className="tabular text-xs text-muted-foreground">
              {summary.order.currency.toUpperCase()}
            </span>
          </div>
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

        {/* ─── Single continuous form (no section grouping) ──────────── */}
        <form onSubmit={handleSubmit} className="border border-border bg-background p-6 md:p-10">
          <span className="label text-muted-foreground">— Customer details</span>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.01em] md:text-2xl">
            We need a few things before we send your invoice
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Enter your name (or company name) plus a billing address. Required for Stripe.
          </p>

          <div className="mt-8 space-y-5">
            {/* Row 1 — First name + Last name */}
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="First name"
                icon={<User className={ICON_CLS} />}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                required
              />
              <Field
                label="Last name"
                icon={<User className={ICON_CLS} />}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                required
              />
            </div>

            {/* Row 2 — Business name */}
            <Field
              label="Business name"
              icon={<Building2 className={ICON_CLS} />}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Optional"
              autoComplete="organization"
              hint="Leave blank if billing as an individual."
            />

            {/* Row 3 — Email + Phone */}
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Email address"
                icon={<Mail className={ICON_CLS} />}
                value={summary.customer.email}
                readOnly
                className="cursor-not-allowed bg-secondary/40 text-muted-foreground"
                aria-readonly
              />
              <Field
                label="Phone number"
                icon={<Phone className={ICON_CLS} />}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                autoComplete="tel"
                inputMode="tel"
                type="tel"
                required
              />
            </div>

            {/* Row 4 — Street address (Places autocomplete) */}
            <Field
              label="Address"
              icon={<MapPin className={ICON_CLS} />}
              inputRef={addressInputRef}
              value={line1}
              onChange={(e) => setLine1(e.target.value)}
              placeholder="Start typing your address"
              autoComplete="address-line1"
              required
            />

            {/* Row 5 — Apt/suite (optional, full width) */}
            <Field
              label="Apartment / suite"
              value={line2}
              onChange={(e) => setLine2(e.target.value)}
              placeholder="Optional"
              autoComplete="address-line2"
            />

            {/* Row 6 — Country + State + Postal */}
            <div className="grid gap-4 md:grid-cols-[160px_1fr_140px]">
              <Field
                label="Country"
                icon={<Globe2 className={ICON_CLS} />}
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="US"
                autoComplete="country"
                required
              />
              <Field
                label="State / province"
                value={state}
                onChange={(e) => setState(e.target.value)}
                autoComplete="address-level1"
                required
              />
              <Field
                label="Postal code"
                icon={<Hash className={ICON_CLS} />}
                value={postal}
                onChange={(e) => setPostal(e.target.value)}
                autoComplete="postal-code"
                required
              />
            </div>

            {/* City sits on its own row because Country/State/Postal already
                take a tight 3-column layout. */}
            <Field
              label="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              autoComplete="address-level2"
              required
            />
          </div>

          {error && (
            <div className="mt-8 border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
          )}

          <div className="mt-10 flex flex-col-reverse gap-3 border-t border-border pt-6 md:flex-row md:items-center md:justify-between">
            <p className="text-xs text-muted-foreground">
              Payment is processed by Stripe. We never see your card.
            </p>
            <Button type="submit" disabled={submitting} className="min-w-[220px]">
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Continue to payment
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── CheckoutView ───────────────────────────────────────────────────────────
// Renders Stripe's embedded checkout under our editorial header + order
// summary. Customer never leaves portal.listingelevate.com — the iframe stays
// inside this page.
function CheckoutView({
  clientSecret,
  summary,
  onComplete,
}: {
  clientSecret: string;
  summary: OnboardOrderSummary;
  onComplete: () => void;
}) {
  // `fetchClientSecret` is the Stripe-recommended way to pass the secret —
  // they call this once when mounting the embedded checkout. We've already
  // fetched it from our backend; just hand it back synchronously.
  const options = useMemo(
    () => ({
      clientSecret,
      onComplete,
    }),
    [clientSecret, onComplete]
  );

  const stripePromise = useMemo(() => getStripePromise(), []);

  return (
    <div className="min-h-screen bg-background px-6 py-12 md:py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
        className="mx-auto max-w-2xl"
      >
        <div className="mb-10">
          <span className="label text-muted-foreground">— Listing Elevate</span>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] md:text-4xl">Complete payment</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Total <strong className="text-foreground">${(summary.order.amount_cents / 100).toFixed(2)}</strong> for {summary.order.title}.
          </p>
        </div>

        <div className="border border-border bg-background p-4 md:p-6">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Secured by Stripe. We never see your card details.
        </p>
      </motion.div>
    </div>
  );
}
