import { SampleBadge } from "reelready";

// SampleBadge is a white-on-transparent eyebrow badge designed to sit on the
// dark hero/section backgrounds — show it on a dark canvas so it's visible.
export const OnDark = () => (
  <div
    style={{
      padding: 40,
      background: "var(--ink, #0b0b0c)",
      display: "flex",
      gap: 16,
      alignItems: "center",
      borderRadius: 12,
    }}
  >
    <SampleBadge />
  </div>
);
