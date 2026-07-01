import { Ambient } from "reelready";

export const Default = () => (
  <div
    style={{
      position: "relative",
      overflow: "hidden",
      height: 280,
      borderRadius: 16,
      background: "var(--le-bg,#fff)",
    }}
  >
    <Ambient dots intensity="softer" />
    <div style={{ position: "relative", padding: 32, fontSize: 22, fontWeight: 600 }}>
      Ambient background layer
    </div>
  </div>
);

export const Strong = () => (
  <div
    style={{
      position: "relative",
      overflow: "hidden",
      height: 280,
      borderRadius: 16,
      background: "var(--le-bg,#fff)",
    }}
  >
    <Ambient dots intensity="normal" />
    <div style={{ position: "relative", padding: 32, fontSize: 22, fontWeight: 600 }}>
      Ambient background layer
    </div>
  </div>
);
