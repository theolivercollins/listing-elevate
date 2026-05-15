import { useEffect, useMemo, useState } from "react";
import { fetchRatingLedger, type LedgerRow, type LedgerSurface } from "@/lib/ratingLedgerApi";
import { PageHeading, KpiCard, Card, fmtRel } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

type SurfaceFilter = LedgerSurface | "all";
type CommentFilter = "any" | "with" | "without";
type MinRatingFilter = "any" | "2" | "3" | "4" | "5";

const PAGE_SIZE = 50;

// ─── surface colour map ───────────────────────────────────────────
const SURFACE_STYLE: Record<LedgerSurface, { label: string; color: string; bg: string }> = {
  legacy_lab:   { label: "Legacy Lab",    color: "var(--muted)",  bg: "rgba(11,11,16,0.05)" },
  listings_lab: { label: "Listings Lab",  color: "var(--accent)", bg: "rgba(42,111,219,0.10)" },
  prod:         { label: "Production",    color: "var(--good)",   bg: "rgba(47,138,85,0.10)" },
};

// ─── retrieval tone helpers ───────────────────────────────────────
const RETRIEVAL_STYLE: Record<"ready" | "partial" | "missing", { label: string; color: string; bg: string }> = {
  ready:   { label: "Ready",   color: "var(--good)", bg: "rgba(47,138,85,0.10)" },
  partial: { label: "Partial", color: "var(--warn)", bg: "rgba(182,128,44,0.10)" },
  missing: { label: "Missing", color: "var(--bad)",  bg: "rgba(196,74,74,0.10)" },
};

// ─── inline star row ─────────────────────────────────────────────
function StarRow({ value }: { value: number | null }) {
  const v = value ?? 0;
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={12} height={12} viewBox="0 0 24 24" fill={i <= v ? "var(--ink)" : "transparent"} stroke={i <= v ? "var(--ink)" : "var(--line)"} strokeWidth={1.8} strokeLinejoin="round">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21l1.18-6.88-5-4.87 6.91-1.01z"/>
        </svg>
      ))}
      <span style={{ marginLeft: 6, fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{v}/5</span>
    </span>
  );
}

// ─── select chip ─────────────────────────────────────────────────
const SELECT_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line)",
  background: "var(--surface)",
  fontSize: 12.5,
  fontFamily: "var(--le-font-sans)",
  color: "var(--ink-2)",
  cursor: "pointer",
  appearance: "none" as const,
  WebkitAppearance: "none" as const,
};

function FilterChip({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="le-card-flat"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 10px" }}
    >
      {icon}
      {children}
    </div>
  );
}

// ─── ghost button styles ──────────────────────────────────────────
const GHOST_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--line)",
  background: "transparent",
  color: "var(--ink-2)",
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
};

