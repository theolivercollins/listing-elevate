import { useState } from "react";
import { PageHeading, Card, SectionTitle } from "@/components/dashboard/primitives";
import { toast } from "sonner";
import "@/v2/styles/v2.css";

// ─── Toggle ──────────────────────────────────────────────────────
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={value}
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 22, borderRadius: 999,
        background: value ? "var(--ink)" : "rgba(11,11,16,0.12)",
        border: "none", padding: 0, cursor: "pointer", position: "relative",
        transition: "background .15s", flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: value ? 16 : 2,
        width: 18, height: 18, borderRadius: 99, background: "#fff",
        transition: "left .15s",
        boxShadow: "0 1px 2px rgba(11,11,16,0.15)",
      }} />
    </button>
  );
}

// ─── SettingRow ──────────────────────────────────────────────────
function SettingRow({ label, hint, children, first }: { label: string; hint?: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 320px", gap: 24,
      padding: "16px 0", borderTop: first ? "none" : "1px solid var(--line-2)", alignItems: "center",
    }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>{children}</div>
    </div>
  );
}

// ─── FieldInput ─────────────────────────────────────────────────
function FieldInput({ value, onChange, placeholder, type = "text" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", fontSize: 13, padding: "10px 14px", borderRadius: 12,
        border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)",
        outline: "none", fontFamily: "inherit",
      }}
    />
  );
}

