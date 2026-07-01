import { Input } from "reelready";
import { Label } from "reelready";

export const Fields = () => (
  <div style={{ display: "grid", gap: 12, maxWidth: 360, padding: 24 }}>
    <div style={{ display: "grid", gap: 6 }}>
      <Label htmlFor="in-email">Email</Label>
      <Input id="in-email" type="email" placeholder="you@brokerage.com" />
    </div>
    <div style={{ display: "grid", gap: 6 }}>
      <Label htmlFor="in-address">Property address</Label>
      <Input id="in-address" placeholder="123 Main St, Austin TX" />
    </div>
    <div style={{ display: "grid", gap: 6 }}>
      <Label htmlFor="in-locked">Email</Label>
      <Input id="in-locked" value="locked@example.com" disabled readOnly />
    </div>
  </div>
);
