import { SectionTitle } from "reelready";

export const Default = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <SectionTitle
      eyebrow="In production"
      title="7 listings moving"
      meta={<span style={{ fontSize: 12, color: "var(--muted)" }}>Updated 2m ago</span>}
    />
  </div>
);

export const NoMeta = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <SectionTitle eyebrow="This week" title="12 videos delivered" />
  </div>
);
