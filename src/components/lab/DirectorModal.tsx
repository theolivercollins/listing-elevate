/**
 * DirectorModal — v1.1 assembly editor.
 *
 * Left panel: library of rendered iterations (clip_url != null).
 * Right top: horizontal drag-to-reorder sequence.
 * Footer: Generate button + status line.
 * Bottom: assembled video output (appears after first successful assembly).
 *
 * Supports two sources:
 *   source.kind === 'session'  → Sessions Lab (prompt_lab_iterations)
 *   source.kind === 'listing'  → Listings Lab (prompt_lab_listing_scene_iterations)
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Reorder } from "framer-motion";
import { X, Loader2, Play, Star, HelpCircle, Copy, Pencil, Crop, Trash2 } from "lucide-react";
import {
  assembleLab,
  listAssemblies,
  assembleListing,
  listListingAssemblies,
  assembleLabBatch,
  listBatchAssemblies,
  getSession,
  type LabIteration,
  type PromptLabAssembly,
  type PromptLabListingAssembly,
} from "@/lib/promptLabApi";
import type { LabListingIteration, LabListingScene } from "@/lib/labListingsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DirectorModalProps {
  source:
    | { kind: "session"; sessionId: string; iterations: LabIteration[] }
    | { kind: "listing"; listingId: string }
    /** Batch source: assembles a video from iterations across multiple
     *  sessions sharing the same batch_label. Iterations are fetched on
     *  modal open via parallel getSession() calls. */
    | { kind: "batch"; batchLabel: string; sessionIds: string[] };
  open: boolean;
  onClose: () => void;
}

type AssembleStatus = "idle" | "assembling" | "complete" | "failed";

interface SequenceItem {
  iteration_id: string;
  /** Index-suffixed key so the same clip can appear multiple times. */
  key: string;
}

// Normalized item for the library, shared between session and listing sources
interface LibraryItem {
  id: string;
  clip_url: string;
  label: string;
  subLabel: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function skuShortLabel(sku: string | null | undefined): string {
  if (!sku) return "—";
  if (sku.includes("seedance")) return "Seedance";
  if (sku.includes("kling-v3")) return "Kling v3";
  if (sku.includes("kling-v2-6")) return "Kling v2.6";
  if (sku.includes("kling-v2-master")) return "v2 Master";
  if (sku.includes("runway")) return "Runway";
  return sku;
}

function sessionIterationToLibraryItem(it: LabIteration): LibraryItem | null {
  if (!it.clip_url) return null;
  const d = it.director_output_json;
  const label =
    d?.camera_movement
      ? `${it.iteration_number} · ${d.camera_movement.replace(/_/g, " ")}`
      : `Iteration ${it.iteration_number}`;
  const ratingPart =
    typeof it.rating === "number" ? `★${it.rating}` : null;
  const subParts = [skuShortLabel(it.model_used), ratingPart].filter(Boolean);
  return { id: it.id, clip_url: it.clip_url, label, subLabel: subParts.join(" · ") };
}

function listingIterationToLibraryItem(
  it: LabListingIteration,
  sceneMap: Map<string, LabListingScene>,
): LibraryItem | null {
  if (!it.clip_url) return null;
  const scene = sceneMap.get(it.scene_id);
  const sceneNum = scene?.scene_number ?? "?";
  const roomType = scene?.room_type ?? "";
  // e.g. "Scene 3 · kitchen"
  const label = `Scene ${sceneNum}${roomType ? ` · ${roomType.replace(/_/g, " ")}` : ""}`;
  const ratingPart = typeof it.rating === "number" ? `★${it.rating}` : null;
  const subParts = [skuShortLabel(it.model_used), ratingPart].filter(Boolean);
  return { id: it.id, clip_url: it.clip_url, label, subLabel: subParts.join(" · ") };
}

// ─── Library thumbnail (grid tile) ────────────────────────────────────────────

function LibraryThumbnail({ item, onClick }: { item: LibraryItem; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`Add ${item.label} to sequence`}
      style={{
        position: "relative",
        aspectRatio: "16 / 9",
        borderRadius: 8,
        overflow: "hidden",
        border: `1px solid ${hovered ? "rgba(11,11,16,0.35)" : "var(--line)"}`,
        background: "rgba(11,11,16,0.08)",
        cursor: "pointer",
        padding: 0,
        transition: "border-color 0.12s, transform 0.12s",
        transform: hovered ? "translateY(-1px)" : "none",
        fontFamily: "var(--le-font-sans)",
      }}
    >
      <video
        src={item.clip_url}
        muted
        playsInline
        preload="metadata"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
      />
      {/* Add overlay on hover */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(11,11,16,0) 40%, rgba(11,11,16,0.65) 100%)",
            display: "flex",
            alignItems: "flex-end",
            padding: "6px 8px",
            gap: 4,
            color: "#fff",
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.label}
          </span>
          <span style={{ fontSize: 14, lineHeight: 1, opacity: 0.9 }}>+</span>
        </div>
      )}
    </button>
  );
}

