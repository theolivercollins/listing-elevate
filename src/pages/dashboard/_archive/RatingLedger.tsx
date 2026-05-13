import { useEffect, useMemo, useState } from "react";
import { Loader2, Star, ImageOff, FilmIcon, ExternalLink, MessageSquare, MessageSquareOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchRatingLedger, type LedgerRow, type LedgerSurface } from "@/lib/ratingLedgerApi";

type SurfaceFilter = LedgerSurface | "all";
type CommentFilter = "any" | "with" | "without";
type MinRatingFilter = "any" | "2" | "3" | "4" | "5";

const SURFACE_CHIP: Record<LedgerSurface, { label: string; classes: string }> = {
  legacy_lab: { label: "Legacy Lab", classes: "bg-slate-400/15 text-slate-700 dark:text-slate-300" },
  listings_lab: { label: "Listings Lab", classes: "bg-sky-400/15 text-sky-700 dark:text-sky-300" },
  prod: { label: "Production", classes: "bg-emerald-400/15 text-emerald-700 dark:text-emerald-300" },
};

const PAGE_SIZE = 50;

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

  return (
    <div className="space-y-10">
      <div>
        <span className="label text-muted-foreground">— Transparency</span>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">Rating ledger</h2>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Every rating you've ever given, linked to its source image, the clip it produced, the SKU
          that rendered it, and whether it's currently feeding retrieval. Three surfaces unified:
          legacy Prompt Lab, Phase 2.8 Listings Lab, and production scene_ratings.
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile label="Legacy Lab" value={counts.legacy_lab} hint="prompt_lab_iterations" />
        <SummaryTile label="Listings Lab" value={counts.listings_lab} hint="prompt_lab_listing_scene_iterations" />
        <SummaryTile label="Production" value={counts.prod} hint="scene_ratings" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={surface} onValueChange={(v) => setSurface(v as SurfaceFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All surfaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All surfaces</SelectItem>
            <SelectItem value="legacy_lab">Legacy Lab</SelectItem>
            <SelectItem value="listings_lab">Listings Lab</SelectItem>
            <SelectItem value="prod">Production</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sku} onValueChange={setSku}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All SKUs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All SKUs</SelectItem>
            {skuOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={minRating} onValueChange={(v) => setMinRating(v as MinRatingFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Any rating" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any rating</SelectItem>
            <SelectItem value="2">2★ and up</SelectItem>
            <SelectItem value="3">3★ and up</SelectItem>
            <SelectItem value="4">4★ and up</SelectItem>
            <SelectItem value="5">5★ only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={comment} onValueChange={(v) => setComment(v as CommentFilter)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Comment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any comment</SelectItem>
            <SelectItem value="with">With comment</SelectItem>
            <SelectItem value="without">No comment</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
          <input
            type="checkbox"
            checked={showOnlyDisagreements}
            onChange={(e) => setShowOnlyDisagreements(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Disagreements only
        </label>
        <div className="ml-auto text-xs text-muted-foreground">
          {loading ? "Loading…" : `${total} row${total === 1 ? "" : "s"}`}
        </div>
      </div>

      {error && (
        <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      {/* Table */}
      <div className="border border-border bg-background">
        <div className="hidden items-center gap-4 border-b border-border/60 bg-secondary/30 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground md:grid md:grid-cols-[96px_140px_160px_110px_1fr_140px_120px_80px_120px]">
          <span>Image</span>
          <span>Clip</span>
          <span>SKU</span>
          <span>Rating</span>
          <span>Reasons + comment</span>
          <span>Listing / scene</span>
          <span>Surface</span>
          <span>Judge</span>
          <span>Retrieval</span>
        </div>
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {showOnlyDisagreements ? "No disagreements found in this page." : "No rated rows match these filters yet."}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {visibleRows.map((row) => (
              <LedgerRowView key={`${row.surface}-${row.iteration_id}`} row={row} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Rows {total === 0 ? 0 : offset + 1}–{Math.min(offset + rows.length, total)} of {total}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="border border-border/60 bg-background p-4">
      <div className="label text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">{hint}</div>
    </div>
  );
}

function LedgerRowView({ row }: { row: LedgerRow }) {
  const chip = SURFACE_CHIP[row.surface];
  return (
    <div className="grid items-start gap-4 px-4 py-4 md:grid-cols-[96px_140px_160px_110px_1fr_140px_120px_80px_120px]">
      <ImageThumb url={row.source_image_url} />
      <ClipThumb url={row.clip_url} />
      <div className="space-y-1 text-xs">
        <SkuChip sku={row.sku} provider={row.provider} />
        {row.order_id && (
          <div className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground tabular-nums">
            {row.order_id}
          </div>
        )}
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
          {new Date(row.rated_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </div>
      </div>
      <Stars rating={row.rating} />
      <div className="min-w-0 space-y-2 text-xs">
        {row.rating_reasons && row.rating_reasons.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {row.rating_reasons.map((tag) => (
              <span
                key={tag}
                className="border border-border bg-secondary/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {row.user_comment ? (
          <div className="flex items-start gap-1.5 text-muted-foreground">
            <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-3">{row.user_comment}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
            <MessageSquareOff className="h-3 w-3" />
            <span>no comment</span>
          </div>
        )}
      </div>
      <div className="min-w-0 text-xs">
        <div className="truncate font-medium">{row.listing_name ?? "—"}</div>
        {row.scene_id && (
          <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
            scene {row.scene_id.slice(0, 8)}
          </div>
        )}
      </div>
      <div>
        <span
          className={`inline-flex items-center border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${chip.classes}`}
        >
          {chip.label}
        </span>
      </div>
      <JudgeCell humanRating={row.rating} judgeRating={row.judge_rating_overall} />
      <RetrievalChip row={row} />
    </div>
  );
}

function JudgeCell({ humanRating, judgeRating }: { humanRating: number | null; judgeRating: number | null }) {
  if (judgeRating == null) {
    return <span className="text-[11px] text-muted-foreground/40 tabular-nums">—</span>;
  }

  const delta = humanRating != null ? Math.abs(humanRating - judgeRating) : null;

  let colorClass = "text-muted-foreground";
  let title = `Judge: ${judgeRating}/5`;
  if (delta != null) {
    if (delta <= 1) {
      colorClass = "text-muted-foreground";
      title += ` · Δ${delta} (agreement)`;
    } else if (delta === 2) {
      colorClass = "text-amber-600 dark:text-amber-400";
      title += ` · Δ${delta} (caution)`;
    } else {
      colorClass = "text-red-600 dark:text-red-400";
      title += ` · Δ${delta} (strong disagreement)`;
    }
  }

  return (
    <span
      className={`text-[11px] tabular-nums font-medium ${colorClass}`}
      title={title}
    >
      {judgeRating}/5
      {delta != null && delta >= 2 && (
        <span className="ml-1 text-[9px] opacity-70">Δ{delta}</span>
      )}
    </span>
  );
}

function ImageThumb({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="flex h-16 w-24 items-center justify-center border border-dashed border-border/60 bg-secondary/20 text-muted-foreground/40">
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      <img
        src={url}
        alt="source"
        loading="lazy"
        className="h-16 w-24 object-cover border border-border/60"
      />
    </a>
  );
}

function ClipThumb({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="flex h-20 w-36 items-center justify-center border border-dashed border-border/60 bg-secondary/20 text-muted-foreground/40">
        <FilmIcon className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div className="relative">
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        controls
        className="h-20 w-36 border border-border/60 bg-black object-cover"
      />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="absolute right-1 top-1 rounded-sm bg-black/60 p-1 text-white/80 transition hover:text-white"
        title="Open clip in new tab"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function SkuChip({ sku, provider }: { sku: string | null; provider: string | null }) {
  if (!sku && !provider) {
    return <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">no SKU</span>;
  }
  return (
    <span className="inline-flex items-center border border-border bg-secondary/30 px-1.5 py-0.5 font-mono text-[11px]">
      {sku ?? provider}
    </span>
  );
}

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) {
    return <span className="text-[11px] text-muted-foreground/50">unrated</span>;
  }
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i <= rating ? "fill-foreground text-foreground" : "text-muted-foreground/30"
          }`}
          strokeWidth={1.5}
        />
      ))}
    </div>
  );
}

function RetrievalChip({ row }: { row: LedgerRow }) {
  // Production + legacy Lab surface don't carry a per-SKU model_used on the
  // row itself — they record only the provider family. That's a coverage gap,
  // not a bug; amber reflects "signal reaches retrieval (embedding) but SKU
  // routing can't use it yet."
  const { has_embedding, has_model_used, surface } = row;
  let tone: "ready" | "partial" | "missing";
  let label: string;
  let detail: string;

  if (has_embedding && has_model_used) {
    tone = "ready";
    label = "Ready";
    detail = "embedding + SKU";
  } else if (has_embedding && !has_model_used) {
    tone = "partial";
    label = "Partial";
    detail = surface === "prod" ? "provider only" : "no SKU captured";
  } else {
    tone = "missing";
    label = "Missing";
    detail = "no embedding";
  }

  const classes =
    tone === "ready"
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300"
      : tone === "partial"
      ? "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300"
      : "border-red-400/40 bg-red-400/10 text-red-700 dark:text-red-300";

  return (
    <div className="space-y-1">
      <span className={`inline-flex items-center border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${classes}`}>
        {label}
      </span>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">{detail}</div>
      {row.recipe_id && (
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">recipe ✓</div>
      )}
    </div>
  );
}
