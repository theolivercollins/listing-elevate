import { LEIcon, type LEIconName } from "reelready";

const ICON_NAMES: LEIconName[] = [
  "arrow",
  "arrowUpRight",
  "check",
  "x",
  "play",
  "download",
  "upload",
  "camera",
  "image",
  "orbit",
  "dollyR",
  "dollyL",
  "pan",
  "pushIn",
  "parallax",
  "settings",
  "menu",
  "bell",
  "search",
  "film",
  "sun",
  "moon",
  "sparkle",
  "zap",
  "clock",
  "dollar",
  "trash",
  "more",
  "bed",
  "bath",
  "ruler",
  "plus",
  "minus",
];

export const Grid = () => (
  <div style={{ padding: 24, color: "var(--le-text,#111)" }}>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: 16,
      }}
    >
      {ICON_NAMES.map((name) => (
        <div
          key={name}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <LEIcon name={name} size={22} />
          <span style={{ fontSize: 10, opacity: 0.65 }}>{name}</span>
        </div>
      ))}
    </div>
  </div>
);

export const Sizes = () => (
  <div style={{ padding: 24, color: "var(--le-text,#111)" }}>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 20 }}>
      <LEIcon name="camera" size={16} />
      <LEIcon name="camera" size={24} />
      <LEIcon name="camera" size={32} />
      <LEIcon name="camera" size={48} />
    </div>
  </div>
);

export const Colored = () => (
  <div style={{ padding: 24 }}>
    <div style={{ display: "flex", gap: 16 }}>
      <LEIcon name="sparkle" size={28} color="rgb(37,99,235)" />
      <LEIcon name="play" size={28} color="rgb(37,99,235)" />
      <LEIcon name="pushIn" size={28} color="rgb(37,99,235)" />
      <LEIcon name="check" size={28} color="rgb(37,99,235)" />
    </div>
  </div>
);
