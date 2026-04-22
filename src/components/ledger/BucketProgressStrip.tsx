import { useEffect, useRef, useState } from "react";
import { Loader2, Trophy, CircleDashed, CircleDot } from "lucide-react";
import {
  fetchBucketProgress,
  type BucketProgress,
  type BucketProgressResponse,
} from "@/lib/bucketProgressApi";

const POLL_INTERVAL_MS = 30_000;
const MIN_ITERATIONS_DISPLAY = 3;

export interface BucketClickPayload {
  room_type: string;
  camera_movement: string;
  bucket_id: string;
}

interface Props {
  activeBucketId: string | null;
  onBucketClick: (payload: BucketClickPayload | null) => void;
}

export function BucketProgressStrip({ activeBucketId, onBucketClick }: Props) {
  const [data, setData] = useState<BucketProgressResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function load(isInitial: boolean) {
      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;
      try {
        const res = await fetchBucketProgress(controller.signal);
        if (cancelled) return;
        setData(res);
        setLastUpdatedAt(new Date());
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled && isInitial) setLoadingInitial(false);
      }
    }

    load(true);

    function tick() {
      if (document.visibilityState === "visible") load(false);
    }
    timer = setInterval(tick, POLL_INTERVAL_MS);

    function onVisibility() {
      if (document.visibilityState === "visible") load(false);
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      inFlightRef.current?.abort();
    };
  }, []);

  if (loadingInitial) {
    return (
      <div className="flex items-center gap-3 border border-border bg-background p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading bucket progress…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        Bucket progress failed to load: {error}
      </div>
    );
  }

  const buckets = data?.buckets ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="label text-muted-foreground">— Phase B scoreboard</span>
          <div className="mt-1 text-xs text-muted-foreground/80">
            5 quota-high (room × movement) buckets. Winner rule:{" "}
            <span className="tabular-nums">≥{data?.min_iterations_per_winner ?? MIN_ITERATIONS_DISPLAY}</span> iterations
            on one SKU + ≥{Math.round((data?.min_win_rate ?? 0.8) * 100)}% rated 4★+.
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
          {lastUpdatedAt
            ? `Updated ${lastUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · auto-refresh 30s`
            : "—"}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {buckets.map((bucket) => (
          <BucketCard
            key={bucket.bucket_id}
            bucket={bucket}
            active={activeBucketId === bucket.bucket_id}
            onClick={() =>
              onBucketClick(
                activeBucketId === bucket.bucket_id
                  ? null
                  : {
                      room_type: bucket.room_type,
                      camera_movement: bucket.camera_movement,
                      bucket_id: bucket.bucket_id,
                    },
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function BucketCard({
  bucket,
  active,
  onClick,
}: {
  bucket: BucketProgress;
  active: boolean;
  onClick: () => void;
}) {
  const topSku = bucket.sku_breakdown[0] ?? null;
  const status = bucket.status;
  const iterPct = Math.min(100, (bucket.total_iter / MIN_ITERATIONS_DISPLAY) * 100);
  const leading4pct = topSku ? Math.round(topSku.win_rate * 100) : 0;

  const statusStyles =
    status === "WINNER"
      ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300"
      : status === "NO_WINNER"
      ? "border-amber-400/50 bg-amber-400/10 text-amber-700 dark:text-amber-300"
      : "border-red-400/50 bg-red-400/10 text-red-700 dark:text-red-300";

  const StatusIcon = status === "WINNER" ? Trophy : status === "NO_WINNER" ? CircleDot : CircleDashed;
  const statusLabel = status === "WINNER" ? "Winner" : status === "NO_WINNER" ? "No winner" : "Empty";

  const containerClasses = [
    "group border bg-background p-4 text-left transition-colors",
    active ? "border-foreground" : "border-border hover:border-foreground/50",
  ].join(" ");

  return (
    <button type="button" onClick={onClick} className={containerClasses} aria-pressed={active}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{bucket.label}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
            {bucket.total_iter} iter · {bucket.sku_breakdown.length} SKU{bucket.sku_breakdown.length === 1 ? "" : "s"}
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.18em] ${statusStyles}`}
        >
          <StatusIcon className="h-3 w-3" /> {statusLabel}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <ProgressRow
          label={`iter / ${MIN_ITERATIONS_DISPLAY}+`}
          value={`${bucket.total_iter}`}
          pct={iterPct}
          tone={bucket.total_iter >= MIN_ITERATIONS_DISPLAY ? "ready" : "pending"}
        />
        <ProgressRow
          label={topSku ? `${topSku.sku} 4★+` : "leading SKU 4★+"}
          value={topSku ? `${topSku.rated_4plus_count}/${topSku.iter_count}` : "—"}
          pct={leading4pct}
          tone={topSku && topSku.win_rate >= 0.8 ? "ready" : "pending"}
        />
      </div>

      {bucket.winner ? (
        <div className="mt-3 border border-emerald-400/30 bg-emerald-400/5 px-2 py-1 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
          winner: {bucket.winner.sku} · {Math.round(bucket.winner.win_rate * 100)}%
        </div>
      ) : (
        <div className="mt-3 text-[11px] text-muted-foreground/70">
          {topSku ? `top: ${topSku.sku}` : "no SKU-identifiable iterations yet"}
        </div>
      )}
    </button>
  );
}

function ProgressRow({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: string;
  pct: number;
  tone: "ready" | "pending";
}) {
  const barClasses = tone === "ready" ? "bg-emerald-400/80" : "bg-amber-400/70";
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
        <span>{label}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{value}</span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden bg-secondary/40">
        <div className={`h-full ${barClasses}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}
