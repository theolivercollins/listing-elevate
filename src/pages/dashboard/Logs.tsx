import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PipelineLog, PipelineStage, LogLevel } from "@/lib/types";
import { fetchLogs } from "@/lib/api";
import { KpiCard, Card, PageHeading } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

// ─── constants ────────────────────────────────────────────────────
const STAGE_OPTIONS: Array<{ value: PipelineStage | ""; label: string }> = [
  { value: "", label: "All stages" },
  { value: "intake", label: "Intake" },
  { value: "analysis", label: "Analysis" },
  { value: "scripting", label: "Scripting" },
  { value: "generation", label: "Generation" },
  { value: "qc", label: "QC" },
  { value: "assembly", label: "Assembly" },
  { value: "delivery", label: "Delivery" },
];

// level="" = all, "error" = errors only, "warn,error" = warnings+errors (sent as two requests or we handle server-side)
// The server accepts a single level value; for "warn+error" we omit the filter and post-filter client-side.
const LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All levels" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warnings" },
  { value: "error", label: "Errors only" },
  { value: "warn+error", label: "Warn + Error" },
  { value: "debug", label: "Debug" },
];

const PAGE_LIMIT = 100;
const REFETCH_MS = 5000;

// ─── view-model ───────────────────────────────────────────────────
interface LogRow {
  key: string;
  ts: string;
  tsRaw: string;
  level: LogLevel;
  source: PipelineStage;
  msg: string;
  address?: string;
  propertyId?: string;
}

function fromLive(l: PipelineLog & { properties?: { address: string } }): LogRow {
  const d = new Date(l.created_at);
  return {
    key: l.id,
    ts: d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    tsRaw: d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
    level: l.level,
    source: l.stage,
    msg: l.message,
    address: l.properties?.address,
    propertyId: l.property_id ?? undefined,
  };
}

// ─── level colour map ─────────────────────────────────────────────
const LEVEL_COLOR: Record<string, string> = {
  info: "var(--muted)",
  warn: "var(--warn)",
  error: "var(--bad)",
  debug: "var(--muted-2)",
};

// ─── ghost button / select shared style ──────────────────────────
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
  borderRadius: "var(--le-r-sm)",
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
  letterSpacing: "0.01em",
};

const SELECT_STYLE: CSSProperties = {
  ...GHOST_BTN,
  appearance: "none" as const,
  WebkitAppearance: "none" as const,
  paddingRight: 28,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 8px center",
  minWidth: 120,
};

const INPUT_STYLE: CSSProperties = {
  ...GHOST_BTN,
  width: 200,
  outline: "none",
};

