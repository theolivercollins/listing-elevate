// Subtle "Powered by Recasi Media" attribution that sits at the bottom of
// customer-facing portal pages (onboarding, payment, success — and later the
// public review page in phase 2). Matches LE's monochrome editorial language
// so it doesn't feel bolted on.
//
// Right now this is a typographic wordmark. Swap the inner span for an <img>
// or inline SVG if/when there's a Recasi logo file to drop in.

export function PoweredByRecasi() {
  return (
    <div className="mt-16 flex items-center justify-center gap-3 border-t border-border pt-8">
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
        className="text-foreground transition-opacity hover:opacity-70"
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "-0.02em",
        }}
      >
        Recasi Media
      </a>
    </div>
  );
}
