import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Download, ArrowRight, Loader2, FileVideo } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import "@/v2/styles/v2.css";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const EYEBROW: CSSProperties = { fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" };
const PAGE_H1: CSSProperties = { fontFamily: "var(--le-font-sans)", fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 0.98, color: "#fff", margin: 0 };
const PRIMARY_BTN: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 12, fontWeight: 500, background: "#fff", color: "#07080c", border: "none", borderRadius: 2, cursor: "pointer", fontFamily: "var(--le-font-sans)", textDecoration: "none" };
const GHOST_BTN: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 11, fontWeight: 500, background: "transparent", color: "#fff", border: "1px solid rgba(220,230,255,0.18)", borderRadius: 2, cursor: "pointer", fontFamily: "var(--le-font-sans)", textDecoration: "none" };
const GHOST_LIGHT_BTN: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 11, fontWeight: 500, background: "transparent", color: "rgba(255,255,255,0.62)", border: "none", borderRadius: 2, cursor: "pointer", fontFamily: "var(--le-font-sans)", textDecoration: "none" };

const statusLabel: Record<string, string> = {
  queued: "Queued",
  ingesting: "Ingesting",
  analyzing: "Analyzing",
  scripting: "Directing",
  generating: "Generating",
  qc: "Quality control",
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

export default function AccountProperties() {
  const { user } = useAuth();

  const { data: properties, isLoading } = useQuery({
    queryKey: ["account-properties", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("submitted_by", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!properties?.length) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE }}
        className="border border-dashed border-border bg-secondary/30 px-12 py-24 text-center"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center border border-border text-muted-foreground" style={{ borderRadius: 0 }}>
          <FileVideo className="h-5 w-5" strokeWidth={1.5} />
        </div>
        <h2 className="mt-8" style={PAGE_H1}>No listings yet.</h2>
        <p className="mx-auto mt-4 max-w-sm text-sm text-muted-foreground">
          Submit your first listing and your videos will appear here for download and tracking.
        </p>
        <Link to="/upload" className="mt-10 inline-flex" style={PRIMARY_BTN}>
          Create your first listing
          <ArrowRight className="h-4 w-4" />
        </Link>
      </motion.div>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-6">
        <div>
          <span style={EYEBROW}>— Listings</span>
          <h2 className="mt-3" style={PAGE_H1}>
            {properties.length} {properties.length === 1 ? "video" : "videos"}
          </h2>
        </div>
        <Link to="/upload" style={PRIMARY_BTN}>
          New listing
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* Editorial table */}
      <div className="mt-12 border-t border-border">
        <div className="grid grid-cols-[3fr_1.5fr_0.7fr_1fr_1.4fr] gap-6 border-b border-border py-4" style={{ background: "rgba(255,255,255,0.03)" }}>
          <span style={EYEBROW}>Property</span>
          <span style={EYEBROW}>Status</span>
          <span className="text-right" style={EYEBROW}>Photos</span>
          <span style={EYEBROW}>Submitted</span>
          <span className="text-right" style={EYEBROW}>Deliverables</span>
        </div>

        {properties.map((p, i) => {
          const tone = statusTone[p.status] || "text-foreground";
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: i * 0.04, ease: EASE }}
              className="group grid grid-cols-[3fr_1.5fr_0.7fr_1fr_1.4fr] items-center gap-6 border-b border-border py-6 transition-colors duration-500 hover:bg-secondary/40"
            >
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold tracking-[-0.01em]">{p.address}</h3>
                <p className="tabular mt-1 text-xs text-muted-foreground">
                  {p.bedrooms}bd · {p.bathrooms}ba · ${p.price?.toLocaleString()}
                </p>
              </div>
              <span className={`label ${tone}`}>{statusLabel[p.status] || p.status}</span>
              <span className="tabular text-right text-sm text-muted-foreground">{p.photo_count}</span>
              <span className="tabular text-xs text-muted-foreground">
                {new Date(p.created_at).toLocaleDateString()}
              </span>
              <div className="flex items-center justify-end gap-2">
                {p.status === "complete" ? (
                  <>
                    {p.horizontal_video_url && (
                      <a href={p.horizontal_video_url} target="_blank" rel="noopener noreferrer" style={GHOST_BTN}>
                        <Download className="h-3.5 w-3.5" /> 16:9
                      </a>
                    )}
                    {p.vertical_video_url && (
                      <a href={p.vertical_video_url} target="_blank" rel="noopener noreferrer" style={GHOST_BTN}>
                        <Download className="h-3.5 w-3.5" /> 9:16
                      </a>
                    )}
                  </>
                ) : (
                  <Link to={`/status/${p.id}`} style={GHOST_LIGHT_BTN}>
                    Track
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
