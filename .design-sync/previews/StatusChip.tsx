import { StatusChip } from "reelready";

export const AllStates = () => (
  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: 24 }}>
    <StatusChip status="delivered" />
    <StatusChip status="generating" />
    <StatusChip status="qc" />
    <StatusChip status="needs_review" />
    <StatusChip status="failed" />
    <StatusChip status="pending_payment" />
    <StatusChip status="queued" />
    <StatusChip status="archived" />
  </div>
);

export const LabelOverride = () => (
  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: 24 }}>
    <StatusChip status="delivered" labelOverride="Sent to 214 Birchwood Ln" />
    <StatusChip status="generating" labelOverride="Rendering scene 4 of 6" />
  </div>
);
