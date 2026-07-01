import { useEffect, useState } from "react";
import { LabSubNav } from "@/components/dashboard/LabSubNav";
import { Link } from "react-router-dom";
import { PageHeading, Card, SectionTitle } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import {
  listProposals,
  reviewProposal,
  runMining,
  listPromotableOverrides,
  promoteOverrideToProd,
  type LabProposal,
  type OverrideReadiness,
} from "@/lib/proposalsApi";

// ─── shared input style ───────────────────────────────────────────
const INPUT_STYLE: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line)",
  background: "var(--surface)",
  fontSize: 13,
  fontFamily: "var(--le-font-sans)",
  color: "var(--ink)",
  outline: "none",
};

// ─── proposal status colour map ───────────────────────────────────
const PROPOSAL_STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  applied:  { color: "var(--good)", bg: "color-mix(in srgb, var(--good) 10%, transparent)" },
  rejected: { color: "var(--muted)", bg: "rgba(11,11,16,0.05)" },
  pending:  { color: "var(--warn)", bg: "color-mix(in srgb, var(--warn) 10%, transparent)" },
};

const PromptProposals = () => {
  const [proposals, setProposals] = useState<LabProposal[] | null>(null);
  const [overrides, setOverrides] = useState<OverrideReadiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mining, setMining] = useState(false);
  const [days, setDays] = useState(60);

  async function reload() {
    try {
      const [p, o] = await Promise.all([listProposals(), listPromotableOverrides()]);
      setProposals(p.proposals);
      setOverrides(o.overrides);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handlePromote(overrideId: string, force: boolean) {
    try {
      await promoteOverrideToProd(overrideId, { force });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleMine() {
    setMining(true);
    setError(null);
    try {
      await runMining(days);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMining(false);
    }
  }

  async function handleReview(id: string, action: "apply" | "reject") {
    try {
      await reviewProposal(id, action);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      <LabSubNav />

      <PageHeading
        eyebrow="Lab"
        title="Prompt proposals"
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value) || 60)}
              style={{ ...INPUT_STYLE, width: 64, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
            />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>days</span>
            <button
              type="button"
              className="le-btn-dark"
              onClick={handleMine}
              disabled={mining}
              style={{ opacity: mining ? 0.6 : 1 }}
            >
              {mining ? (
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                </svg>
              ) : (
                <Icon name="play" size={13} />
              )}
              Run rule mining
            </button>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        }
      />

      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: -8, lineHeight: 1.6 }}>
        Aggregates Lab ratings over the window, asks Claude to propose specific edits to the DIRECTOR_SYSTEM based on winner/loser patterns. Each change cites the iterations that justify it. Applied proposals become active lab_prompt_overrides — production stays unaffected.
      </p>

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid color-mix(in srgb, var(--bad) 30%, transparent)",
            background: "color-mix(in srgb, var(--bad) 5%, transparent)",
            fontSize: 13,
            color: "var(--bad)",
          }}
        >
          <Icon name="alert" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Active overrides section */}
      <Card padding={24}>
        <SectionTitle
          eyebrow="Active Lab overrides"
          title="Active Lab overrides — promote to production"
        />
        <p style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
          Lab overrides stay Lab-scoped until manually promoted here. Promotion writes a new prompt_revisions row that the next production pipeline run picks up via resolveProductionPrompt.
        </p>

        {overrides === null ? (
          <div style={{ padding: "32px 0", display: "flex", justifyContent: "center" }}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.22-8.56" />
            </svg>
          </div>
        ) : overrides.length === 0 ? (
          <p style={{ marginTop: 16, fontSize: 12.5, color: "var(--muted)" }}>
            No active Lab overrides. Apply a proposal below to create one.
          </p>
        ) : (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {overrides.map((o) => (
              <div
                key={o.override_id}
                className="le-card-flat"
                style={{ padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontFamily: "var(--le-font-sans)", fontSize: 12, fontWeight: 500, color: "var(--ink)" }}>{o.prompt_name}</span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-pill)",
                        fontSize: 10.5,
                        fontWeight: 500,
                        background: o.ready_for_promotion ? "color-mix(in srgb, var(--good) 10%, transparent)" : "rgba(11,11,16,0.05)",
                        color: o.ready_for_promotion ? "var(--good)" : "var(--muted)",
                      }}
                    >
                      {o.ready_for_promotion ? "Ready" : "Needs more data"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                      hash {o.body_hash.slice(0, 8)} &middot; since {new Date(o.override_created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                    <span>rendered: {o.rendered_count ?? 0}</span>
                    <span>rated: {o.rated_count ?? 0}</span>
                    <span>avg: {o.avg_rating != null ? Number(o.avg_rating).toFixed(2) : "—"}</span>
                    <span>winners/losers: {o.winners ?? 0}/{o.losers ?? 0}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    className="le-btn-dark"
                    onClick={() => handlePromote(o.override_id, false)}
                    disabled={!o.ready_for_promotion}
                    style={{ opacity: !o.ready_for_promotion ? 0.4 : 1, cursor: !o.ready_for_promotion ? "not-allowed" : "pointer" }}
                    title={
                      o.ready_for_promotion
                        ? "Writes a new prompt_revisions row. Next prod pipeline run uses this body."
                        : "Needs ≥10 renders, avg ≥4.0, winners ≥2× losers."
                    }
                  >
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                      <path d="m3.29 15 2.71-3M12 17l-5-5 7-7 5 5z" />
                      <path d="M19 5L22 2M22 2l-3 3M22 2l3 3M22 2l-3-3" />
                    </svg>
                    Promote to prod
                  </button>
                  <button
                    type="button"
                    className="le-btn-ghost"
                    onClick={() => {
                      if (window.confirm(
                        "Force-promote overrides the readiness gate. Only do this if you're confident in the change despite limited data. Continue?",
                      )) {
                        handlePromote(o.override_id, true);
                      }
                    }}
                  >
                    Force
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Proposals list */}
      {proposals === null ? (
        <div style={{ padding: "64px 0", display: "flex", justifyContent: "center" }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
            <path d="M21 12a9 9 0 1 1-6.22-8.56" />
          </svg>
        </div>
      ) : proposals.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius)",
            padding: 48,
            textAlign: "center",
            fontSize: 13,
            color: "var(--muted)",
          }}
        >
          No proposals yet. Click "Run rule mining" to analyze recent Lab data and generate a proposed patch.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} onReview={handleReview} />
          ))}
        </div>
      )}
    </div>
  );
};