// ─── main component ───────────────────────────────────────────────
export default function RatingLedger() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<{ legacy_lab: number; listings_lab: number; prod: number }>({
    legacy_lab: 0,
    listings_lab: 0,
    prod: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [surface, setSurface] = useState<SurfaceFilter>("all");
  const [sku, setSku] = useState<string>("all");
  const [minRating, setMinRating] = useState<MinRatingFilter>("any");
  const [comment, setComment] = useState<CommentFilter>("any");
  const [offset, setOffset] = useState(0);
  const [showOnlyDisagreements, setShowOnlyDisagreements] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await fetchRatingLedger({
          limit: PAGE_SIZE,
          offset,
          surface,
          sku: sku === "all" ? null : sku,
          minRating: minRating === "any" ? null : Number(minRating),
          hasComment: comment === "any" ? null : comment === "with",
        });
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
        setCounts(data.counts);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [surface, sku, minRating, comment, offset]);

  // Reset offset whenever a filter other than the page cursor changes.
  useEffect(() => {
    setOffset(0);
  }, [surface, sku, minRating, comment, showOnlyDisagreements]);

  const skuOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.sku) seen.add(r.sku);
    }
    return Array.from(seen).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (!showOnlyDisagreements) return rows;
    return rows.filter((r) => {
      if (r.judge_rating_overall == null || r.rating == null) return false;
      return Math.abs(r.rating - r.judge_rating_overall) >= 2;
    });
  }, [rows, showOnlyDisagreements]);

  const hasMore = offset + rows.length < total;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + rows.length, total);

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Page heading */}
      <PageHeading
        eyebrow="Lab · Quality"
        title="Rating ledger"
        sub="Every rated iteration across legacy Lab, Listings Lab, and production scenes. Filter by surface, SKU, rating, or comment to spot routing wins and regressions."
      />

      {/* KPI strip */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Total ratings"
          value={total || rows.length}
          sub="all surfaces combined"
          delta={null}
        />
        <KpiCard
          label="Legacy Lab"
          value={counts.legacy_lab}
          sub="prompt_lab_iterations"
          delta={null}
        />
        <KpiCard
          label="Listings Lab"
          value={counts.listings_lab}
          sub="listing_scene_iterations"
          delta={null}
        />
        <KpiCard
          label="Production"
          value={counts.prod}
          sub="scene_ratings"
          delta={null}
        />
      </section>

      {/* Filter bar */}
      <Card padding={20}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>

          {/* Surface filter */}
          <FilterChip icon={<Icon name="filter" size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />}>
            <select
              value={surface}
              onChange={(e) => setSurface(e.target.value as SurfaceFilter)}
              style={SELECT_STYLE}
            >
              <option value="all">All surfaces</option>
              <option value="legacy_lab">Legacy Lab</option>
              <option value="listings_lab">Listings Lab</option>
              <option value="prod">Production</option>
            </select>
            <Icon name="chevron-down" size={11} style={{ color: "var(--muted)", flexShrink: 0, pointerEvents: "none" }} />
          </FilterChip>

          {/* SKU filter */}
          <FilterChip icon={<Icon name="cube" size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />}>
            <select
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              style={SELECT_STYLE}
            >
              <option value="all">All SKUs</option>
              {skuOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <Icon name="chevron-down" size={11} style={{ color: "var(--muted)", flexShrink: 0, pointerEvents: "none" }} />
          </FilterChip>

          {/* Min rating filter */}
          <FilterChip icon={<Icon name="sliders" size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />}>
            <select
              value={minRating}
              onChange={(e) => setMinRating(e.target.value as MinRatingFilter)}
              style={SELECT_STYLE}
            >
              <option value="any">Any rating</option>
              <option value="2">2+ stars</option>
              <option value="3">3+ stars</option>
              <option value="4">4+ stars</option>
              <option value="5">5 stars only</option>
            </select>
            <Icon name="chevron-down" size={11} style={{ color: "var(--muted)", flexShrink: 0, pointerEvents: "none" }} />
          </FilterChip>

          {/* Comment filter */}
          <FilterChip icon={<Icon name="search" size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />}>
            <select
              value={comment}
              onChange={(e) => setComment(e.target.value as CommentFilter)}
              style={SELECT_STYLE}
            >
              <option value="any">Any comment</option>
              <option value="with">With comment</option>
              <option value="without">No comment</option>
            </select>
            <Icon name="chevron-down" size={11} style={{ color: "var(--muted)", flexShrink: 0, pointerEvents: "none" }} />
          </FilterChip>

          {/* Disagreements toggle */}
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontSize: 12.5,
              color: "var(--ink-2)",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={showOnlyDisagreements}
              onChange={(e) => setShowOnlyDisagreements(e.target.checked)}
              style={{ accentColor: "var(--accent)", cursor: "pointer" }}
            />
            Disagreements only
          </label>

          {/* Row count */}
          <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
            {loading ? "Loading…" : `${total} row${total === 1 ? "" : "s"}`}
          </div>
        </div>
      </Card>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(196,74,74,0.3)",
            background: "rgba(196,74,74,0.05)",
            fontSize: 13,
            color: "var(--bad)",
          }}
        >
          {error}
        </div>
      )}

      {/* Table card */}
      <Card padding={0} style={{ overflow: "hidden" }}>

        {/* Column header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "72px 1fr 130px 140px 1fr 110px 90px",
            gap: 16,
            padding: "10px 18px",
            borderBottom: "1px solid var(--line)",
            alignItems: "center",
          }}
        >
          <span className="le-d-label">Thumb</span>
          <span className="le-d-label">Iteration</span>
          <span className="le-d-label">SKU</span>
          <span className="le-d-label">Rating</span>
          <span className="le-d-label">Comment</span>
          <span className="le-d-label">When</span>
          <span className="le-d-label">Clip</span>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ padding: "64px 0", display: "flex", justifyContent: "center", alignItems: "center" }}>
            <svg
              width={22}
              height={22}
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--muted)"
              strokeWidth={2}
              strokeLinecap="round"
              style={{ animation: "spin 1s linear infinite" }}
            >
              <path d="M21 12a9 9 0 1 1-6.22-8.56" />
            </svg>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Empty state */}
        {!loading && visibleRows.length === 0 && (
          <div style={{ padding: "64px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            {showOnlyDisagreements
              ? "No disagreements found in this page."
              : "No rated iterations match this filter."}
          </div>
        )}

        {/* Rows */}
        {!loading && visibleRows.length > 0 && (
          <div>
            {visibleRows.map((row, i) => (
              <LedgerTableRow
                key={`${row.surface}-${row.iteration_id}`}
                row={row}
                isLast={i === visibleRows.length - 1}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
            Showing {showingFrom}–{showingTo} of {total}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="le-btn-ghost"
              style={{
                ...GHOST_BTN,
                opacity: offset === 0 || loading ? 0.4 : 1,
                cursor: offset === 0 || loading ? "not-allowed" : "pointer",
              }}
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <button
              className="le-btn-ghost"
              style={{
                ...GHOST_BTN,
                opacity: !hasMore || loading ? 0.4 : 1,
                cursor: !hasMore || loading ? "not-allowed" : "pointer",
              }}
              disabled={!hasMore || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── table row ────────────────────────────────────────────────────
function LedgerTableRow({ row, isLast }: { row: LedgerRow; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);

  const surfaceStyle = SURFACE_STYLE[row.surface];

  // retrieval tone
  let retrievalTone: "ready" | "partial" | "missing";
  if (row.has_embedding && row.has_model_used) {
    retrievalTone = "ready";
  } else if (row.has_embedding && !row.has_model_used) {
    retrievalTone = "partial";
  } else {
    retrievalTone = "missing";
  }
  const retrievalStyle = RETRIEVAL_STYLE[retrievalTone];

  // display id: order_id preferred, fallback to iteration_id slice
  const displayId = row.order_id ?? (row.iteration_id ? row.iteration_id.slice(0, 8) : "—");

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "72px 1fr 130px 140px 1fr 110px 90px",
        gap: 16,
        padding: "14px 18px",
        borderBottom: isLast ? "none" : "1px solid var(--line-2)",
        alignItems: "center",
        background: hovered ? "rgba(11,11,16,0.02)" : "transparent",
        transition: "background .15s",
      }}
    >
      {/* Thumb */}
      <div>
        {row.source_image_url ? (
          <a href={row.source_image_url} target="_blank" rel="noreferrer">
            <img
              src={row.source_image_url}
              alt="source"
              loading="lazy"
              style={{
                width: 56,
                height: 40,
                objectFit: "cover",
                borderRadius: "var(--radius-sm)",
                display: "block",
                border: "1px solid var(--line-2)",
              }}
            />
          </a>
        ) : (
          <div
            style={{
              width: 56,
              height: 40,
              borderRadius: "var(--radius-sm)",
              background: "rgba(11,11,16,0.05)",
              display: "grid",
              placeItems: "center",
              color: "var(--muted-2)",
              border: "1px dashed var(--line)",
            }}
          >
            <Icon name="image" size={14} />
          </div>
        )}
      </div>

      {/* Iteration meta */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--ink)", fontVariantNumeric: "tabular-nums", marginBottom: 4 }}>
          {displayId}
        </div>
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: "var(--radius-pill)",
            background: surfaceStyle.bg,
            color: surfaceStyle.color,
            fontSize: 10.5,
            fontWeight: 500,
          }}
        >
          {surfaceStyle.label}
        </span>
        {row.listing_name && (
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              marginTop: 4,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {row.listing_name}
          </div>
        )}
      </div>

      {/* SKU */}
      <div style={{ minWidth: 0 }}>
        {row.sku ? (
          <span
            style={{
              display: "inline-block",
              padding: "3px 7px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(11,11,16,0.05)",
              border: "1px solid var(--line-2)",
              fontSize: 11,
              fontFamily: "var(--le-font-mono)",
              color: "var(--ink-2)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "100%",
            }}
          >
            {row.sku}
          </span>
        ) : row.provider ? (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{row.provider}</span>
        ) : (
          <span style={{ fontSize: 11, color: "var(--muted-2)" }}>—</span>
        )}
        {/* retrieval indicator */}
        <div style={{ marginTop: 4 }}>
          <span
            style={{
              display: "inline-block",
              padding: "2px 6px",
              borderRadius: "var(--radius-pill)",
              background: retrievalStyle.bg,
              color: retrievalStyle.color,
              fontSize: 10,
              fontWeight: 500,
            }}
          >
            {retrievalStyle.label}
          </span>
        </div>
      </div>

      {/* Rating */}
      <div>
        {row.rating == null ? (
          <span style={{ fontSize: 11.5, color: "var(--muted-2)" }}>unrated</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <StarRow value={row.rating} />
            {row.judge_rating_overall != null && (() => {
              const delta = Math.abs(row.rating - row.judge_rating_overall);
              const color = delta <= 1 ? "var(--muted)" : delta === 2 ? "var(--warn)" : "var(--bad)";
              return (
                <span style={{ fontSize: 10.5, color, fontVariantNumeric: "tabular-nums" }}>
                  Judge {row.judge_rating_overall}/5{delta >= 2 ? ` · D${delta}` : ""}
                </span>
              );
            })()}
          </div>
        )}
      </div>

      {/* Comment */}
      <div style={{ minWidth: 0 }}>
        {row.user_comment ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-2)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical" as const,
              overflow: "hidden",
              lineHeight: 1.45,
            }}
          >
            {row.user_comment}
          </div>
        ) : (
          <span style={{ fontSize: 12, color: "var(--muted-2)" }}>—</span>
        )}
        {row.rating_reasons && row.rating_reasons.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
            {row.rating_reasons.map((tag) => (
              <span
                key={tag}
                style={{
                  padding: "2px 6px",
                  borderRadius: "var(--radius-pill)",
                  border: "1px solid var(--line-2)",
                  fontSize: 10,
                  color: "var(--muted)",
                  background: "rgba(11,11,16,0.03)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* When */}
      <div style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
        {fmtRel(row.rated_at)}
      </div>

      {/* Clip link */}
      <div>
        {row.clip_url ? (
          <a
            href={row.clip_url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              color: "var(--accent)",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            <Icon name="external" size={13} />
            Open
          </a>
        ) : (
          <span style={{ fontSize: 12, color: "var(--muted-2)" }}>—</span>
        )}
      </div>
    </div>
  );
}
