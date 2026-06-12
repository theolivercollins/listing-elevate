/**
 * /upload/cancelled — Stripe Checkout cancellation landing page.
 *
 * Stripe redirects here when the customer closes the Checkout page without
 * paying. The property row stays in 'pending_payment' — photos are preserved.
 * The customer can click "Try again" to re-create a Checkout session for the
 * same property via POST /api/properties/:id/resume-checkout.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resumeCheckout } from "@/lib/api";
import { SiteNav } from "@/v2/components/SiteNav";
import "@/v2/styles/v2.css";

export default function UploadCancelled() {
  const [searchParams] = useSearchParams();
  const propertyId = searchParams.get("property_id");

  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRetry = async () => {
    if (!propertyId) {
      // No property ID — send user back to the form to start fresh.
      window.location.href = "/upload";
      return;
    }
    setRetrying(true);
    setError(null);
    try {
      const { checkoutUrl } = await resumeCheckout(propertyId);
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to resume checkout. Please try again.",
      );
      setRetrying(false);
    }
  };

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{
        background: "var(--le-bg)",
        color: "var(--le-text)",
        fontFamily: "var(--le-font-sans)",
        paddingTop: 80,
      }}
    >
      <SiteNav showSectionLinks={false} solid />
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-10 flex h-20 w-20 items-center justify-center border border-destructive/30 bg-destructive/10 text-destructive">
            <AlertCircle className="h-9 w-9" strokeWidth={1.5} />
          </div>
          <span
            style={{
              fontFamily: "var(--le-font-mono)",
              fontSize: 10,
              letterSpacing: "0.22em",
              textTransform: "uppercase" as const,
              color: "var(--le-text-muted)",
            }}
          >
            — Payment cancelled
          </span>
          <h1
            style={{
              marginTop: 20,
              fontSize: "clamp(24px, 4vw, 36px)",
              fontWeight: 500,
              letterSpacing: "-0.035em",
            }}
          >
            No charge made.
            <br />
            Photos saved.
          </h1>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            Your payment was cancelled. No charge has been made. Your photos are
            safely stored — click below to complete your order.
          </p>

          {error && (
            <div className="mt-6 border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button
            size="lg"
            className="mt-10 w-full"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Redirecting to checkout…
              </>
            ) : (
              <>
                Complete my order
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>

          <button
            type="button"
            onClick={() => (window.location.href = "/upload")}
            className="mt-6 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
          >
            Start a new order instead
          </button>
        </div>
      </div>
    </div>
  );
}
