import { Reveal } from "reelready";

export const Default = () => (
  <Reveal>
    <div style={{ padding: 24, fontSize: 20, fontWeight: 600 }}>
      Cinematic listing videos, delivered in 72 hours.
    </div>
  </Reveal>
);

export const Delayed = () => (
  <Reveal delay={0.2}>
    <p style={{ padding: 24, fontSize: 16, fontWeight: 500, maxWidth: 360 }}>
      Upload your photos, pick a style, and let Listing Elevate handle the
      rest — no editing, no waiting on a videographer.
    </p>
  </Reveal>
);