// ─── Library card (legacy list item — kept for compact use) ───────────────────

function LibraryCard({
  item,
  onClick,
}: {
  item: LibraryItem;
  onClick: () => void;
}) {
  const thumbStyle: CSSProperties = {
    width: 96,
    height: 54,
    borderRadius: 6,
    overflow: "hidden",
    flexShrink: 0,
    background: "rgba(11,11,16,0.08)",
    position: "relative",
    display: "block",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={`Add ${item.label} to sequence`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--surface)",
        cursor: "pointer",
        fontFamily: "var(--le-font-sans)",
        textAlign: "left",
        transition: "background 0.12s, border-color 0.12s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(11,11,16,0.04)";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(11,11,16,0.3)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--surface)";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--line)";
      }}
    >
      <div style={thumbStyle}>
        <video
          src={item.clip_url}
          muted
          playsInline
          preload="metadata"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
        />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.label}
        </div>
        {item.subLabel && (
          <div
            style={{
              marginTop: 2,
              fontSize: 10,
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              gap: 5,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.subLabel}
          </div>
        )}
      </div>
      <span style={{ fontSize: 18, flexShrink: 0, opacity: 0.35, lineHeight: 1 }}>+</span>
    </button>
  );
}

// ─── Sequence card (draggable) ─────────────────────────────────────────────────

function SequenceCard({
  sequenceItem,
  item,
  index,
  onRemove,
  onDuplicate,
}: {
  sequenceItem: SequenceItem;
  item: LibraryItem | undefined;
  index: number;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const chipBtn: CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: 6,
    border: "none",
    background: "rgba(0,0,0,0.55)",
    color: "#fff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  };
  return (
    <Reorder.Item
      value={sequenceItem}
      id={sequenceItem.key}
      whileDrag={{ scale: 1.04, boxShadow: "0 12px 30px rgba(11,11,16,0.22)" }}
      style={{ listStyle: "none" }}
    >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: 192,
          height: 108,
          flexShrink: 0,
          borderRadius: 10,
          overflow: "hidden",
          background: "rgba(11,11,16,0.08)",
          cursor: "grab",
          position: "relative",
          userSelect: "none",
          border: "1px solid var(--line)",
        }}
      >
        {item?.clip_url && (
          <video
            src={item.clip_url}
            muted
            playsInline
            preload="metadata"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
          />
        )}
        {/* Position number */}
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "rgba(0,0,0,0.65)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {index + 1}
        </div>
        {/* Action chips */}
        {hovered && (
          <div
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              display: "inline-flex",
              gap: 3,
            }}
          >
            <button
              type="button"
              title="Duplicate"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              style={chipBtn}
            >
              <Copy style={{ width: 11, height: 11 }} />
            </button>
            <button type="button" title="Edit (coming soon)" disabled style={{ ...chipBtn, opacity: 0.4, cursor: "not-allowed" }}>
              <Pencil style={{ width: 11, height: 11 }} />
            </button>
            <button type="button" title="Crop (coming soon)" disabled style={{ ...chipBtn, opacity: 0.4, cursor: "not-allowed" }}>
              <Crop style={{ width: 11, height: 11 }} />
            </button>
            <button
              type="button"
              title="Remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              style={chipBtn}
            >
              <Trash2 style={{ width: 11, height: 11 }} />
            </button>
          </div>
        )}
      </div>
    </Reorder.Item>
  );
}

// ─── DirectorModal ────────────────────────────────────────────────────────────

