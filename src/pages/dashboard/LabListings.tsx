import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus, FlaskConical, ArrowRight, Clock, CheckCircle, AlertTriangle } from "lucide-react";
import { listListings, type LabListing } from "@/lib/labListingsApi";
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
const PRIMARY_BTN: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  fontSize: 12,
  fontWeight: 500,
  background: "#fff",
  color: "#07080c",
  border: "none",
  borderRadius: 2,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
};
const BADGE: CSSProperties = {
  borderRadius: 0,
  fontFamily: "var(--le-font-mono)",
  fontSize: 9,
  letterSpacing: "0.18em",
};

const STATUS_CHIP: Record<string, { label: string; classes: string; Icon: typeof Clock }> = {
  draft: { label: "Draft", classes: "bg-muted/50 text-muted-foreground", Icon: Clock },
  analyzing: { label: "Analyzing", classes: "bg-amber-400/20 text-amber-700", Icon: Clock },
  directing: { label: "Directing", classes: "bg-sky-400/20 text-sky-700", Icon: Clock },
  ready_to_render: { label: "Ready to render", classes: "bg-emerald-400/20 text-emerald-700", Icon: CheckCircle },
  rendering: { label: "Rendering", classes: "bg-amber-400/20 text-amber-700", Icon: Clock },
  complete: { label: "Complete", classes: "bg-emerald-500/20 text-emerald-700", Icon: CheckCircle },
  failed: { label: "Failed", classes: "bg-red-400/20 text-red-700", Icon: AlertTriangle },
};

export default function LabListings() {
  const [listings, setListings] = useState<LabListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const { listings } = await listListings();
      setListings(listings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between">
        <div>
          <span style={EYEBROW}>— Prompt Lab</span>
          <h2 className="mt-3 flex items-center gap-3" style={PAGE_H1}>
            <FlaskConical className="h-6 w-6" style={{ color: "rgba(255,255,255,0.45)" }} />
            Listings
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Upload a batch of photos as if you were running a real listing. The director pairs photos into start/end keyframes, plans scenes, and you render clips. Rate each clip to feed the Knowledge Map.
          </p>
        </div>
        <Link to="/dashboard/development/lab/new" style={PRIMARY_BTN}>
          <Plus className="h-4 w-4" /> Create listing
        </Link>
      </div>

      {error && (
        <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

      {listings && listings.length === 0 && !loading && (
        <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No listings yet. Create your first — upload 10-30 photos and watch the director plan the video.
        </div>
      )}

      {listings && listings.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => {
            const chip = STATUS_CHIP[l.status] ?? STATUS_CHIP.draft;
            const Icon = chip.Icon;
            return (
              <Link
                key={l.id}
                to={`/dashboard/development/lab/${l.id}`}
                className="group border border-border bg-background p-5 transition hover:border-foreground"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium">{l.name}</h3>
                    <p className="mt-1 text-[11px] text-muted-foreground">{new Date(l.created_at).toLocaleDateString()}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 border border-border px-2 py-0.5 ${chip.classes}`} style={BADGE}>
                    <Icon className="h-3 w-3" /> {chip.label}
                  </span>
                  <span className="border border-border px-2 py-0.5 text-muted-foreground" style={BADGE}>
                    {l.model_name}
                  </span>
                </div>
                {l.total_cost_cents > 0 && (
                  <div className="mt-3 text-[11px] text-muted-foreground">
                    Spend: ${(l.total_cost_cents / 100).toFixed(2)}
                  </div>
                )}
                {l.notes && <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{l.notes}</p>}
              </Link>
            );
          })}
        </div>
      )}

    </div>
  );
}
