import { Icon, type IconName } from "reelready";

const GRID_ICONS: IconName[] = [
  "grid",
  "pipeline",
  "home",
  "logs",
  "dollar",
  "beaker",
  "book",
  "branch",
  "activity",
  "image",
  "search",
  "bell",
  "plus",
  "check",
  "x",
  "retry",
  "alert",
  "clock",
  "play",
  "upload",
  "filter",
  "sliders",
  "spark",
  "delivered",
];

export const Grid = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: 16,
        color: "var(--ink, #111)",
      }}
    >
      {GRID_ICONS.map((name) => (
        <div
          key={name}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: "10px 4px",
          }}
        >
          <Icon name={name} size={22} />
          <span style={{ fontSize: 10, color: "var(--muted)" }}>{name}</span>
        </div>
      ))}
    </div>
  </div>
);

export const Sizes = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 20, color: "var(--ink, #111)" }}>
      {[14, 18, 24, 32].map((size) => (
        <div key={size} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <Icon name="activity" size={size} />
          <span style={{ fontSize: 10, color: "var(--muted)" }}>{size}px</span>
        </div>
      ))}
    </div>
  </div>
);
