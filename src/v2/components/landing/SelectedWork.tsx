import { useEffect, useState } from "react";
import { getSampleReels, type SampleReel } from "@/v2/data/sampleReels";
import { SampleBadge } from "@/v2/components/primitives/SampleBadge";

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
      style={{ padding: "140px 48px", color: "var(--le-text)", background: "transparent" }}
    >
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        <div className="le-eyebrow" style={{ marginBottom: 24, color: "var(--le-text-muted)" }}>— SHOWCASE</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 56 }}>
          <h2 className="le-display" style={{ fontSize: "clamp(44px, 5.5vw, 76px)", lineHeight: 0.98, margin: 0 }}>
            Selected work.
          </h2>
          <a href="#showcase" style={{ fontSize: 14, color: "var(--le-text-muted)", textDecoration: "none" }}>
            View the reel →
          </a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
          <ReelCard reel={hero} large />
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {rest.map(r => <ReelCard key={r.id} reel={r} />)}
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
    <div style={{ position: "relative", aspectRatio: large ? "4 / 3" : "16 / 10", borderRadius: 2, overflow: "hidden" }}>
      <img src={reel.posterUrl} alt={reel.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
