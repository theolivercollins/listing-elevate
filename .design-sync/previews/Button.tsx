import { Button } from "reelready";

export const Variants = () => (
  <div style={{ padding: 24, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
    <Button variant="default">Order a video</Button>
    <Button variant="accent">Get started</Button>
    <Button variant="outline">Preview</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="destructive">Delete</Button>
    <Button variant="secondary">Save draft</Button>
    <Button variant="link">Learn more</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ padding: 24, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
    <Button size="sm">Order a video</Button>
    <Button size="default">Order a video</Button>
    <Button size="lg">Order a video</Button>
    <Button size="xl">Order a video</Button>
  </div>
);

export const Disabled = () => (
  <div style={{ padding: 24 }}>
    <Button variant="default" disabled>
      Order a video
    </Button>
  </div>
);
