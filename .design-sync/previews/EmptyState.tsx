import { EmptyState } from "reelready";

export const NoData = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <EmptyState message="No properties in pipeline yet." icon="home" />
  </div>
);

export const WithCTA = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <EmptyState
      message="No orders yet. Submit your first listing and get a cinematic video in 72 hours."
      icon="home"
      cta={{ label: "Order a video", to: "/upload" }}
    />
  </div>
);
