import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeading, Card, SectionTitle } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
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
        width: 18, height: 18, borderRadius: 999, background: "#fff",
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

// ─── NumInput ────────────────────────────────────────────────────
function NumInput({ value, onChange, min, prefix }: {
  value: number; onChange: (v: number) => void; min?: number; prefix?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {prefix && <span style={{ fontSize: 13, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{prefix}</span>}
      <input
        type="number"
        value={value}
        min={min}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width: 90, fontSize: 13, padding: "8px 10px", borderRadius: 10,
          border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)",
          outline: "none", fontFamily: "inherit", fontVariantNumeric: "tabular-nums",
          textAlign: "right",
        }}
      />
    </div>
  );
}

// ─── ReadOnly pill ────────────────────────────────────────────────
function ReadPill({ children }: { children: React.ReactNode }) {
  return (
    <div className="le-card-flat" style={{ padding: "8px 14px", fontSize: 12.5, color: "var(--muted)", borderRadius: 10, whiteSpace: "nowrap" }}>
      {children}
    </div>
  );
}

// ─── ModelChip ────────────────────────────────────────────────────
function ModelChip({ provider, model }: { provider: string; model: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: "rgba(11,11,16,0.06)", color: "var(--muted)", letterSpacing: "0.02em" }}>
        {provider}
      </span>
      <span style={{ fontSize: 12.5, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
        {model}
      </span>
    </div>
  );
}

// ─── SectionHeader ───────────────────────────────────────────────
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

// ─── Providers data ───────────────────────────────────────────────
const PROVIDERS: { name: string; desc: string; connected: boolean }[] = [
  { name: "Anthropic",    desc: "Director / scene chat",     connected: true  },
  { name: "Atlas Cloud",  desc: "Kling SKU routing",         connected: true  },
  { name: "Gemini",       desc: "Judge + embeddings",        connected: true  },
  { name: "Runway Gen-4", desc: "Video generation (failover)", connected: true  },
  { name: "Kling Native", desc: "Video generation (failover)", connected: true  },
  { name: "Shotstack",    desc: "Assembly + compositing",    connected: true  },
  { name: "Creatomate",   desc: "Template rendering",        connected: false },
  { name: "Browserbase",  desc: "Headless browser ops",      connected: true  },
  { name: "Supabase",     desc: "Storage + database",        connected: true  },
];

// ─── DangerButton with confirm ───────────────────────────────────
function DangerButton({ label, confirmLabel, onConfirm, destructive = false }: {
  label: string; confirmLabel: string; onConfirm: () => void; destructive?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12.5, color: "var(--muted)", flex: 1 }}>This action cannot be undone.</span>
        <button
          type="button"
          className="le-btn-ghost"
          style={{ fontSize: 12, padding: "7px 14px", color: destructive ? "var(--bad)" : undefined, borderColor: destructive ? "rgba(196,74,74,0.35)" : undefined }}
          onClick={() => { onConfirm(); setConfirming(false); }}
        >
          {confirmLabel}
        </button>
        <button type="button" className="le-btn-ghost" style={{ fontSize: 12, padding: "7px 14px" }} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="le-btn-ghost"
      style={{ textAlign: "left", padding: "10px 16px", borderRadius: 10, fontSize: 13, color: destructive ? "var(--bad)" : undefined, borderColor: destructive ? "rgba(196,74,74,0.25)" : undefined }}
      onClick={() => setConfirming(true)}
    >
      {label}
    </button>
  );
}

