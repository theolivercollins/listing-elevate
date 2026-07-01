import { Input } from "reelready";
import { Label } from "reelready";

export const Default = () => (
  <div style={{ padding: 24, display: "grid", gap: 16, maxWidth: 320 }}>
    <div style={{ display: "grid", gap: 6 }}>
      <Label htmlFor="lbl-address">Property address</Label>
      <Input id="lbl-address" placeholder="123 Main St, Austin TX" />
    </div>
    <Label>Listing status</Label>
  </div>
);
