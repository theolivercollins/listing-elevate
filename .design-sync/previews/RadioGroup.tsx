import { RadioGroup, RadioGroupItem } from "reelready";
import { Label } from "reelready";

export const PlanChoice = () => (
  <div style={{ padding: 24 }}>
    <RadioGroup defaultValue="single" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <RadioGroupItem value="single" id="p-single" />
        <Label htmlFor="p-single">Single listing — $65</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <RadioGroupItem value="five" id="p-five" />
        <Label htmlFor="p-five">Five-pack — $275</Label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <RadioGroupItem value="team" id="p-team" />
        <Label htmlFor="p-team">Team plan — contact us</Label>
      </div>
    </RadioGroup>
  </div>
);
