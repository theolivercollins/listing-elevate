import { Sparkline } from "reelready";

export const Default = () => (
  <div style={{ padding: 24, width: 460 }}>
    <Sparkline data={[0, 0, 1, 0, 2, 1, 3, 2, 4, 3, 5, 4]} height={48} />
  </div>
);

export const Flat = () => (
  <div style={{ padding: 24, width: 460 }}>
    <Sparkline data={[2, 2, 2, 2, 2, 2, 2, 2]} height={48} />
  </div>
);

export const NoFillWithDots = () => (
  <div style={{ padding: 24, width: 460 }}>
    <Sparkline data={[1, 3, 2, 5, 4, 6, 5, 7, 6, 8]} height={48} fill={false} showDots />
  </div>
);
