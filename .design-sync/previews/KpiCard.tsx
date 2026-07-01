import { KpiCard, MoneyValue } from "reelready";

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
    <KpiCard label="Delivered today" value="3" sub="3 videos today" delta={12.5} />
    <KpiCard label="In production" value="7" sub="across 7 stages" delta={null} />
    <KpiCard
      label="Spend · 7d"
      value={<MoneyValue cents={128000} />}
      sub="all providers"
      delta={8.2}
      deltaPositiveIsGood={false}
    />
    <KpiCard label="QC pass rate" value="96%" sub="2 manual, rest auto" delta={3.1} />
  </div>
);

export const SingleWithDelta = () => (
  <div style={{ padding: 24, maxWidth: 520 }}>
    <KpiCard
      label="Failed renders · 7d"
      value="2"
      sub="down from 5 last week"
      delta={-60}
      deltaPositiveIsGood={false}
    />
  </div>
);
