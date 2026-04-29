import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Loader2, ArrowLeft, Check, X, AlertTriangle, Play, ChevronDown, ChevronUp, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "@/v2/styles/v2.css";

const EYEBROW: CSSProperties = { fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" };
const PAGE_H1: CSSProperties = { fontFamily: "var(--le-font-sans)", fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 0.98, color: "#fff", margin: 0 };
const SECTION_H3: CSSProperties = { fontFamily: "var(--le-font-sans)", fontSize: 20, fontWeight: 500, letterSpacing: "-0.025em", color: "#fff", margin: 0 };
const BADGE: CSSProperties = { display: "inline-flex", alignItems: "center", borderRadius: 0, fontFamily: "var(--le-font-mono)", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase" };
import {
  listProposals,
  reviewProposal,
  runMining,
  listPromotableOverrides,
  promoteOverrideToProd,
  type LabProposal,
  type OverrideReadiness,
} from "@/lib/proposalsApi";

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
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/dashboard/development" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <span style={EYEBROW}>— Development</span>
            <h2 className="mt-1" style={PAGE_H1}>Prompt proposals</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value) || 60)}
            className="w-20"
          />
          <span className="text-xs text-muted-foreground">days</span>
          <Button onClick={handleMine} disabled={mining}>
            {mining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Run rule mining
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Aggregates Lab ratings over the window, asks Claude to propose specific edits to the DIRECTOR_SYSTEM based on winner/loser patterns. Each change cites the iterations that justify it. Applied proposals become active lab_prompt_overrides — production stays unaffected.
      </p>

      {error && (
        <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Active overrides — promote to production. Lab overrides stay
          Lab-scoped until one is manually promoted here; promotion
          writes a new prompt_revisions row that the next production
          pipeline run picks up via resolveProductionPrompt. */}
      <section className="border border-border p-5" style={{ borderRadius: 0 }}>
        <div className="mb-4 flex items-center gap-3">
          <Rocket className="h-4 w-4" />
          <h3 style={SECTION_H3}>Active Lab overrides → production</h3>
        </div>
        {overrides === null ? (
          <div className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : overrides.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No active Lab overrides. Apply a proposal below to create one.
          </p>
        ) : (
          <div className="space-y-3">
            {overrides.map((o) => (
              <div key={o.override_id} className="flex flex-wrap items-center justify-between gap-3 border border-border p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span style={EYEBROW}>{o.prompt_name}</span>
                    <span
                      style={BADGE}
                      className={`bg-muted px-2 py-0.5 ${
                        o.ready_for_promotion
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {o.ready_for_promotion ? "Ready" : "Needs more data"}
                    </span>
                    <span className="tabular text-[11px] text-muted-foreground">
                      hash {o.body_hash.slice(0, 8)} · since {new Date(o.override_created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="tabular mt-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                    <span>rendered: {o.rendered_count ?? 0}</span>
                    <span>rated: {o.rated_count ?? 0}</span>
                    <span>avg: {o.avg_rating != null ? Number(o.avg_rating).toFixed(2) : "—"}</span>
                    <span>winners/losers: {o.winners ?? 0}/{o.losers ?? 0}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    onClick={() => handlePromote(o.override_id, false)}
                    disabled={!o.ready_for_promotion}
                    title={
                      o.ready_for_promotion
                        ? "Writes a new prompt_revisions row. Next prod pipeline run uses this body."
                        : "Needs ≥10 renders, avg ≥4.0, winners ≥2× losers."
                    }
                  >
                    <Rocket className="mr-1 h-3.5 w-3.5" /> Promote to prod
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm(
                        "Force-promote overrides the readiness gate. Only do this if you're confident in the change despite limited data. Continue?",
                      )) {
                        handlePromote(o.override_id, true);
                      }
                    }}
                  >
                    Force
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {proposals === null ? (
        <div className="py-20 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : proposals.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No proposals yet. Click &quot;Run rule mining&quot; to analyze recent Lab data and generate a proposed patch.
        </div>
      ) : (
        <div className="space-y-4">
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

  const statusColor =
    proposal.status === "applied"
      ? "text-emerald-600 dark:text-emerald-400"
      : proposal.status === "rejected"
      ? "text-muted-foreground line-through"
      : "text-foreground";

  return (
    <div className="border border-border bg-background p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span style={EYEBROW}>{proposal.prompt_name}</span>
            <span style={BADGE} className={`bg-muted px-2 py-0.5 ${statusColor}`}>
              {proposal.status}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(proposal.created_at).toLocaleString()} · {proposal.evidence?.iterations_count ?? 0} iterations / {proposal.evidence?.days ?? "?"}d
            </span>
            <span className="text-xs text-muted-foreground">
              {changes.length} proposed change{changes.length === 1 ? "" : "s"}
            </span>
          </div>
          {proposal.rationale && <p className="mt-3 text-sm">{proposal.rationale}</p>}
        </div>
        {proposal.status === "pending" && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={() => onReview(proposal.id, "reject")}>
              <X className="mr-1 h-3.5 w-3.5" /> Reject
            </Button>
            <Button size="sm" onClick={() => onReview(proposal.id, "apply")}>
              <Check className="mr-1 h-3.5 w-3.5" /> Apply
            </Button>
          </div>
        )}
      </div>

      {changes.length > 0 && (
        <div className="mt-4 space-y-2">
          {changes.map((c) => (
            <div key={c.change_id} className="border-l-2 border-foreground/20 pl-3 text-sm">
              <div className="font-medium">{c.intent}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Evidence: {c.evidence_summary} ({c.evidence_iteration_ids.slice(0, 3).map((id) => id.slice(0, 8)).join(", ")}
                {c.evidence_iteration_ids.length > 3 && ` +${c.evidence_iteration_ids.length - 3} more`})
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {expanded ? "Hide" : "Show"} diff + evidence buckets
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {proposal.proposed_diff && (
            <div>
              <div className="label text-muted-foreground">Proposed diff</div>
              <pre className="mt-2 max-h-96 overflow-auto rounded border border-border bg-muted/30 p-3 text-xs leading-relaxed font-mono">
                {proposal.proposed_diff}
              </pre>
            </div>
          )}
          {buckets.length > 0 && (
            <div>
              <div className="label text-muted-foreground">Evidence buckets</div>
              <div className="mt-2 space-y-2">
                {buckets.map((b, i) => (
                  <div key={i} className="border border-border p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono">
                        {b.bucket.room} / {b.bucket.camera_movement} / {b.bucket.provider}
                      </span>
                      <span className="tabular">
                        n={b.sample_size} · avg={b.avg_rating.toFixed(2)}
                      </span>
                    </div>
                    {b.winners.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Winners</div>
                        {b.winners.slice(0, 3).map((w) => (
                          <div key={w.iteration_id} className="mt-1 text-muted-foreground">
                            [{w.rating}★] {w.prompt}
                          </div>
                        ))}
                      </div>
                    )}
                    {b.losers.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[10px] uppercase tracking-wider text-destructive">Losers</div>
                        {b.losers.slice(0, 3).map((l) => (
                          <div key={l.iteration_id} className="mt-1 text-muted-foreground">
                            [{l.rating}★] {l.prompt}
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
    </div>
  );
}

export default PromptProposals;
