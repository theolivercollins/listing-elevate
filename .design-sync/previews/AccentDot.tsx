import { AccentDot } from "reelready";

export const Default = () => (
  <div style={{ padding: 24, display: "flex", gap: 24, alignItems: "center" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <AccentDot />
      <span style={{ fontSize: 13, color: "#374151" }}>Static — Now Delivering</span>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <AccentDot animated />
      <span style={{ fontSize: 13, color: "#374151" }}>Animated — Rendering Live</span>
    </div>
  </div>
);
