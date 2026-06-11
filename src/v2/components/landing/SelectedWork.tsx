import { useEffect, useState } from "react";
import { getSampleReels, type SampleReel } from "@/v2/data/sampleReels";
import { SampleBadge } from "@/v2/components/primitives/SampleBadge";
import { Reveal } from "@/v2/components/primitives/Reveal";
import { Section } from "@/v2/components/landing/Section";

export function SelectedWork() {
  const [reels, setReels] = useState<SampleReel[]>([]);

  useEffect(() => {
    getSampleReels().then(setReels);
  }, []);

  if (reels.length === 0) return null;
  const [hero, ...rest] = reels;

  return (
    <Section
      id="showcase"
      eyebrow="— SHOWCASE"
      title="Selected work."
      maxWidth={1200}
      aside={
        <a
          href="#showcase"
          style={{
            fontSize: 14,
            color: "var(--le-text-muted)",
            textDecoration: "none",
            fontFamily: "var(--le-font-sans)",
          }}
        >
          View the reel →
        </a>
      }
    >
      <div
        className="le-stack-lg"
        style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}
      >
        <Reveal delay={0.1}>
          <ReelCard reel={hero} large />
        </Reveal>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {rest.map((r, i) => (
            <Reveal key={r.id} delay={0.1 + (i + 1) * 0.1}>
              <ReelCard reel={r} />
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

function ReelCard({ reel, large = false }: { reel: SampleReel; large?: boolean }) {
  const mins = Math.floor(reel.durationSec / 60);
  const secs = (reel.durationSec % 60).toString().padStart(2, "0");
  return (
    <div
      className="le-card-lift le-img-zoom"
      style={{
        position: "relative",
        aspectRatio: large ? "4 / 3" : "16 / 10",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "var(--le-shadow-md)",
      }}
    >
      <img
        src={reel.posterUrl}
        alt={reel.title}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
      {/* Bottom scrim so white title text reads over any poster */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, transparent 55%, rgba(7,8,12,0.65) 100%)",
          pointerEvents: "none",
        }}
      />
      {/* Play button affordance — centered white disc */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          className="le-play-btn"
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.96)",
            boxShadow: "var(--le-shadow-md)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)",
            color: "var(--le-text)",
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="currentColor"
            aria-hidden
            style={{ marginLeft: 2 }}
          >
            <path d="M5 3.5l10 5.5-10 5.5V3.5z" />
          </svg>
        </div>
      </div>
      <div style={{ position: "absolute", top: 16, left: 16 }}>
        <span
          className="le-mono"
          style={{
            fontSize: 10,
            padding: "4px 8px",
            borderRadius: 2,
            background: "rgba(0,0,0,0.5)",
            color: "#fff",
            backdropFilter: "blur(8px)",
          }}
        >
          <span aria-hidden="true">▶</span> {mins}:{secs}
        </span>
      </div>
      <div style={{ position: "absolute", top: 16, right: 16 }}>
        <SampleBadge />
      </div>
      <div style={{ position: "absolute", bottom: 16, left: 16, right: 16, color: "#fff" }}>
        <div style={{ fontSize: large ? 22 : 17, fontWeight: 500, marginBottom: 4 }}>
          {reel.title}
        </div>
      </div>
    </div>
  );
}
