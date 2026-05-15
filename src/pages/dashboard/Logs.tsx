import { useState, useEffect, type CSSProperties } from "react";
import type { PipelineLog } from "@/lib/types";
import { fetchLogs } from "@/lib/api";
import { KpiCard, Card } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { SAMPLE_LOG_LINES } from "@/components/dashboard/sample-data";

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

function fromSample(l: (typeof SAMPLE_LOG_LINES)[number], i: number): LogRow {
  return { key: "s" + i, ts: l.ts, level: l.level, source: l.source, msg: l.msg };
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
  const [usingSample, setUsingSample] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchLogs({ limit: 60 });
        if (cancelled) return;
        if (res.logs.length > 0) {
          setRows(res.logs.map(fromLive));
          setUsingSample(false);
        } else {
          setRows(SAMPLE_LOG_LINES.map(fromSample));
          setUsingSample(true);
        }
      } catch {
        if (!cancelled) {
          setRows(SAMPLE_LOG_LINES.map(fromSample));
          setUsingSample(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── KPI counts (live or static fallback) ──────────────────────
  const eventsValue = usingSample ? "1,284" : String(rows.length);
  const errorCount = usingSample ? 3 : rows.filter((r) => r.level === "error").length;
  const warnCount  = usingSample ? 18 : rows.filter((r) => r.level === "warn").length;

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* KPI strip */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Events · 24h"
          value={eventsValue}
          sub="across all services"
          delta={12.2}
        />
        <KpiCard
          label="Errors"
          value={String(errorCount)}
          sub="all auto-recovered"
          delta={-66.7}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Warnings"
          value={String(warnCount)}
          sub="mostly QC soft-rejects"
          delta={4.1}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="P95 latency"
          value="240ms"
          sub="API response"
          delta={-8.1}
          deltaPositiveIsGood={false}
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
          {rows.map((l, i) => (
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
          ))}
        </div>
      </Card>
    </div>
  );
};

export default Logs;
