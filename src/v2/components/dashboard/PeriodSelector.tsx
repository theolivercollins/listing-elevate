import type { OverviewPeriod } from "@/lib/types";
import { ChipTabs } from "./ChipTabs";

const ITEMS = [
  { value: "7d" as OverviewPeriod, label: "7D" },
  { value: "30d" as OverviewPeriod, label: "30D" },
  { value: "90d" as OverviewPeriod, label: "90D" },
];

export function PeriodSelector({
  value,
  onChange,
}: {
  value: OverviewPeriod;
  onChange: (v: OverviewPeriod) => void;
}) {
  return <ChipTabs items={ITEMS} value={value} onChange={onChange} ariaLabel="Time period" />;
}
