/**
 * /upload/success — Stripe Checkout success landing page.
 *
 * Stripe redirects here after checkout.session.completed. The pipeline has
 * been triggered asynchronously by the webhook — we just show a confirmation.
 * The session_id query param is available if needed for future lookup.
 */
import { useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteNav } from "@/v2/components/SiteNav";
import "@/v2/styles/v2.css";

export default function UploadSuccess() {
  const [searchParams] = useSearchParams();
  // session_id is available for future lookup if needed
  const _sessionId = searchParams.get("session_id");

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
          <div className="mx-auto mb-10 flex h-20 w-20 items-center justify-center border border-accent/40 bg-accent/10 text-accent">
            <CheckCircle2 className="h-9 w-9" strokeWidth={1.5} />
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
            — Payment confirmed
          </span>
          <h1
            style={{
              marginTop: 20,
              fontSize: "clamp(24px, 4vw, 36px)",
              fontWeight: 500,
              letterSpacing: "-0.035em",
            }}
          >
            Order received.
            <br />
            We're on it.
          </h1>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            Payment confirmed. Your video is being produced — estimated delivery
            within 72 hours. We'll email you when it's ready.
          </p>
          <div className="mt-12 border border-border p-6 text-left text-sm text-muted-foreground">
            <p>
              Need help? Email{" "}
              <a
                href="mailto:support@listingelevate.com"
                className="text-foreground underline underline-offset-4"
              >
                support@listingelevate.com
              </a>
            </p>
          </div>
          <Button
            size="lg"
            className="mt-8 w-full"
            onClick={() => (window.location.href = "/upload")}
          >
            Submit another listing
          </Button>
        </div>
      </div>
    </div>
  );
}
