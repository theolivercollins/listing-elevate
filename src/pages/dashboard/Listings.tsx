import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ChevronLeft, ChevronRight, Loader2, ImageOff } from "lucide-react";
import { formatCents, getRelativeTime } from "@/lib/types";
import type { Property } from "@/lib/types";
import { fetchProperties } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { motion } from "framer-motion";
import "@/v2/styles/v2.css";

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  ingesting: "Ingesting",
  analyzing: "Analyzing",
  scripting: "Directing",
  generating: "Generating",
  qc: "QC",
  assembling: "Assembling",
  complete: "Delivered",
  failed: "Failed",
  needs_review: "Needs review",
};

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  complete: { bg: "var(--le-success-soft)", fg: "var(--le-success)" },
  needs_review: { bg: "var(--le-warn-soft)", fg: "var(--le-warn)" },
  failed: { bg: "var(--le-danger-soft)", fg: "var(--le-danger)" },
};

function StatusPill({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? { bg: "var(--le-bg-sunken)", fg: "var(--le-text-muted)" };
  return (
    <span
      className="le-mono inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: colors.bg, color: colors.fg }}
    >
      {(STATUS_LABEL[status] ?? status).replace(/_/g, " ")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Ghost button style (pagination)
// ---------------------------------------------------------------------------
const GHOST_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 14px",
  fontSize: 11,
  fontWeight: 500,
  background: "transparent",
  color: "var(--le-text)",
  border: "1px solid var(--le-border)",
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "var(--le-font-mono)",
  letterSpacing: "0.08em",
};

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------
const Listings = () => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [properties, setProperties] = useState<Property[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const perPage = 25;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const params: { page: number; limit: number; status?: string; search?: string } = {
          page,
          limit: perPage,
        };
        if (statusFilter !== "all") params.status = statusFilter;
        if (search) params.search = search;
        const res = await fetchProperties(params);
        if (cancelled) return;
        setProperties(res.properties);
        setTotal(res.total);
        setTotalPages(res.totalPages);
        setError(null);

        // Batch-load one thumbnail per property. Prefer the first selected
        // (hero) photo; fall back to the first photo overall if none selected.
        const ids = res.properties.map((p) => p.id);
        if (ids.length > 0) {
          const { data: photos } = await supabase
            .from("photos")
            .select("property_id, file_url, selected, created_at")
            .in("property_id", ids)
            .order("selected", { ascending: false })
            .order("created_at", { ascending: true });
          if (cancelled) return;
          const map: Record<string, string> = {};
          for (const ph of photos || []) {
            if (!map[ph.property_id]) map[ph.property_id] = ph.file_url as string;
          }
          setThumbnails(map);
        } else {
          setThumbnails({});
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load listings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [search, statusFilter, page]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page header ──────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Listings</div>
          <h2
            className="le-display mt-1 text-[28px] font-medium tracking-tight"
            style={{ color: "var(--le-text)" }}
          >
            <span style={{ fontFamily: "var(--le-font-mono)" }}>{loading ? "—" : total}</span>
            {" "}total
          </h2>
        </div>

        {/* Controls: search + status filter */}
        <div className="flex items-center gap-3">
          <div className="relative min-w-[240px]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: "var(--le-text-muted)" }}
            />
            <Input
              placeholder="Search by address…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Table card ───────────────────────────────────────── */}
      <div
        className="rounded-[14px] border"
        style={{
          background: "var(--le-bg-elev)",
          borderColor: "var(--le-border)",
          boxShadow: "var(--le-shadow-md)",
        }}
      >
        {/* Table header row */}
        <div
          className="grid items-center gap-4 px-6 py-3"
          style={{
            gridTemplateColumns: "40px 3fr 1.4fr 0.9fr 1.2fr 0.6fr 1fr 0.9fr",
            borderBottom: "1px solid var(--le-border)",
          }}
        >
          <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Photo</span>
          <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Property</span>
          <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Agent</span>
          <span className="le-eyebrow text-right" style={{ color: "var(--le-text-muted)" }}>Price</span>
          <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Status</span>
          <span className="le-eyebrow text-right" style={{ color: "var(--le-text-muted)" }}>Photos</span>
          <span className="le-eyebrow text-right" style={{ color: "var(--le-text-muted)" }}>Cost</span>
          <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Created</span>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--le-text-muted)" }} />
          </div>
        ) : error ? (
          <div className="py-24 text-center text-sm" style={{ color: "var(--le-danger)" }}>
            {error}
          </div>
        ) : properties.length === 0 ? (
          <div className="py-24 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>
            No listings match your filters
          </div>
        ) : (
          properties.map((p, i) => {
            const thumb = thumbnails[p.id];
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: i * 0.02, ease: EASE }}
                className="group grid items-center gap-4 px-6 py-4"
                style={{
                  gridTemplateColumns: "40px 3fr 1.4fr 0.9fr 1.2fr 0.6fr 1fr 0.9fr",
                  borderBottom: "1px solid var(--le-border)",
                  transition: "background 0.25s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                {/* Thumbnail */}
                <Link
                  to={`/dashboard/listings/${p.id}`}
                  className="relative block h-8 w-10 overflow-hidden rounded"
                  style={{ border: "1px solid var(--le-border)", background: "var(--le-bg-sunken)", flexShrink: 0 }}
                  aria-label={`View ${p.address}`}
                  tabIndex={-1}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span
                      className="flex h-full w-full items-center justify-center"
                      style={{ color: "var(--le-text-muted)" }}
                    >
                      <ImageOff className="h-3 w-3" strokeWidth={1.5} />
                    </span>
                  )}
                </Link>

                {/* Address */}
                <Link
                  to={`/dashboard/listings/${p.id}`}
                  className="truncate text-sm font-medium hover:underline"
                  style={{ color: "var(--le-text)" }}
                >
                  {p.address}
                </Link>

                {/* Agent */}
                <span className="truncate text-xs" style={{ color: "var(--le-text-muted)" }}>
                  {p.listing_agent}
                </span>

                {/* Price */}
                <span
                  className="le-mono text-right text-xs"
                  style={{ color: "var(--le-text)" }}
                >
                  ${p.price.toLocaleString()}
                </span>

                {/* Status pill */}
                <span>
                  <StatusPill status={p.status} />
                </span>

                {/* Photo count */}
                <span
                  className="le-mono text-right text-xs"
                  style={{ color: "var(--le-text-muted)" }}
                >
                  {p.photo_count}
                </span>

                {/* Cost */}
                <span
                  className="le-mono text-right text-xs"
                  style={{ color: "var(--le-text)" }}
                >
                  {formatCents(p.total_cost_cents)}
                </span>

                {/* Created */}
                <span className="text-xs" style={{ color: "var(--le-text-muted)" }}>
                  {getRelativeTime(p.created_at)}
                </span>
              </motion.div>
            );
          })
        )}

        {/* ── Pagination (inside card, bottom) ─────────────── */}
        {totalPages > 1 && !loading && (
          <div
            className="flex items-center justify-between px-6 py-4"
            style={{ borderTop: "1px solid var(--le-border)" }}
          >
            <span className="le-mono text-xs" style={{ color: "var(--le-text-muted)" }}>
              {total} listings · page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                style={{ ...GHOST_BTN, opacity: page <= 1 ? 0.4 : 1 }}
                disabled={page <= 1}
                onClick={() => setPage((n) => n - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <button
                type="button"
                style={{ ...GHOST_BTN, opacity: page >= totalPages ? 0.4 : 1 }}
                disabled={page >= totalPages}
                onClick={() => setPage((n) => n + 1)}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Listings;
