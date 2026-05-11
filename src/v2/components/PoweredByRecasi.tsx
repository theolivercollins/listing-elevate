// Recasi Media attribution rendered at the bottom of customer-facing portal
// pages (onboarding, payment, success — and later the public review page
// in phase 2). Bridges the brand gap between portal.listingelevate.com,
// emails from oliver@recasi.com, and Stripe charges from Recasi Media.

export function PoweredByRecasi() {
  return (
    <div className="mt-16 flex items-center justify-center gap-4 border-t border-border pt-8">
      <span
        className="label text-muted-foreground"
        style={{
          fontSize: 10,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
        }}
      >
        Powered by
      </span>
      <a
        href="https://recasi.com"
        target="_blank"
        rel="noreferrer"
        className="block transition-opacity hover:opacity-70"
        aria-label="recasi tech & media"
      >
        <img
          src="/recasi-logo.png"
          alt="recasi tech & media"
          className="h-[42px] w-auto md:h-[52px]"
          style={{ display: "block" }}
        />
      </a>
    </div>
  );
}
