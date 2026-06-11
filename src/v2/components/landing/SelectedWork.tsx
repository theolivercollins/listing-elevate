import { useEffect, useState } from "react";
import { getSampleReels, type SampleReel } from "@/v2/data/sampleReels";
import { SampleBadge } from "@/v2/components/primitives/SampleBadge";
import { Reveal } from "@/v2/components/primitives/Reveal";

export function SelectedWork() {
  const [reels, setReels] = useState<SampleReel[]>([]);

  useEffect(() => {
    getSampleReels().then(setReels);
  }, []);

  if (reels.length === 0) return null;
  const [hero, ...rest] = reels;

  return (
    <section
      id="showcase"
      style={{ padding: "clamp(56px, 12vw, 140px) clamp(16px, 5vw, 48px)", color: "var(--le-text)", background: "transparent" }}
    >
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        <Reveal>
          <div className="le-eyebrow" style={{ marginBottom: 24, color: "var(--le-text-muted)" }}>— SHOWCASE</div>
        </Reveal>
        <Reveal delay={0.06}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 56 }}>
            <h2
              style={{
                fontSize: "clamp(40px, 5vw, 64px)",
                lineHeight: 1.02,
                margin: 0,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                fontFamily: "var(--le-font-sans)",
                color: "var(--le-text)",
              }}
            >
              Selected work.
            </h2>
            <a href="#showcase" style={{ fontSize: 14, color: "var(--le-text-muted)", textDecoration: "none" }}>
              View the reel →
            </a>
          </div>
        </Reveal>
        <div className="le-stack-lg" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
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
      </div>
    </section>
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
      <img src={reel.posterUrl} alt={reel.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      {/* Bottom scrim so white title/duration text reads over any poster */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, transparent 55%, rgba(7,8,12,0.65) 100%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "absolute", top: 16, left: 16 }}>
        <span className="le-mono" style={{ fontSize: 10, padding: "4px 8px", borderRadius: 2, background: "rgba(0,0,0,0.5)", color: "#fff", backdropFilter: "blur(8px)" }}>
          <span aria-hidden="true">▶</span> {mins}:{secs}
        </span>
      </div>
      <div style={{ position: "absolute", top: 16, right: 16 }}>
        <SampleBadge />
      </div>
      <div style={{ position: "absolute", bottom: 16, left: 16, right: 16, color: "#fff" }}>
        <div style={{ fontSize: large ? 22 : 17, fontWeight: 500, marginBottom: 4 }}>{reel.title}</div>
      </div>
    </div>
  );
}
