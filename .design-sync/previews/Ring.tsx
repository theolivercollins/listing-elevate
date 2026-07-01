import { Ring } from "reelready";

export const Single = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <Ring value={94} size={170} stroke={12} label="On-time" sub="128 of 136" />
  </div>
);

export const Trio = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <Ring value={94} size={140} stroke={12} label="On-time" sub="128 of 136" />
      <Ring value={68} size={140} stroke={12} color="var(--warn)" label="Capacity" sub="34 of 50 slots" />
      <Ring value={100} size={140} stroke={12} color="var(--good)" label="QC pass" sub="22 of 22 clips" />
    </div>
  </div>
);
