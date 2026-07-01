import { AnimatedCircleX } from "reelready";

export const Drawn = () => (
  <div style={{ padding: 24, display: "flex", gap: 32, alignItems: "center" }}>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <AnimatedCircleX isInView size={40} />
      <span style={{ fontSize: 12, color: "#374151" }}>Blurry listing photo</span>
    </div>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <AnimatedCircleX isInView size={24} />
      <span style={{ fontSize: 12, color: "#374151" }}>Address mismatch</span>
    </div>
  </div>
);