function ProposalCard({ proposal, onReview }: { proposal: LabProposal; onReview: (id: string, action: "apply" | "reject") => void }) {
  const [expanded, setExpanded] = useState(false);
  const changes = proposal.evidence?.changes ?? [];
  const buckets = proposal.evidence?.buckets ?? [];

  const statusStyle = PROPOSAL_STATUS_STYLE[proposal.status] ?? PROPOSAL_STATUS_STYLE.pending;

  return (
    <Card padding={20}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: proposal.rationale ? 10 : 0 }}>
            <span style={{ fontFamily: "var(--le-font-sans)", fontSize: 12, fontWeight: 500, color: "var(--ink)" }}>{proposal.prompt_name}</span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 8px",
                borderRadius: "var(--radius-pill)",
                fontSize: 10.5,
                fontWeight: 500,
                background: statusStyle.bg,
                color: statusStyle.color,
                textDecoration: proposal.status === "rejected" ? "line-through" : "none",
              }}
            >
              {proposal.status}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              {new Date(proposal.created_at).toLocaleString()} &middot; {proposal.evidence?.iterations_count ?? 0} iterations / {proposal.evidence?.days ?? "?"}d
            </span>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {changes.length} proposed change{changes.length === 1 ? "" : "s"}
            </span>
          </div>
          {proposal.rationale && (
            <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>{proposal.rationale}</p>
          )}
        </div>
        {proposal.status === "pending" && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button type="button" className="le-btn-ghost" onClick={() => onReview(proposal.id, "reject")}>
              <Icon name="x" size={13} />
              Reject
            </button>
            <button type="button" className="le-btn-dark" onClick={() => onReview(proposal.id, "apply")}>
              <Icon name="check" size={13} />
              Apply
            </button>
          </div>
        )}
      </div>

      {changes.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {changes.map((c) => (
            <div
              key={c.change_id}
              style={{
                borderLeft: "2px solid var(--line)",
                paddingLeft: 12,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{c.intent}</div>
              <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--muted)" }}>
                Evidence: {c.evidence_summary} ({c.evidence_iteration_ids.slice(0, 3).map((id) => id.slice(0, 8)).join(", ")}
                {c.evidence_iteration_ids.length > 3 && ` +${c.evidence_iteration_ids.length - 3} more`})
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          marginTop: 14,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 12,
          color: "var(--muted)",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--le-font-sans)",
          padding: 0,
        }}
      >
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={12} />
        {expanded ? "Hide" : "Show"} diff + evidence buckets
      </button>

      {expanded && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
          {proposal.proposed_diff && (
            <div>
              <span className="le-d-label">Proposed diff</span>
              <pre
                className="le-card-flat"
                style={{
                  marginTop: 8,
                  maxHeight: 384,
                  overflow: "auto",
                  padding: 14,
                  fontSize: 11,
                  fontFamily: "var(--le-font-sans)",
                  lineHeight: 1.65,
                  whiteSpace: "pre-wrap",
                  color: "var(--ink-2)",
                }}
              >
                {proposal.proposed_diff}
              </pre>
            </div>
          )}
          {buckets.length > 0 && (
            <div>
              <span className="le-d-label">Evidence buckets</span>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                {buckets.map((b, i) => (
                  <div
                    key={i}
                    className="le-card-flat"
                    style={{ padding: 14 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontFamily: "var(--le-font-sans)", fontSize: 12, color: "var(--ink-2)" }}>
                        {b.bucket.room} / {b.bucket.camera_movement} / {b.bucket.provider}
                      </span>
                      <span style={{ fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                        n={b.sample_size} &middot; avg={b.avg_rating.toFixed(2)}
                      </span>
                    </div>
                    {b.winners.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <span className="le-d-label" style={{ color: "var(--good)" }}>Winners</span>
                        {b.winners.slice(0, 3).map((w) => (
                          <div key={w.iteration_id} style={{ marginTop: 4, fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                            [{w.rating}/5] {w.prompt}
                          </div>
                        ))}
                      </div>
                    )}
                    {b.losers.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <span className="le-d-label" style={{ color: "var(--bad)" }}>Losers</span>
                        {b.losers.slice(0, 3).map((l) => (
                          <div key={l.iteration_id} style={{ marginTop: 4, fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                            [{l.rating}/5] {l.prompt}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default PromptProposals;
