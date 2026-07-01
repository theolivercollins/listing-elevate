import { Bars } from "reelready";

export const Spend7d = () => (
  <div style={{ padding: 24, width: 480 }}>
    <Bars
      data={[
        { label: "01 Jul", value: 128000, tooltip: "$1,280" },
        { label: "02 Jul", value: 96000, tooltip: "$960" },
        { label: "03 Jul", value: 141000, tooltip: "$1,410" },
        { label: "04 Jul", value: 88000, tooltip: "$880" },
        { label: "05 Jul", value: 112000, tooltip: "$1,120" },
        { label: "06 Jul", value: 64000, tooltip: "$640" },
        { label: "07 Jul", value: 132000, tooltip: "$1,320" },
      ]}
      accentIndex={6}
      height={200}
    />
  </div>
);

export const NoLabels = () => (
  <div style={{ padding: 24, width: 480 }}>
    <Bars
      data={[
        { label: "01 Jul", value: 3, tooltip: "3 delivered" },
        { label: "02 Jul", value: 5, tooltip: "5 delivered" },
        { label: "03 Jul", value: 2, tooltip: "2 delivered" },
        { label: "04 Jul", value: 6, tooltip: "6 delivered" },
        { label: "05 Jul", value: 4, tooltip: "4 delivered" },
      ]}
      height={160}
      showLabels={false}
    />
  </div>
);
