import { useState, useEffect, type CSSProperties } from "react";
import type { PipelineLog } from "@/lib/types";
import { fetchLogs } from "@/lib/api";
import { KpiCard, Card } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

// ─── view-model ───────────────────────────────────────────────────
interface LogRow {
  key: string;
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  msg: string;
}

function fromLive(l: PipelineLog): LogRow {
  return {
    key: l.id,
    ts: new Date(l.created_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    level: l.level,
    source: l.stage,
    msg: l.message,
  };
}

// ─── level colour map ─────────────────────────────────────────────
const LEVEL_COLOR: Record<string, string> = {
  info: "var(--muted)",
  warn: "oklch(0.62 0.16 50)",
  error: "var(--bad)",
  debug: "var(--muted-2)",
};

// ─── ghost button ─────────────────────────────────────────────────
const GHOST_BTN: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 10px",
  fontSize: 11,
  fontWeight: 500,
  background: "transparent",
  color: "var(--ink-2)",
  border: "1px solid var(--line-1)",
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
  letterSpacing: "0.01em",
};

const Logs = () => {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetchLogs({ limit: 60 });
        if (cancelled) return;
        setRows(res.logs.map(fromLive));
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── KPI counts (live only) ────────────────────────────────────
  const errorCount = rows.filter((r) => r.level === "error").length;
  const warnCount  = rows.filter((r) => r.level === "warn").length;

  if (loading) {
    return (
      <div className="le-fade-up" style={{ padding: "80px 0", display: "flex", justifyContent: "center" }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* KPI strip */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Events · 24h"
          value={String(rows.length)}
          sub="across all services"
          delta={null}
        />
        <KpiCard
          label="Errors"
          value={String(errorCount)}
          sub={errorCount === 0 ? "none in window" : "in window"}
          delta={null}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Warnings"
          value={String(warnCount)}
          sub={warnCount === 0 ? "none in window" : "in window"}
          delta={null}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="P95 latency"
          value="—"
          sub="no live p95 metric yet"
          delta={null}
        />
      </section>

      {/* Live stream card */}
      <Card padding={20}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <div>
            <span className="le-d-label">Live stream</span>
            <h3 style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--ink)" }}>
              Pipeline events · last 60s
            </h3>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="le-btn-ghost" style={GHOST_BTN}>
              <Icon name="filter" size={13} />
              info · warn · error
            </button>
            <button
              type="button"
              className="le-btn-ghost"
              style={{ ...GHOST_BTN, gap: 8 }}
            >
              <span
                className="le-dot-pulse"
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: "var(--good)",
                  flexShrink: 0,
                }}
              />
              Streaming
            </button>
          </div>
        </div>

        {/* Log rows */}
        <div
          className="le-card-flat"
          style={{ padding: 0, overflow: "hidden" }}
        >
          <div className="le-table-scroll is-mid">
          {rows.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              No events in the last hour.
            </div>
          ) : (
            rows.map((l, i) => (
              <div
                key={l.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto auto auto 1fr",
                  gap: 16,
                  padding: "8px 14px",
                  borderBottom:
                    i === rows.length - 1 ? "none" : "1px solid var(--line-2)",
                  fontSize: 12,
                  alignItems: "center",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span style={{ color: "var(--muted-2)", fontVariantNumeric: "tabular-nums" }}>
                  {l.ts}
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    color: LEVEL_COLOR[l.level] ?? "var(--muted)",
                    textTransform: "uppercase",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                  }}
                >
                  {l.level}
                </span>
                <span
                  style={{
                    color: "var(--muted)",
                    padding: "2px 7px",
                    background: "rgba(11,11,16,0.04)",
                    borderRadius: 99,
                    fontSize: 10,
                  }}
                >
                  {l.source}
                </span>
                <span style={{ color: "var(--ink-2)" }}>{l.msg}</span>
              </div>
            ))
          )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default Logs;
