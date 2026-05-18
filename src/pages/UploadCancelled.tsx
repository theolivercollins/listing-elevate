/**
 * /upload/cancelled — Stripe Checkout cancellation landing page.
 *
 * Stripe redirects here when the customer closes Checkout without paying
 * (or hits the back arrow). The property row stays in 'pending_payment',
 * photos are preserved. "Complete my order" re-creates a session via
 * POST /api/properties/:id/resume-checkout.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { resumeCheckout } from "@/lib/api";
import { SiteNav } from "@/v2/components/SiteNav";
import "@/v3/styles/glass.css";

const EASE = [0.2, 0.8, 0.2, 1] as const;

/**
 * Map a server / network error to a sentence a customer can act on. The raw
 * "API error 404: NOT_FOUND iad1::…" string Stripe's back-button used to
 * surface here was a UX failure — no human knows what to do with that.
 */
function friendlyMessage(raw: string): string {
  if (/\b404\b|not found/i.test(raw)) {
    return "We couldn't find this order anymore. Start a fresh upload below — your previous photos are still safe in your account.";
  }
  if (/\b403\b|not authori[sz]ed/i.test(raw)) {
    return "You're signed in as a different user than the one who created this order. Sign in with the original account, or start a new order below.";
  }
  if (/\b409\b/i.test(raw)) {
    return "This order has already moved past checkout. Check your dashboard for its status.";
  }
  if (/network|failed to fetch|offline/i.test(raw)) {
    return "We couldn't reach our checkout server. Check your connection and try again.";
  }
  return "Something went wrong restarting checkout. Try again in a moment, or start a fresh order below.";
}

export default function UploadCancelled() {
  const [searchParams] = useSearchParams();
  const propertyId = searchParams.get("property_id");

  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRetry = async () => {
    if (!propertyId) {
      // No property ID in the URL — nothing to resume, send them back to the form.
      window.location.href = "/upload";
      return;
    }
    setRetrying(true);
    setError(null);
    try {
      const { checkoutUrl } = await resumeCheckout(propertyId);
      if (!checkoutUrl) throw new Error("No checkout URL returned");
      window.location.href = checkoutUrl;
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      console.error("[UploadCancelled] resumeCheckout failed:", raw);
      setError(friendlyMessage(raw));
      setRetrying(false);
    }
  };

  return (
    <div
      className="glass-page"
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        paddingTop: 92,
      }}
    >
      <SiteNav showSectionLinks={false} solid />
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "96px 24px",
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE }}
          style={{ width: "100%", maxWidth: 420, textAlign: "center" }}
        >
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.8, ease: EASE }}
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "rgba(196, 74, 74, 0.1)",
              border: "1px solid rgba(196, 74, 74, 0.3)",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 36px",
              color: "var(--bad)",
            }}
          >
            <AlertCircle size={32} strokeWidth={1.5} />
          </motion.div>
          <p className="g-label" style={{ marginBottom: 12 }}>
            Payment cancelled
          </p>
          <h1
            style={{
              margin: 0,
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              color: "var(--ink)",
              lineHeight: 1.1,
            }}
          >
            No charge made.
            <br />
            Photos saved.
          </h1>
          <p
            style={{
              marginTop: 20,
              fontSize: 14,
              color: "var(--muted)",
              lineHeight: 1.6,
            }}
          >
            Your photos are safely stored. Pick up where you left off — your order
            is still ready to go.
          </p>

          {error && (
            <div
              style={{
                marginTop: 24,
                padding: "12px 14px",
                fontSize: 13,
                color: "var(--bad)",
                background: "rgba(196, 74, 74, 0.06)",
                border: "1px solid rgba(196, 74, 74, 0.2)",
                borderRadius: "var(--radius-sm)",
                textAlign: "left",
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          <button
            className="g-cta-primary"
            style={{
              width: "100%",
              marginTop: error ? 16 : 36,
              justifyContent: "center",
            }}
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? (
              <>
                <Loader2 className="g-spin" size={14} />
                Redirecting to checkout…
              </>
            ) : (
              <>
                Complete my order <ArrowRight size={14} />
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => (window.location.href = "/upload")}
            style={{
              marginTop: 16,
              fontSize: 12,
              color: "var(--muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Start a new order instead
          </button>
        </motion.div>
      </div>
    </div>
  );
}