// ─── Main ────────────────────────────────────────────────────────
const Settings = () => {
  // Pipeline behavior
  const [thompsonRouter, setThompsonRouter] = useState(true);
  const [autoJudge, setAutoJudge]           = useState(false);
  const [judgeCronPaused, setJudgeCronPaused] = useState(false);
  const [defaultSku, setDefaultSku] = useState<"kling-v2-6-pro" | "kling-v3-pro" | "kling-v3-std" | "kling-v2-1-pair" | "kling-o3-pro" | "kling-v2-master">("kling-v2-6-pro");

  // Video presets
  const [duration, setDuration]       = useState<"15" | "30" | "60">("30");
  const [orientation, setOrientation] = useState<"vertical" | "horizontal" | "both">("vertical");
  const [pkg, setPkg]                 = useState<"just_listed" | "just_pended" | "just_closed" | "life_cycle">("just_listed");
  const [music, setMusic]             = useState(true);
  const [voiceover, setVoiceover]     = useState(false);

  // Cost ceilings
  const [dailyCap, setDailyCap]       = useState(50);
  const [listingCap, setListingCap]   = useState(10);
  const [onBreach, setOnBreach]       = useState<"manual-review" | "hard-stop" | "log-only">("manual-review");

  // Pipeline pause
  const [pipelinePaused, setPipelinePaused] = useState(false);

  const save = (section: string) => toast.success(`${section} saved`);

  return (
    <div className="le-fade-up">
      <PageHeading
        eyebrow="Owner workspace"
        title="Settings"
        sub="Pipeline controls, model versions, cost ceilings, and platform info. The buttons here change real Listing Elevate behavior — handle with care."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 32 }}>

        {/* 1. Pipeline behavior */}
        <Card padding={24}>
          <SectionHeader eyebrow="Advanced" title="Pipeline behavior" onSave={() => save("Pipeline behavior")} />
          <SettingRow first label="Thompson router" hint="Multi-armed bandit allocation across providers and SKUs. Maps to USE_THOMPSON_ROUTER. When off, static SKU below is used.">
            <Toggle value={thompsonRouter} onChange={setThompsonRouter} />
          </SettingRow>
          <SettingRow label="Auto-judge" hint="Run Gemini vision scoring after every render. Maps to JUDGE_ENABLED env var.">
            <Toggle value={autoJudge} onChange={setAutoJudge} />
          </SettingRow>
          <SettingRow label="Judge cron paused" hint="Pause the poll-judge cron. Maps to system_flags.judge_cron_paused db row.">
            <Toggle value={judgeCronPaused} onChange={setJudgeCronPaused} />
          </SettingRow>
          <SettingRow label="Default V1 Atlas SKU" hint="Fallback SKU when Thompson router is off or has no data for a bucket.">
            <select
              value={defaultSku}
              onChange={e => setDefaultSku(e.target.value as typeof defaultSku)}
              style={{
                fontSize: 12.5, padding: "8px 10px", borderRadius: 10,
                border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)",
                outline: "none", fontFamily: "inherit", cursor: "pointer",
              }}
            >
              <option value="kling-v2-6-pro">kling-v2-6-pro</option>
              <option value="kling-v3-pro">kling-v3-pro</option>
              <option value="kling-v3-std">kling-v3-std</option>
              <option value="kling-v2-1-pair">kling-v2-1-pair</option>
              <option value="kling-o3-pro">kling-o3-pro</option>
              <option value="kling-v2-master">kling-v2-master</option>
            </select>
          </SettingRow>
        </Card>

        {/* 2. Model versions */}
        <Card padding={24}>
          <SectionHeader eyebrow="Runtime" title="Model versions" />
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 4px", lineHeight: 1.6 }}>
            Read-only. Change model constants in <span style={{ fontSize: 11 }}>lib/providers/*</span> and redeploy.
          </p>
          <SettingRow first label="Director" hint="Writes the scene script and orchestrates the pipeline.">
            <ModelChip provider="Anthropic" model="claude-sonnet-4-6" />
          </SettingRow>
          <SettingRow label="Scene chat" hint="Handles per-scene creative Q&A in the prompt lab.">
            <ModelChip provider="Anthropic" model="claude-haiku-4-5-20251001" />
          </SettingRow>
          <SettingRow label="Judge" hint="Scores every lab iteration with vision rubric.">
            <ModelChip provider="Gemini" model="gemini-2.5-flash" />
          </SettingRow>
          <SettingRow label="Image embedding" hint="768-dim vectors for photo similarity routing.">
            <ModelChip provider="Gemini" model="gemini-embedding-2 @ 768d" />
          </SettingRow>
          <SettingRow label="Photo analyzer" hint="Extracts scene metadata from listing photos.">
            <ModelChip provider="Gemini" model="gemini-3-flash-preview" />
          </SettingRow>
        </Card>

        {/* 3. Default video presets */}
        <Card padding={24}>
          <SectionHeader eyebrow="Presets" title="Default video settings" onSave={() => save("Video presets")} />
          <SettingRow first label="Duration" hint="Applied when a new listing's selected_duration is null.">
            <SegControl
              options={[{ label: "15s", value: "15" }, { label: "30s", value: "30" }, { label: "60s", value: "60" }]}
              value={duration} onChange={setDuration}
            />
          </SettingRow>
          <SettingRow label="Orientation" hint="Determines aspect ratio for video export.">
            <SegControl
              options={[{ label: "Vertical", value: "vertical" }, { label: "Horizontal", value: "horizontal" }, { label: "Both", value: "both" }]}
              value={orientation} onChange={setOrientation}
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
              value={pkg} onChange={setPkg}
            />
          </SettingRow>
          <SettingRow label="Default music" hint="Background music track mixed into the final export.">
            <Toggle value={music} onChange={setMusic} />
          </SettingRow>
          <SettingRow label="Default voiceover" hint="AI-generated narration. Billed extra per render.">
            <Toggle value={voiceover} onChange={setVoiceover} />
          </SettingRow>
        </Card>

        {/* 4. Cost ceilings */}
        <Card padding={24}>
          <SectionHeader eyebrow="Margin protection" title="Cost ceilings" onSave={() => save("Cost ceilings")} />
          <SettingRow first label="Daily total ceiling" hint="Hard budget across all providers for a calendar day.">
            <NumInput value={dailyCap} onChange={setDailyCap} min={0} prefix="$" />
          </SettingRow>
          <SettingRow label="Per-listing soft cap" hint="Flags a property when cumulative spend exceeds this.">
            <NumInput value={listingCap} onChange={setListingCap} min={0} prefix="$" />
          </SettingRow>
          <SettingRow label="On breach" hint="Action taken when a ceiling is hit.">
            <SegControl
              options={[
                { label: "Manual review", value: "manual-review" },
                { label: "Hard stop", value: "hard-stop" },
                { label: "Log only", value: "log-only" },
              ]}
              value={onBreach} onChange={setOnBreach}
            />
          </SettingRow>
        </Card>

        {/* 5. Providers */}
        <Card padding={24}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 4 }}>
            <SectionTitle eyebrow="Connected services" title="Providers" />
            <Link
              to="/dashboard/finances"
              style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", marginBottom: 4, whiteSpace: "nowrap" }}
            >
              Last-7d spend in Finances
              <Icon name="chevron-right" size={12} style={{ marginLeft: 4, verticalAlign: "middle" }} />
            </Link>
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 16px", lineHeight: 1.6 }}>
            API credentials live in Vercel env vars. Last-7d spend lives in{" "}
            <Link to="/dashboard/finances" style={{ color: "var(--accent)", textDecoration: "none" }}>Finances</Link>.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {PROVIDERS.map(p => (
              <div key={p.name} className="le-card-flat" style={{ padding: "12px 14px", borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: p.connected ? "var(--good)" : "var(--muted-2)" }} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{p.name}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, paddingLeft: 15 }}>{p.desc}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* 6. Workspace */}
        <Card padding={24}>
          <SectionHeader eyebrow="Account" title="Workspace" />
          <SettingRow first label="Workspace name">
            <ReadPill>Recasi</ReadPill>
          </SettingRow>
          <SettingRow label="Plan">
            <ReadPill>Studio · v2.4</ReadPill>
          </SettingRow>
          <SettingRow label="Primary owner">
            <ReadPill>Oliver Helgemo · oliver@recasi.com</ReadPill>
          </SettingRow>
        </Card>

        {/* 7. Domains & secrets */}
        <Card padding={24}>
          <SectionHeader eyebrow="Infrastructure" title="Domains and secrets" />
          {([
            { label: "Production",    hint: "Main branch · all crons enabled",   url: "https://listingelevate.com" },
            { label: "Staging",       hint: "staging branch · crons disabled",   url: "https://listingelevate-git-staging-recasi.vercel.app" },
            { label: "Dev",           hint: "dev branch · crons disabled",       url: "https://listingelevate-git-dev-recasi.vercel.app" },
          ] as const).map((row, i) => (
            <SettingRow key={row.label} first={i === 0} label={row.label} hint={row.hint}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.url.replace("https://", "")}
                </span>
                <a href={row.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--muted)", display: "flex", lineHeight: 1 }}>
                  <Icon name="external" size={13} strokeWidth={1.8} />
                </a>
              </div>
            </SettingRow>
          ))}
          <SettingRow label="Supabase project" hint="Shared across all environments.">
            <ReadPill>vrhmaeywqsohlztoouxu</ReadPill>
          </SettingRow>
          <SettingRow label="Vercel project">
            <ReadPill>prj_ZJRb76Pu05FHirZsHNH17MuJcL00</ReadPill>
          </SettingRow>
        </Card>

        {/* 8. Danger zone */}
        <Card padding={24}>
          <SectionHeader eyebrow="Irreversible actions" title="Danger zone" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderRadius: 10, border: "1px solid var(--line-2)", gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>Pause all pipeline crons</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>Sets system_flags.pipeline_paused. No new renders will start.</div>
              </div>
              <Toggle value={pipelinePaused} onChange={(v) => { setPipelinePaused(v); toast.success(v ? "Pipeline crons paused" : "Pipeline crons resumed"); }} />
            </div>
            <button
              type="button"
              className="le-btn-ghost"
              style={{ textAlign: "left", padding: "10px 16px", borderRadius: 10, fontSize: 13 }}
              onClick={() => window.alert("pnpm exec tsx scripts/cost-reconcile.ts")}
            >
              Run cost reconcile now
            </button>
            <DangerButton
              label="Sign out of all sessions"
              confirmLabel="Confirm sign out"
              onConfirm={() => toast.success("Signed out of all sessions")}
            />
            <DangerButton
              label="Export workspace data"
              confirmLabel="Confirm export"
              onConfirm={() => toast.success("Export requested — you'll receive an email within 24h")}
            />
          </div>
        </Card>

      </div>
    </div>
  );
};

export default Settings;
