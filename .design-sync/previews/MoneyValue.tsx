import { MoneyValue } from "reelready";

export const Populated = () => (
  <div style={{ padding: 24, maxWidth: 520, display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span>Spend · 214 Birchwood Ln:</span>
      <MoneyValue cents={128000} />
    </div>
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span>Voice-over cost:</span>
      <MoneyValue cents={4999} />
    </div>
  </div>
);

export const ZeroAndAbsent = () => (
  <div style={{ padding: 24, maxWidth: 520, display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span>Retry cost:</span>
      <MoneyValue cents={0} />
    </div>
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span>3921 Ocean View Dr:</span>
      <MoneyValue cents={null} tooltipWhenAbsent="No spend yet" />
    </div>
  </div>
);
