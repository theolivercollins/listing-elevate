import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { supabase } from "@/lib/supabase";
import { approve, getOrderStatus } from "@/lib/reviewApi";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!);

interface Props {
  token: string;
  amountCents: number;
  currency: string;
  onClose: () => void;
  onPaid: () => void;
}

export function PaymentPanel({ token, amountCents, currency, onClose, onPaid }: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        if (!session) { setError("Sign in required"); return; }
        const { client_secret } = await approve(token, session.access_token);
        setClientSecret(client_secret);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [token]);

  if (error) return <div style={{ padding: 18 }}><p style={{ color: "oklch(0.58 0.17 25)", fontFamily: "var(--le-font-mono)", fontSize: 12 }}>ERR {error}</p><button onClick={onClose}>Back</button></div>;
  if (!clientSecret) return <div style={{ padding: 18 }} className="le-shimmer">Preparing payment…</div>;

  return (
    <div style={{ padding: 24 }}>
      <div className="le-eyebrow"><span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />Approve & pay {(amountCents / 100).toFixed(0)} {currency.toUpperCase()}</div>
      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "flat" } }}>
        <PaymentForm token={token} onPaid={onPaid} onCancel={onClose} />
      </Elements>
    </div>
  );
}

function PaymentForm({ token, onPaid, onCancel }: { token: string; onPaid: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setError(null);
    const { error } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { setError(error.message ?? "payment failed"); setBusy(false); return; }
    // Poll status until webhook flips order to paid (up to 30s).
    for (let i = 0; i < 15; i++) {
      const status = await getOrderStatus(token);
      if (status === "paid") { onPaid(); return; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    setError("Payment succeeded but order not flipped yet — refresh in a moment.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 14 }}>
      <PaymentElement />
      {error && <p style={{ color: "oklch(0.58 0.17 25)", fontFamily: "var(--le-font-mono)", fontSize: 12, marginTop: 8 }}>ERR {error}</p>}
      <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
        <button type="button" onClick={onCancel} style={{ background: "transparent", border: "1px solid var(--le-border-strong)", padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
        <button type="submit" disabled={!stripe || busy} style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "10px 16px", fontSize: 13, cursor: "pointer", opacity: busy ? 0.4 : 1 }}>
          {busy ? "Processing…" : "Pay"}
        </button>
      </div>
    </form>
  );
}
