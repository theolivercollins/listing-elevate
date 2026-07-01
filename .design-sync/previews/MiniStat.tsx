import { MiniStat } from "reelready";

export const Grid = () => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(2,1fr)",
      gap: 16,
      padding: 24,
      maxWidth: 560,
    }}
  >
    <MiniStat label="Completed · 30d" value="128" />
    <MiniStat label="Failed · 30d" value="3" />
    <MiniStat label="Avg turnaround" value="41m" />
    <MiniStat label="Active agents" value="12" />
  </div>
);

export const Single = () => (
  <div style={{ padding: 24, maxWidth: 520 }}>
    <MiniStat label="Listings ingested · 7d" value="22" />
  </div>
);
