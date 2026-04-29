export function SampleBadge() {
  return (
    <span
      className="le-badge le-mono"
      style={{
        background: "rgba(255,255,255,0.12)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,0.25)",
        letterSpacing: "0.18em",
      }}
    >
      <span className="le-badge-dot" style={{ background: "#fff" }} />
      SAMPLE
    </span>
  );
}