export function DirectorModal({ source, open, onClose }: DirectorModalProps) {
  // ── Listing/batch sources: fetched on open ─────────────────────────────────
  const [listingLibrary, setListingLibrary] = useState<LibraryItem[]>([]);
  const [listingLoading, setListingLoading] = useState(false);
  const [batchLibrary, setBatchLibrary] = useState<LibraryItem[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

  // ── Shared state ───────────────────────────────────────────────────────────
  const [sequence, setSequence] = useState<SequenceItem[]>([]);
  const [status, setStatus] = useState<AssembleStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [assembledUrl, setAssembledUrl] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Build session library from the passed-in iterations prop (session source)
  const sessionLibrary: LibraryItem[] =
    source.kind === "session"
      ? source.iterations.flatMap((it) => {
          const item = sessionIterationToLibraryItem(it);
          return item ? [item] : [];
        })
      : [];

  // The active library changes by source kind
  const library =
    source.kind === "session" ? sessionLibrary
    : source.kind === "listing" ? listingLibrary
    : batchLibrary;

  // Quick lookup map: id → LibraryItem
  const libraryMap = new Map(library.map((item) => [item.id, item]));

  // ── Fetch listing data on open ─────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    // Reset each time the modal opens
    setSequence([]);
    setStatus("idle");
    setErrorMsg(null);

    let cancelled = false;

    if (source.kind === "session") {
      // For sessions, just load the most-recent assembly for the inline video
      (async () => {
        try {
          const assemblies: PromptLabAssembly[] = await listAssemblies(source.sessionId);
          const latest = assemblies.find((a) => a.status === "complete" && a.assembled_url);
          if (latest?.assembled_url && !cancelled) {
            setAssembledUrl(latest.assembled_url);
            setStatus("complete");
          } else if (!cancelled) {
            setAssembledUrl(null);
          }
        } catch {
          // Best-effort; don't block the modal.
        }
      })();
    } else if (source.kind === "batch") {
      // Batch source: fetch iterations for every session in the batch
      // (parallel), flatten + label each clip with "Session N · scene desc",
      // then load the most-recent batch assembly for inline playback.
      const { batchLabel, sessionIds } = source;
      setBatchLoading(true);
      setBatchLibrary([]);
      setAssembledUrl(null);

      (async () => {
        try {
          const [sessionResults, assemblies] = await Promise.all([
            Promise.allSettled(sessionIds.map((id) => getSession(id))),
            listBatchAssemblies(batchLabel).catch(() => [] as PromptLabAssembly[]),
          ]);

          if (cancelled) return;

          // Flatten iterations across sessions; sort by parent session creation,
          // then iteration_number. Session-label prefix on each card so the
          // operator can identify "session 2 · push_in iter 3" vs "session 5 ·
          // orbit iter 1".
          const flattened: LibraryItem[] = [];
          sessionResults.forEach((res, sessionIndex) => {
            if (res.status !== "fulfilled") return;
            const { iterations } = res.value;
            for (const it of iterations) {
              const item = sessionIterationToLibraryItem(it);
              if (item) {
                flattened.push({
                  ...item,
                  label: `Session ${sessionIndex + 1} · ${item.label}`,
                });
              }
            }
          });
          setBatchLibrary(flattened);

          const latestAssembly = assemblies.find((a) => a.status === "complete" && a.assembled_url);
          if (latestAssembly?.assembled_url) {
            setAssembledUrl(latestAssembly.assembled_url);
            setStatus("complete");
          }
        } catch {
          // Best-effort
        } finally {
          if (!cancelled) setBatchLoading(false);
        }
      })();
    } else {
      // Listing source: fetch iterations + scenes from API, then load last assembly
      const listingId = source.listingId;
      setListingLoading(true);
      setListingLibrary([]);
      setAssembledUrl(null);

      (async () => {
        try {
          // Parallel: fetch listing detail (scenes + iterations) + last assembly
          const [detailRes, assemblies] = await Promise.allSettled([
            fetch(`/api/admin/prompt-lab/listings/${listingId}`).then((r) => r.json()) as Promise<{
              scenes: LabListingScene[];
              iterations: LabListingIteration[];
            }>,
            listListingAssemblies(listingId),
          ]);

          if (!cancelled) {
            if (detailRes.status === "fulfilled") {
              const { scenes, iterations } = detailRes.value;
              const sceneMap = new Map((scenes ?? []).map((s) => [s.id, s]));
              const items = (iterations ?? []).flatMap((it) => {
                const item = listingIterationToLibraryItem(it, sceneMap);
                return item ? [item] : [];
              });
              // Sort by scene_number, then iteration_number — consistent order
              items.sort((a, b) => {
                const aScene = (scenes ?? []).find((s) => {
                  const iter = (iterations ?? []).find((i) => i.id === a.id);
                  return iter ? s.id === iter.scene_id : false;
                });
                const bScene = (scenes ?? []).find((s) => {
                  const iter = (iterations ?? []).find((i) => i.id === b.id);
                  return iter ? s.id === iter.scene_id : false;
                });
                return (aScene?.scene_number ?? 0) - (bScene?.scene_number ?? 0);
              });
              setListingLibrary(items);
            }
            if (assemblies.status === "fulfilled") {
              const latestAssembly = (assemblies.value as PromptLabListingAssembly[]).find(
                (a) => a.status === "complete" && a.assembled_url,
              );
              if (latestAssembly?.assembled_url) {
                setAssembledUrl(latestAssembly.assembled_url);
                setStatus("complete");
              }
            }
          }
        } catch {
          // Best-effort
        } finally {
          if (!cancelled) setListingLoading(false);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    source.kind === "session"
      ? source.sessionId
      : source.kind === "listing"
        ? source.listingId
        : (source as { kind: "batch"; batchLabel: string }).batchLabel,
  ]);

  // ─── Add clip to sequence ──────────────────────────────────────────────────
  function addToSequence(iterationId: string) {
    setSequence((prev) => [
      ...prev,
      { iteration_id: iterationId, key: `${iterationId}-${prev.length}` },
    ]);
  }

  // ─── Remove by index ───────────────────────────────────────────────────────
  function removeFromSequence(index: number) {
    setSequence((prev) => prev.filter((_, i) => i !== index));
  }

  // ─── Duplicate at index ────────────────────────────────────────────────────
  function duplicateInSequence(index: number) {
    setSequence((prev) => {
      const orig = prev[index];
      if (!orig) return prev;
      const dup: SequenceItem = {
        iteration_id: orig.iteration_id,
        key: `${orig.iteration_id}-${prev.length}-${Date.now()}`,
      };
      const next = [...prev];
      next.splice(index + 1, 0, dup);
      return next;
    });
  }

  // ─── Preferences (display-only in v1, not wired to assemble API yet) ───────
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [branding, setBranding] = useState<"unbranded" | "branded" | "both">("unbranded");
  const [libraryTab, setLibraryTab] = useState<"media" | "vfx" | "audio">("media");

  // Read-only address line shown in Preferences. Real listing-address lookup
  // is deferred; we expose the source identifier so the operator can confirm
  // they're editing the right thing.
  const addressLabel =
    source.kind === "session"
      ? `Session · ${source.sessionId.slice(0, 8)}`
      : source.kind === "listing"
        ? `Listing · ${source.listingId.slice(0, 8)}`
        : `Batch · ${source.batchLabel}`;

  // ─── Generate ─────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (sequence.length === 0 || status === "assembling") return;
    setStatus("assembling");
    setErrorMsg(null);
    try {
      const iterationIds = sequence.map((s) => s.iteration_id);
      let result: { assembled_url: string };
      if (source.kind === "session") {
        result = await assembleLab(source.sessionId, iterationIds);
      } else if (source.kind === "listing") {
        result = await assembleListing(source.listingId, iterationIds);
      } else {
        result = await assembleLabBatch(source.batchLabel, iterationIds);
      }
      setAssembledUrl(result.assembled_url);
      setStatus("complete");
      // Scroll output into view
      setTimeout(
        () => outputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        100,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus("failed");
      setErrorMsg(msg);
    }
  }

  if (!open) return null;

  const statusLine =
    status === "idle"
      ? "Idle"
      : status === "assembling"
        ? "Assembling…"
        : status === "complete"
          ? "Complete"
          : `Failed: ${errorMsg ?? "unknown error"}`;

  const statusColor =
    status === "complete"
      ? "var(--good)"
      : status === "failed"
        ? "var(--bad)"
        : status === "assembling"
          ? "var(--accent)"
          : "var(--muted)";

  const isListingLoading =
    (source.kind === "listing" && listingLoading) ||
    (source.kind === "batch" && batchLoading);

  // ─── Render ────────────────────────────────────────────────────────────────

  const sectionLabel: CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--muted)",
  };

  const segTabBase: CSSProperties = {
    padding: "6px 12px",
    borderRadius: 999,
    border: "none",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "var(--le-font-sans)",
    transition: "background 0.15s, color 0.15s",
  };

  const prefToggleGroup: CSSProperties = {
    display: "inline-flex",
    padding: 3,
    background: "rgba(11,11,16,0.05)",
    borderRadius: 10,
    gap: 2,
    width: "100%",
  };

  const prefToggleBtn = (active: boolean): CSSProperties => ({
    flex: 1,
    padding: "8px 10px",
    borderRadius: 8,
    border: "none",
    background: active ? "var(--surface)" : "transparent",
    color: active ? "var(--ink)" : "var(--muted)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "var(--le-font-sans)",
    boxShadow: active ? "0 1px 2px rgba(11,11,16,0.08)" : "none",
    transition: "background 0.15s, color 0.15s",
  });

  const trackRailRow: CSSProperties = {
    display: "flex",
    alignItems: "center",
    minHeight: 60,
    paddingRight: 12,
    fontFamily: "var(--le-font-sans)",
  };

  return (
    // Backdrop
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: 12,
      }}
      onClick={onClose}
    >
      {/* Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 1600,
          height: "100%",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          boxShadow: "0 40px 80px -20px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "var(--le-font-sans)",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 20px",
            borderBottom: "1px solid var(--line)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontWeight: 700,
                fontSize: 17,
                letterSpacing: "-0.015em",
                color: "var(--ink)",
              }}
            >
              Create Video
            </span>
            <span
              style={{
                borderRadius: 6,
                background: "rgba(115,80,195,0.10)",
                padding: "2px 8px",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--accent)",
              }}
            >
              v1.1
            </span>
            {source.kind === "listing" && (
              <span
                style={{
                  borderRadius: 6,
                  background: "rgba(11,11,16,0.06)",
                  padding: "2px 8px",
                  fontSize: 10,
                  fontWeight: 500,
                  color: "var(--muted)",
                }}
              >
                Listing
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              title="Help (coming soon)"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--muted)",
                padding: 6,
                borderRadius: 6,
                display: "inline-flex",
              }}
            >
              <HelpCircle style={{ width: 16, height: 16 }} />
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--muted)",
                padding: 6,
                borderRadius: 6,
                display: "inline-flex",
              }}
              title="Close"
            >
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>

        {/* ── Top body: Library | Preview | Preferences ── */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
          {/* ── Library (left) ── */}
          <div
            style={{
              width: 320,
              flexShrink: 0,
              borderRight: "1px solid var(--line)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "12px 16px",
                borderBottom: "1px solid var(--line-2)",
                flexShrink: 0,
              }}
            >
              <span style={sectionLabel}>Library</span>
            </div>
            {/* Tabs */}
            <div
              style={{
                display: "flex",
                gap: 4,
                padding: "8px 14px",
                borderBottom: "1px solid var(--line-2)",
                flexShrink: 0,
              }}
            >
              {(["media", "vfx", "audio"] as const).map((tab) => {
                const active = libraryTab === tab;
                const enabled = tab === "media";
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => enabled && setLibraryTab(tab)}
                    disabled={!enabled}
                    style={{
                      ...segTabBase,
                      background: active ? "var(--ink)" : "transparent",
                      color: active ? "#fff" : enabled ? "var(--muted)" : "rgba(11,11,16,0.25)",
                      cursor: enabled ? "pointer" : "not-allowed",
                      textTransform: "capitalize",
                    }}
                  >
                    {tab}
                    {tab === "vfx" && (
                      <span style={{ marginLeft: 5, padding: "1px 5px", borderRadius: 4, fontSize: 9, background: "rgba(217,70,160,0.12)", color: "rgb(217,70,160)" }}>
                        NEW
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Thumbnail grid */}
            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {libraryTab !== "media" ? (
                <div style={{ padding: "32px 8px", textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                  {libraryTab === "vfx" ? "VFX library — coming soon." : "Audio library — coming soon."}
                </div>
              ) : isListingLoading ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "32px 0", justifyContent: "center", fontSize: 12, color: "var(--muted)" }}>
                  <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
                  Loading clips…
                </div>
              ) : library.length === 0 ? (
                <div style={{ padding: "32px 8px", textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
                  No rendered clips yet. Render some iterations first.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {library.map((item) => (
                    <LibraryThumbnail
                      key={item.id}
                      item={item}
                      onClick={() => addToSequence(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Preview (center) ── */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              minWidth: 0,
              background: "rgba(11,11,16,0.02)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 20px",
                borderBottom: "1px solid var(--line-2)",
                flexShrink: 0,
              }}
            >
              <Play style={{ width: 13, height: 13, color: "var(--muted)" }} />
              <span style={sectionLabel}>Preview</span>
            </div>
            <div
              ref={outputRef}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
                minHeight: 0,
              }}
            >
              {status === "complete" && assembledUrl ? (
                <video
                  key={assembledUrl}
                  controls
                  src={assembledUrl}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    borderRadius: 12,
                    background: "#000",
                    boxShadow: "0 20px 40px -16px rgba(0,0,0,0.35)",
                  }}
                />
              ) : (
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    maxWidth: 920,
                    aspectRatio: "16 / 9",
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "rgba(11,11,16,0.08)",
                    border: "1px solid var(--line)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                />
              )}
            </div>
          </div>

          {/* ── Preferences (right) ── */}
          <div
            style={{
              width: 280,
              flexShrink: 0,
              borderLeft: "1px solid var(--line)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 16px",
                borderBottom: "1px solid var(--line-2)",
                flexShrink: 0,
              }}
            >
              <span style={sectionLabel}>Preferences</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Listing address */}
              <div>
                <label style={{ ...sectionLabel, display: "block", marginBottom: 8 }}>Listing Address</label>
                <div
                  style={{
                    padding: "9px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--line)",
                    background: "var(--surface)",
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={addressLabel}
                >
                  {addressLabel}
                </div>
              </div>

              {/* Orientation */}
              <div>
                <label style={{ ...sectionLabel, display: "block", marginBottom: 8 }}>Orientation</label>
                <div style={prefToggleGroup}>
                  <button type="button" onClick={() => setOrientation("landscape")} style={prefToggleBtn(orientation === "landscape")}>
                    Landscape
                  </button>
                  <button type="button" onClick={() => setOrientation("portrait")} style={prefToggleBtn(orientation === "portrait")}>
                    Portrait
                  </button>
                </div>
              </div>

              {/* Branding */}
              <div>
                <label style={{ ...sectionLabel, display: "block", marginBottom: 8 }}>Branding</label>
                <div style={prefToggleGroup}>
                  <button type="button" onClick={() => setBranding("unbranded")} style={prefToggleBtn(branding === "unbranded")}>
                    Unbranded
                  </button>
                  <button type="button" onClick={() => setBranding("branded")} style={prefToggleBtn(branding === "branded")}>
                    Branded
                  </button>
                  <button type="button" onClick={() => setBranding("both")} style={prefToggleBtn(branding === "both")}>
                    Both
                  </button>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted-2)" }}>
                  Orientation + Branding are display-only in v1.1 — final video is always 16:9 unbranded.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Bottom timeline ── */}
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid var(--line)",
            background: "var(--surface)",
            display: "flex",
            flexDirection: "column",
            minHeight: 240,
            maxHeight: "42%",
          }}
        >
          {/* Timeline header: Video tabs + Speed ramp + Generate */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 16px",
              borderBottom: "1px solid var(--line-2)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {([1, 2, 3] as const).map((n) => {
                const active = n === 1;
                const enabled = n === 1;
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={!enabled}
                    style={{
                      ...segTabBase,
                      padding: "6px 14px",
                      borderRadius: 0,
                      background: active ? "rgba(244,63,140,0.10)" : "transparent",
                      color: active ? "rgb(217,70,160)" : enabled ? "var(--muted)" : "rgba(11,11,16,0.25)",
                      cursor: enabled ? "pointer" : "not-allowed",
                      borderBottom: active ? "2px solid rgb(217,70,160)" : "2px solid transparent",
                    }}
                  >
                    Video {n}
                  </button>
                );
              })}
              <button
                type="button"
                disabled
                style={{
                  ...segTabBase,
                  marginLeft: 8,
                  background: "rgba(244,63,140,0.10)",
                  color: "rgb(217,70,160)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  cursor: "not-allowed",
                  opacity: 0.7,
                }}
                title="Speed Ramp — coming soon"
              >
                Speed Ramp
              </button>
            </div>

            <div style={{ flex: 1 }} />

            <span style={{ fontSize: 12, color: statusColor, fontVariantNumeric: "tabular-nums" }}>
              {statusLine}
            </span>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={sequence.length === 0 || status === "assembling"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 18px",
                borderRadius: 12,
                border: "none",
                background:
                  sequence.length === 0 || status === "assembling"
                    ? "rgba(11,11,16,0.1)"
                    : "var(--ink)",
                color:
                  sequence.length === 0 || status === "assembling"
                    ? "var(--muted)"
                    : "#fff",
                fontFamily: "var(--le-font-sans)",
                fontSize: 13,
                fontWeight: 600,
                cursor:
                  sequence.length === 0 || status === "assembling" ? "not-allowed" : "pointer",
                transition: "background 0.15s",
              }}
            >
              {status === "assembling" ? (
                <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
              ) : (
                <Play style={{ width: 13, height: 13 }} />
              )}
              {status === "assembling" ? "Assembling…" : "Generate"}
            </button>
          </div>

          {/* Tracks: rail (left) + strips (right) */}
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {/* Rail */}
            <div
              style={{
                width: 110,
                flexShrink: 0,
                borderRight: "1px solid var(--line-2)",
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                background: "rgba(11,11,16,0.015)",
              }}
            >
              {[
                { label: "VIDEO", sub: `${sequence.length} ${sequence.length === 1 ? "clip" : "clips"}` },
                { label: "VFX", sub: "None" },
                { label: "TEXT", sub: "1 item" },
                { label: "AUDIO", sub: "1 track" },
              ].map((r) => (
                <div key={r.label} style={trackRailRow}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)", letterSpacing: "0.06em" }}>
                      {r.label}
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{r.sub}</span>
                  </div>
                </div>
              ))}
            </div>
            {/* Strips */}
            <div style={{ flex: 1, padding: "12px 16px", overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Video strip */}
              <div style={{ minHeight: 116, display: "flex", alignItems: "center" }}>
                {sequence.length === 0 ? (
                  <div
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px dashed var(--line)",
                      borderRadius: 10,
                      padding: "24px",
                      fontSize: 12,
                      color: "var(--muted)",
                      minHeight: 108,
                    }}
                  >
                    Click clips from the library to add them to the timeline. Drag to reorder.
                  </div>
                ) : (
                  <Reorder.Group
                    axis="x"
                    values={sequence}
                    onReorder={setSequence}
                    style={{ display: "flex", gap: 10, listStyle: "none", margin: 0, padding: 0, flexWrap: "nowrap" }}
                  >
                    {sequence.map((item, idx) => (
                      <SequenceCard
                        key={item.key}
                        sequenceItem={item}
                        item={libraryMap.get(item.iteration_id)}
                        index={idx}
                        onRemove={() => removeFromSequence(idx)}
                        onDuplicate={() => duplicateInSequence(idx)}
                      />
                    ))}
                  </Reorder.Group>
                )}
              </div>
              {/* VFX strip (placeholder) */}
              <div style={{ minHeight: 32, display: "flex", alignItems: "center" }}>
                <div style={{ width: "100%", height: 28, borderRadius: 8, background: "rgba(11,11,16,0.025)", border: "1px dashed var(--line)" }} />
              </div>
              {/* Text strip (address overlay) */}
              <div style={{ minHeight: 36, display: "flex", alignItems: "center" }}>
                <div
                  style={{
                    width: sequence.length > 0 ? "60%" : "30%",
                    height: 32,
                    borderRadius: 8,
                    background: "rgba(217,70,160,0.10)",
                    border: "1px solid rgba(217,70,160,0.35)",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "rgb(217,70,160)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={addressLabel}
                >
                  {addressLabel}
                </div>
              </div>
              {/* Audio strip (waveform placeholder) */}
              <div style={{ minHeight: 40, display: "flex", alignItems: "center" }}>
                <div
                  style={{
                    width: "100%",
                    height: 36,
                    borderRadius: 8,
                    background: "rgba(244,63,140,0.06)",
                    border: "1px solid rgba(244,63,140,0.20)",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 12px",
                    gap: 1.5,
                    overflow: "hidden",
                  }}
                  title="Music track placeholder"
                >
                  <span style={{ fontSize: 11, color: "rgb(217,70,160)", fontWeight: 600, marginRight: 8 }}>
                    Music
                  </span>
                  {/* Fake waveform bars */}
                  {Array.from({ length: 80 }).map((_, i) => {
                    const h = 4 + Math.abs(Math.sin(i * 0.7) * 16) + Math.abs(Math.cos(i * 1.3) * 8);
                    return (
                      <span
                        key={i}
                        style={{
                          width: 2,
                          height: h,
                          borderRadius: 1,
                          background: "rgba(217,70,160,0.55)",
                          flexShrink: 0,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
