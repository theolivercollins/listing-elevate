import { useState, useEffect, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ChevronLeft, ChevronRight, Loader2, ArrowRight } from "lucide-react";
import { formatCents, getRelativeTime } from "@/lib/types";
import type { Property } from "@/lib/types";
import { fetchProperties } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { motion } from "framer-motion";
import { ImageOff } from "lucide-react";
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

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const statusLabel: Record<string, string> = {
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

const statusTone: Record<string, string> = {
  complete: "text-accent",
  failed: "text-destructive",
  needs_review: "text-destructive",
};

const Properties = () => {
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
        setError(err instanceof Error ? err.message : "Failed to load properties");
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
    <div className="space-y-12">
      <div className="flex items-end justify-between gap-6">
        <div>
          <span style={EYEBROW}>— All listings</span>
          <h2 className="mt-3" style={PAGE_H1}>
            <span style={{ fontFamily: "var(--le-font-mono)" }}>{total}</span> total
          </h2>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[280px] flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            placeholder="Search by address…"
            className="pl-11"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {Object.entries(statusLabel).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border-t border-border">
        <div className="grid grid-cols-[64px_3fr_1.2fr_1fr_1.2fr_0.6fr_1fr_1fr_0.5fr] gap-6 border-b border-border py-4" style={{ background: "rgba(255,255,255,0.03)" }}>
          <span style={EYEBROW}>Photo</span>
          <span style={EYEBROW}>Property</span>
          <span style={EYEBROW}>Agent</span>
          <span className="text-right" style={EYEBROW}>Price</span>
          <span style={EYEBROW}>Status</span>
          <span className="text-right" style={EYEBROW}>Photos</span>
          <span className="text-right" style={EYEBROW}>Cost</span>
          <span style={EYEBROW}>Created</span>
          <span className="text-right" style={EYEBROW}>View</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-24 text-center text-sm text-destructive">{error}</div>
        ) : properties.length === 0 ? (
          <div className="py-24 text-center text-sm text-muted-foreground">No listings match your filters</div>
        ) : (
          properties.map((p, i) => {
            const tone = statusTone[p.status] || "text-foreground";
            const thumb = thumbnails[p.id];
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.02, ease: EASE }}
                className="group grid grid-cols-[64px_3fr_1.2fr_1fr_1.2fr_0.6fr_1fr_1fr_0.5fr] items-center gap-6 border-b border-border py-5 transition-colors duration-500 hover:bg-secondary/40"
              >
                <Link
                  to={`/dashboard/properties/${p.id}`}
                  className="relative block aspect-[4/3] w-16 overflow-hidden border border-border bg-secondary"
                  aria-label={`View ${p.address}`}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-700 ease-cinematic group-hover:scale-105"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-muted-foreground/40">
                      <ImageOff className="h-4 w-4" strokeWidth={1.5} />
                    </span>
                  )}
                </Link>
                <Link to={`/dashboard/properties/${p.id}`} className="truncate text-sm font-medium hover:underline">
                  {p.address}
                </Link>
                <span className="truncate text-xs text-muted-foreground">{p.listing_agent}</span>
                <span className="tabular text-right text-sm">${p.price.toLocaleString()}</span>
                <span className={tone} style={{ ...EYEBROW, color: undefined }}>{statusLabel[p.status] || p.status}</span>
                <span className="tabular text-right text-xs text-muted-foreground">{p.photo_count}</span>
                <span className="tabular text-right text-xs">{formatCents(p.total_cost_cents)}</span>
                <span className="tabular text-xs text-muted-foreground">{getRelativeTime(p.created_at)}</span>
                <Link
                  to={`/dashboard/properties/${p.id}`}
                  className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="View"
                >
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && !loading && (
        <div className="flex items-center justify-between">
          <span style={EYEBROW}>
            <span style={{ fontFamily: "var(--le-font-mono)" }}>{total}</span> properties
          </span>
          <div className="flex items-center gap-3">
            <button type="button" style={{ ...GHOST_BTN, opacity: page <= 1 ? 0.4 : 1 }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <span className="px-3 text-xs" style={{ fontFamily: "var(--le-font-mono)", color: "rgba(255,255,255,0.55)" }}>
              Page {page} / {totalPages}
            </span>
            <button type="button" style={{ ...GHOST_BTN, opacity: page >= totalPages ? 0.4 : 1 }} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default Properties;
