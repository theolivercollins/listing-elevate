import { Card, SectionTitle } from "reelready";
import { Icon } from "reelready";

export const Default = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            flexShrink: 0,
            background: "linear-gradient(135deg, hsl(210,10%,78%), hsl(240,10%,62%))",
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
            142 Birchwood Lane
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Delivered · 2h ago · 90s hero cut
          </div>
        </div>
      </div>
    </Card>
  </div>
);

export const WithHeader = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <Card>
      <SectionTitle
        eyebrow="In production"
        title="7 listings moving"
        meta={<span style={{ fontSize: 12, color: "var(--muted)" }}>Updated 2m ago</span>}
      />
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="activity" size={14} style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: 13, color: "var(--ink)" }}>
            819 Larkspur Ct — voiceover rendering
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="clock" size={14} style={{ color: "var(--muted)" }} />
          <span style={{ fontSize: 13, color: "var(--ink)" }}>
            5502 Overlook Dr — queued for assembly
          </span>
        </div>
      </div>
    </Card>
  </div>
);
