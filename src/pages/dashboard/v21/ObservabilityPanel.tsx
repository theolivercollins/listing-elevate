// Stub — ObservabilityPanel will be delivered by the observability subagent.
export default function ObservabilityPanel({ listingId }: { listingId: string }) {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--muted)", fontFamily: "var(--le-font-sans)" }}>
      Observability Panel — coming soon ({listingId})
    </div>
  );
}
