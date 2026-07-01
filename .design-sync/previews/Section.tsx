import { Section } from "reelready";

export const Default = () => (
  <Section
    eyebrow="How it works"
    title="Three steps to a cinematic listing"
    lede="Upload photos — we handle direction, editing, and delivery."
  >
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 24, marginTop: 32 }}>
      <div>
        <strong>01 · Upload</strong>
        <p>Drop 20–60 listing photos.</p>
      </div>
      <div>
        <strong>02 · Direct</strong>
        <p>Our model scripts the shot plan.</p>
      </div>
      <div>
        <strong>03 · Deliver</strong>
        <p>Cinematic video in 72 hours.</p>
      </div>
    </div>
  </Section>
);

export const Tinted = () => (
  <Section eyebrow="Pricing" title="Simple, per-listing pricing" tint>
    <p style={{ marginTop: 16, color: "var(--le-text-muted)" }}>
      $149 per listing video. No subscriptions, no seats.
    </p>
  </Section>
);
