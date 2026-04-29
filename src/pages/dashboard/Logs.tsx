import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Pause, Play, Download, Loader2 } from "lucide-react";
import type { PipelineLog, PipelineStage, LogLevel } from "@/lib/types";
import { fetchLogs } from "@/lib/api";
import "@/v2/styles/v2.css";

const EYEBROW: CSSProperties = {
  fontFamily: "var(--le-font-mono)",
  fontSize: 10,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.45)",
};
const PAGE_H1: CSSProperties = {
  fontFamily: "var(--le-font-sans)",
  fontSize: "clamp(28px, 4vw, 44px)",
  fontWeight: 500,
  letterSpacing: "-0.035em",
  lineHeight: 0.98,
  color: "#fff",
  margin: 0,
};
const GHOST_BTN: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  fontSize: 11,
  fontWeight: 500,
  background: "transparent",
  color: "#fff",
  border: "1px solid rgba(220,230,255,0.18)",
  borderRadius: 2,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
};

const Logs = () => {
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [logs, setLogs] = useState<(PipelineLog & { properties?: { address: string } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const params: { limit: number; stage?: string; level?: string } = { limit: 500 };
        if (stageFilter !== "all") params.stage = stageFilter;
        if (levelFilter !== "all") params.level = levelFilter;
        const res = await fetchLogs(params);
        if (cancelled) return;
        setLogs(res.logs);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load logs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [stageFilter, levelFilter]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filtered = search ? logs.filter((l) => l.message.toLowerCase().includes(search.toLowerCase())) : logs;

  const getPropertyAddress = (log: PipelineLog & { properties?: { address: string } }) =>
    log.properties?.address?.split(",")[0] || "Unknown";

  const exportCSV = () => {
    const header = "Timestamp,Property,Stage,Level,Message\n";
    const rows = filtered
      .map((l) => `"${l.created_at}","${getPropertyAddress(l)}","${l.stage}","${l.level}","${l.message}"`)
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pipeline-logs.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-12">
      <div>
        <span style={EYEBROW}>— Telemetry</span>
        <h2 className="mt-3" style={PAGE_H1}>Pipeline logs</h2>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          Live stream of every pipeline stage. Filter by stage or severity, search the message body, export to CSV.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[280px] flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            placeholder="Search log messages…"
            className="pl-11"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All stages" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {(["intake", "analysis", "scripting", "generation", "qc", "assembly", "delivery"] as PipelineStage[]).map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All levels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            {(["info", "warn", "error", "debug"] as LogLevel[]).map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button type="button" style={GHOST_BTN} onClick={() => setAutoScroll(!autoScroll)}>
          {autoScroll ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {autoScroll ? "Pause" : "Resume"}
        </button>
        <button type="button" style={GHOST_BTN} onClick={exportCSV}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Log viewer */}
      <div className="border border-border bg-secondary/20">
        <div ref={scrollRef} className="h-[640px] overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No logs match your filters
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {filtered.map((log) => (
                <div
                  key={log.id}
                  className="grid grid-cols-[80px_140px_90px_60px_1fr] items-start gap-4 px-5 py-2.5 text-[11px] leading-relaxed transition-colors hover:bg-secondary"
                  style={{ fontFamily: "var(--le-font-mono)" }}
                >
                  <span className="text-muted-foreground/60">
                    {new Date(log.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span className="truncate text-muted-foreground">{getPropertyAddress(log)}</span>
                  <span style={{ ...EYEBROW, fontSize: 10 }}>{log.stage}</span>
                  <span
                    className={
                      log.level === "error"
                        ? "text-destructive"
                        : log.level === "warn"
                        ? "text-accent"
                        : log.level === "debug"
                        ? "text-muted-foreground/60"
                        : "text-muted-foreground"
                    }
                    style={{ ...EYEBROW, fontSize: 10, color: undefined }}
                  >
                    {log.level}
                  </span>
                  <span
                    className={
                      log.level === "error"
                        ? "text-destructive"
                        : log.level === "warn"
                        ? "text-accent"
                        : "text-foreground"
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Logs;