// ─── SegControl ─────────────────────────────────────────────────
function SegControl<T extends string>({ options, value, onChange }: {
  options: { label: string; value: T }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="le-seg">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className={"le-seg-item" + (value === o.value ? " active" : "")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────
function SectionHeader({ eyebrow, title, onSave }: { eyebrow: string; title: string; onSave?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 4 }}>
      <SectionTitle eyebrow={eyebrow} title={title} />
      {onSave && (
        <button type="button" className="le-btn-dark" style={{ fontSize: 12, padding: "7px 16px" }} onClick={onSave}>
          Save
        </button>
      )}
    </div>
  );
}

// ─── Integrations data ──────────────────────────────────────────
const INTEGRATIONS = [
  { name: "Anthropic", desc: "Claude director / scene chat", connected: true },
  { name: "Atlas Cloud", desc: "Kling SKU routing", connected: true },
  { name: "Runway Gen-4", desc: "Video generation", connected: true },
  { name: "Luma Ray2", desc: "Video generation", connected: true },
  { name: "Shotstack", desc: "Assembly + compositing", connected: true },
  { name: "Creatomate", desc: "Template rendering", connected: true },
  { name: "Browserbase", desc: "Headless browser ops", connected: true },
  { name: "Gemini", desc: "Vision judge + embeddings", connected: true },
  { name: "Supabase", desc: "Storage + database", connected: true },
];

// ─── Main ────────────────────────────────────────────────────────
const Settings = () => {
  // Brand identity
  const [brokerage, setBrokerage] = useState("Recasi Real Estate");
  const [logoUrl, setLogoUrl] = useState("");
  const [brandColor, setBrandColor] = useState("#0B5FFF");
  const [agentName, setAgentName] = useState("Oliver Helgemo");
  const [agentEmail, setAgentEmail] = useState("oliver@recasi.com");
  const [agentPhone, setAgentPhone] = useState("");

  // Video presets
  const [duration, setDuration] = useState<"15" | "30" | "60">("30");
  const [orientation, setOrientation] = useState<"vertical" | "horizontal" | "both">("vertical");
  const [pkg, setPkg] = useState<"just_listed" | "just_pended" | "just_closed" | "life_cycle">("just_listed");
  const [voiceover, setVoiceover] = useState(false);
  const [music, setMusic] = useState(true);

  // Notifications
  const [emailOnComplete, setEmailOnComplete] = useState(true);
  const [emailOnFailure, setEmailOnFailure] = useState(true);
  const [slackWebhook, setSlackWebhook] = useState("");

  // Pipeline behavior
  const [thompsonRouter, setThompsonRouter] = useState(true);
  const [autoJudge, setAutoJudge] = useState(false);
  const [qcBehavior, setQcBehavior] = useState<"auto-pass" | "route-to-review">("route-to-review");

  // Danger zone
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = (section: string) => toast.success(`${section} saved`);

  return (
    <div className="le-fade-up" style={{ maxWidth: 780, margin: "0 auto" }}>
      <PageHeading
        eyebrow="Workspace"
        title="Settings"
        sub="Brand defaults, video presets, notifications, and pipeline behavior."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 32 }}>

        {/* 1. Brand identity */}
        <Card padding={24}>
          <SectionHeader eyebrow="Identity" title="Brand" onSave={() => save("Brand identity")} />
          <SettingRow first label="Brokerage name" hint="Shown on all exported videos and share pages.">
            <FieldInput value={brokerage} onChange={setBrokerage} placeholder="Your brokerage" />
          </SettingRow>
          <SettingRow label="Logo URL" hint="Public URL to your brokerage logo (PNG or SVG, transparent background).">
            <FieldInput value={logoUrl} onChange={setLogoUrl} placeholder="https://..." />
          </SettingRow>
          <SettingRow label="Primary brand color" hint="Used for lower-thirds and title cards.">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="color"
                value={brandColor}
                onChange={e => setBrandColor(e.target.value)}
                style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid var(--line)", cursor: "pointer", padding: 2 }}
              />
              <div className="le-card-flat" style={{ padding: "7px 12px", fontSize: 12, fontVariantNumeric: "tabular-nums", color: "var(--muted)", borderRadius: 8, minWidth: 80, textAlign: "center" }}>
                {brandColor.toUpperCase()}
              </div>
            </div>
          </SettingRow>
          <SettingRow label="Default agent name" hint="Pre-filled when creating a new listing.">
            <FieldInput value={agentName} onChange={setAgentName} placeholder="Agent name" />
          </SettingRow>
          <SettingRow label="Default agent email">
            <FieldInput value={agentEmail} onChange={setAgentEmail} placeholder="agent@brokerage.com" type="email" />
          </SettingRow>
          <SettingRow label="Default agent phone">
            <FieldInput value={agentPhone} onChange={setAgentPhone} placeholder="+1 (555) 000-0000" type="tel" />
          </SettingRow>
        </Card>

        {/* 2. Default video presets */}
        <Card padding={24}>
          <SectionHeader eyebrow="Presets" title="Default video settings" onSave={() => save("Video presets")} />
          <SettingRow first label="Duration" hint="Applied to every new upload unless overridden per-listing.">
            <SegControl
              options={[{ label: "15s", value: "15" }, { label: "30s", value: "30" }, { label: "60s", value: "60" }]}
              value={duration}
              onChange={setDuration}
            />
          </SettingRow>
          <SettingRow label="Orientation">
            <SegControl
              options={[{ label: "Vertical", value: "vertical" }, { label: "Horizontal", value: "horizontal" }, { label: "Both", value: "both" }]}
              value={orientation}
              onChange={setOrientation}
            />
          </SettingRow>
          <SettingRow label="Package" hint="Narrative arc applied by the director.">
            <SegControl
              options={[
                { label: "Just listed", value: "just_listed" },
                { label: "Pended", value: "just_pended" },
                { label: "Closed", value: "just_closed" },
                { label: "Life cycle", value: "life_cycle" },
              ]}
              value={pkg}
              onChange={setPkg}
            />
          </SettingRow>
          <SettingRow label="Include voiceover" hint="AI-generated narration over the video.">
            <Toggle value={voiceover} onChange={setVoiceover} />
          </SettingRow>
          <SettingRow label="Include music" hint="Background music track mixed into the final export.">
            <Toggle value={music} onChange={setMusic} />
          </SettingRow>
        </Card>

        {/* 3. Notifications */}
        <Card padding={24}>
          <SectionHeader eyebrow="Alerts" title="Notifications" onSave={() => save("Notifications")} />
          <SettingRow first label="Email on complete" hint="Receive an email when a video finishes processing.">
            <Toggle value={emailOnComplete} onChange={setEmailOnComplete} />
          </SettingRow>
          <SettingRow label="Email on failure" hint="Receive an email when a property pipeline errors out.">
            <Toggle value={emailOnFailure} onChange={setEmailOnFailure} />
          </SettingRow>
          <SettingRow label="Slack webhook URL" hint="Post completion and failure events to a Slack channel.">
            <FieldInput value={slackWebhook} onChange={setSlackWebhook} placeholder="https://hooks.slack.com/..." />
          </SettingRow>
        </Card>

        {/* 4. Integrations */}
        <Card padding={24}>
          <SectionHeader eyebrow="Connected services" title="Integrations" />
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 20px", lineHeight: 1.6 }}>
            API credentials live in Vercel environment variables. Connection status reflects server-side key presence.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {INTEGRATIONS.map(int => (
              <div
                key={int.name}
                className="le-card-flat"
                style={{ padding: "12px 14px", borderRadius: 10 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: 99, flexShrink: 0,
                    background: int.connected ? "var(--good)" : "var(--muted-2)",
                  }} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{int.name}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, paddingLeft: 15 }}>{int.desc}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* 5. Pipeline behavior */}
        <Card padding={24}>
          <SectionHeader eyebrow="Advanced" title="Pipeline behavior" onSave={() => save("Pipeline behavior")} />
          <SettingRow first label="Thompson router" hint="Use multi-armed bandit allocation across providers and SKUs. Maps to USE_THOMPSON_ROUTER env.">
            <Toggle value={thompsonRouter} onChange={setThompsonRouter} />
          </SettingRow>
          <SettingRow label="Auto-judge" hint="Run Gemini vision scoring after every render. Maps to JUDGE_ENABLED env.">
            <Toggle value={autoJudge} onChange={setAutoJudge} />
          </SettingRow>
          <SettingRow label="Default QC behavior" hint="What happens when a clip passes QC thresholds.">
            <SegControl
              options={[{ label: "Auto-pass", value: "auto-pass" }, { label: "Route to review", value: "route-to-review" }]}
              value={qcBehavior}
              onChange={setQcBehavior}
            />
          </SettingRow>
        </Card>

        {/* 6. Workspace */}
        <Card padding={24}>
          <SectionHeader eyebrow="Account" title="Workspace" />
          <SettingRow first label="Workspace name" hint="Contact support to rename your workspace.">
            <div className="le-card-flat" style={{ padding: "10px 14px", fontSize: 13, color: "var(--muted)", borderRadius: 12 }}>
              Recasi
            </div>
          </SettingRow>
          <SettingRow label="Plan">
            <div className="le-card-flat" style={{ padding: "10px 14px", fontSize: 13, color: "var(--muted)", borderRadius: 12 }}>
              Studio
            </div>
          </SettingRow>
          <SettingRow label="Seats" hint="Active users in this workspace.">
            <div className="le-card-flat" style={{ padding: "10px 14px", fontSize: 13, color: "var(--muted)", borderRadius: 12 }}>
              8 of 20
            </div>
          </SettingRow>
        </Card>

        {/* 7. Danger zone */}
        <Card padding={24}>
          <SectionHeader eyebrow="Irreversible actions" title="Danger zone" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            <button
              type="button"
              className="le-btn-ghost"
              style={{ textAlign: "left", padding: "10px 16px", borderRadius: 10, fontSize: 13 }}
              onClick={() => { toast.success("Signed out of all sessions"); }}
            >
              Sign out everywhere
            </button>
            <button
              type="button"
              className="le-btn-ghost"
              style={{ textAlign: "left", padding: "10px 16px", borderRadius: 10, fontSize: 13 }}
              onClick={() => { toast.success("Data export requested — you'll receive an email within 24h"); }}
            >
              Request data export
            </button>
            {!confirmDelete ? (
              <button
                type="button"
                className="le-btn-ghost"
                style={{ textAlign: "left", padding: "10px 16px", borderRadius: 10, fontSize: 13, color: "var(--bad)", borderColor: "rgba(196,74,74,0.25)" }}
                onClick={() => setConfirmDelete(true)}
              >
                Delete workspace
              </button>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12.5, color: "var(--muted)", flex: 1 }}>
                  This cannot be undone. All data will be permanently deleted.
                </span>
                <button
                  type="button"
                  className="le-btn-ghost"
                  style={{ fontSize: 12, padding: "7px 14px", color: "var(--bad)", borderColor: "rgba(196,74,74,0.35)" }}
                  onClick={() => { toast.error("Workspace deletion is disabled in this environment"); setConfirmDelete(false); }}
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  className="le-btn-ghost"
                  style={{ fontSize: 12, padding: "7px 14px" }}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </Card>

      </div>
    </div>
  );
};

export default Settings;