const Logs = () => {
  const [stage, setStage] = useState<string>("");
  const [level, setLevel] = useState<string>("");
  const [propertySearch, setPropertySearch] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [page, setPage] = useState(1);
  const [liveEnabled, setLiveEnabled] = useState(true);

  // Derive server-level param: "warn+error" is client-side post-filter
  const serverLevel = level === "warn+error" ? "" : level;

  const queryKey = ["pipeline_logs", { stage, level, propertyId, page }];

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey,
    queryFn: () =>
      fetchLogs({
        page,
        limit: PAGE_LIMIT,
        stage: stage || undefined,
        level: serverLevel || undefined,
        property_id: propertyId || undefined,
      }),
    refetchInterval: liveEnabled ? REFETCH_MS : false,
    staleTime: 2000,
  });

  // Post-filter warn+error client-side
  // NOTE: when level === "warn+error", the server returns ALL levels for this page
  // (serverLevel is ""), so this client-side filter can produce fewer visible rows
  // than the server-reported total/totalPages for that page.
  // Proper fix: push `level IN (warn, error)` to the server query.
  const rawRows = (data?.logs ?? []).map(fromLive);
  const rows =
    level === "warn+error"
      ? rawRows.filter((r) => r.level === "warn" || r.level === "error")
      : rawRows;

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const errorCount = rows.filter((r) => r.level === "error").length;
  const warnCount = rows.filter((r) => r.level === "warn").length;

  // Apply property search: debounce via submit
  function handlePropertyKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      setPropertyId(propertySearch.trim());
      setPage(1);
    }
  }

  function handleFilterChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLSelectElement>) => {
      setter(e.target.value);
      setPage(1);
    };
  }

  // Active filter pill text
  const activeFilters: string[] = [];
  if (stage) activeFilters.push(`stage: ${stage}`);
  if (level) activeFilters.push(`level: ${LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? level}`);
  if (propertyId) activeFilters.push(`property: ${propertyId.slice(0, 8)}…`);

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeading
        eyebrow="Pipeline"
        title="Logs"
        sub="Queryable view of all pipeline events. Auto-refreshes every 5 seconds."
      />

      {/* KPI strip */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Rows loaded"
          value={String(rows.length)}
          sub={total > PAGE_LIMIT ? `of ${total} total` : "in this page"}
          delta={null}
        />
        <KpiCard
          label="Errors"
          value={String(errorCount)}
          sub={errorCount === 0 ? "none in view" : "in view"}
          delta={null}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Warnings"
          value={String(warnCount)}
          sub={warnCount === 0 ? "none in view" : "in view"}
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

      {/* Log viewer card */}
      <Card padding={20}>
        {/* Header row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 14,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <span className="le-d-label">Pipeline events</span>
            <h3
              style={{
                margin: "4px 0 0",
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: "-0.015em",
                color: "var(--ink)",
                fontFamily: "var(--le-font-sans)",
              }}
            >
              {activeFilters.length > 0 ? (
                <>
                  Filtered view
                  {activeFilters.map((f) => (
                    <span
                      key={f}
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--muted)",
                        background: "var(--line-2)",
                        padding: "2px 8px",
                        borderRadius: "var(--le-r-pill)",
                        fontFamily: "var(--le-font-sans)",
                      }}
                    >
                      {f}
                    </span>
                  ))}
                </>
              ) : (
                "All events"
              )}
            </h3>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {/* Stage selector */}
            <select
              aria-label="Filter by stage"
              value={stage}
              onChange={handleFilterChange(setStage)}
              style={SELECT_STYLE}
            >
              {STAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {/* Level selector */}
            <select
              aria-label="Filter by level"
              value={level}
              onChange={handleFilterChange(setLevel)}
              style={SELECT_STYLE}
            >
              {LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {/* Property search */}
            <input
              type="text"
              aria-label="Filter by property ID (press Enter)"
              placeholder="Property ID (Enter to apply)"
              value={propertySearch}
              onChange={(e) => setPropertySearch(e.target.value)}
              onKeyDown={handlePropertyKeyDown}
              style={INPUT_STYLE}
            />
            {propertyId && (
              <button
                type="button"
                aria-label="Clear property filter"
                style={{ ...GHOST_BTN, color: "var(--bad)" }}
                onClick={() => {
                  setPropertyId("");
                  setPropertySearch("");
                  setPage(1);
                }}
              >
                <Icon name="x" size={12} />
                Clear
              </button>
            )}

            {/* Live / paused toggle */}
            <button
              type="button"
              aria-label={liveEnabled ? "Pause auto-refresh" : "Resume auto-refresh"}
              style={{
                ...GHOST_BTN,
                gap: 8,
                color: liveEnabled ? "var(--good)" : "var(--muted)",
                borderColor: liveEnabled ? "var(--good)" : "var(--line-1)",
              }}
              onClick={() => setLiveEnabled((v) => !v)}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "var(--le-r-pill)",
                  background: liveEnabled ? "var(--good)" : "var(--muted)",
                  flexShrink: 0,
                }}
              />
              {liveEnabled ? (isFetching ? "Refreshing…" : "Live · 5s") : "Paused"}
            </button>
          </div>
        </div>

        {/* Result count */}
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            marginBottom: 10,
            fontFamily: "var(--le-font-sans)",
          }}
        >
          {isLoading
            ? "Loading…"
            : `${rows.length} row${rows.length !== 1 ? "s" : ""}${total > 0 ? ` · ${total} total` : ""}`}
        </div>

        {/* Error state */}
        {isError && (
          <div
            role="alert"
            style={{
              padding: "12px 16px",
              borderRadius: "var(--le-r-md)",
              background: "var(--bad-soft)",
              border: "1px solid var(--bad)",
              color: "var(--bad)",
              fontSize: 13,
              marginBottom: 12,
              fontFamily: "var(--le-font-sans)",
            }}
          >
            Failed to load logs:{" "}
            {error instanceof Error ? error.message : "Unknown error. Check your connection."}
          </div>
        )}

        {/* Log rows */}
        <div className="le-card-flat" style={{ padding: 0, overflow: "hidden" }}>
          <div className="le-table-scroll is-mid">
            {!isLoading && rows.length === 0 && !isError ? (
              <div
                style={{
                  padding: "40px 0",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: 13,
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                {activeFilters.length > 0
                  ? "No events match the current filters."
                  : "No events found."}
              </div>
            ) : (
              rows.map((l, i) => (
                <div
                  key={l.key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto auto auto 1fr auto",
                    gap: 12,
                    padding: "8px 14px",
                    borderBottom:
                      i === rows.length - 1 ? "none" : "1px solid var(--line-2)",
                    fontSize: 12,
                    alignItems: "center",
                    fontFamily: "var(--le-font-sans)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span
                    title={l.tsRaw}
                    style={{ color: "var(--muted-2)", fontVariantNumeric: "tabular-nums", fontFamily: "var(--le-font-sans)" }}
                  >
                    {l.ts}
                  </span>
                  <span
                    style={{
                      fontWeight: 600,
                      color: LEVEL_COLOR[l.level] ?? "var(--muted)",
                      textTransform: "uppercase",
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      fontFamily: "var(--le-font-sans)",
                    }}
                  >
                    {l.level}
                  </span>
                  <span
                    style={{
                      color: "var(--muted)",
                      padding: "2px 7px",
                      background: "rgba(11,11,16,0.04)",
                      borderRadius: "var(--le-r-pill)",
                      fontSize: 10,
                      fontFamily: "var(--le-font-sans)",
                    }}
                  >
                    {l.source}
                  </span>
                  <span style={{ color: "var(--ink-2)", fontFamily: "var(--le-font-sans)" }}>
                    {l.msg}
                  </span>
                  {l.address ? (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--muted)",
                        fontFamily: "var(--le-font-sans)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 160,
                      }}
                      title={l.address}
                    >
                      {l.address}
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 12,
              gap: 8,
            }}
          >
            <button
              type="button"
              disabled={page <= 1}
              aria-label="Previous page"
              style={{ ...GHOST_BTN, opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? "default" : "pointer" }}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹ Prev
            </button>
            <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--le-font-sans)" }}>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              aria-label="Next page"
              style={{
                ...GHOST_BTN,
                opacity: page >= totalPages ? 0.4 : 1,
                cursor: page >= totalPages ? "default" : "pointer",
              }}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next ›
            </button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default Logs;
