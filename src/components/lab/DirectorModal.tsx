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
import { X, Loader2, Play, Star, Clapperboard } from "lucide-react";
import {
  assembleLab,
  listAssemblies,
  assembleListing,
  listListingAssemblies,
  type LabIteration,
  type PromptLabAssembly,
  type PromptLabListingAssembly,
} from "@/lib/promptLabApi";
import type { LabListingIteration, LabListingScene } from "@/lib/labListingsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DirectorModalProps {
  source:
    | { kind: "session"; sessionId: string; iterations: LabIteration[] }
    | { kind: "listing"; listingId: string };
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

// ─── Library card ─────────────────────────────────────────────────────────────

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
  onRemove,
}: {
  sequenceItem: SequenceItem;
  item: LibraryItem | undefined;
  onRemove: () => void;
}) {
  return (
    <Reorder.Item
      value={sequenceItem}
      id={sequenceItem.key}
      whileDrag={{ scale: 1.05, boxShadow: "0 8px 24px rgba(11,11,16,0.18)" }}
      style={{ listStyle: "none" }}
    >
      <div
        style={{
          width: 96,
          flexShrink: 0,
          border: "1px solid var(--line)",
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--surface)",
          cursor: "grab",
          position: "relative",
          userSelect: "none",
        }}
      >
        <div style={{ width: 96, height: 54, background: "rgba(11,11,16,0.08)", overflow: "hidden" }}>
          {item?.clip_url && (
            <video
              src={item.clip_url}
              muted
              playsInline
              preload="metadata"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
            />
          )}
        </div>
        <div
          style={{
            padding: "3px 6px 4px",
            fontSize: 9.5,
            color: "var(--muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item?.label ?? "?"}
        </div>
        {/* Remove button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove from sequence"
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: "none",
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            lineHeight: 1,
          }}
        >
          <X style={{ width: 10, height: 10 }} />
        </button>
      </div>
    </Reorder.Item>
  );
}

// ─── DirectorModal ────────────────────────────────────────────────────────────

export function DirectorModal({ source, open, onClose }: DirectorModalProps) {
  // ── Listing source: fetch iterations + scenes on open ──────────────────────
  const [listingLibrary, setListingLibrary] = useState<LibraryItem[]>([]);
  const [listingLoading, setListingLoading] = useState(false);

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
  const library = source.kind === "session" ? sessionLibrary : listingLibrary;

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
  }, [open, source.kind === "session" ? source.sessionId : (source as { kind: "listing"; listingId: string }).listingId]);

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
      } else {
        result = await assembleListing(source.listingId, iterationIds);
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

  const isListingLoading = source.kind === "listing" && listingLoading;

  return (
    // Backdrop
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      {/* Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "90vw",
          height: "90vh",
          maxWidth: 1400,
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
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
            padding: "14px 20px",
            borderBottom: "1px solid var(--line)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Clapperboard style={{ width: 16, height: 16, color: "var(--accent)" }} />
            <span
              style={{
                fontWeight: 600,
                fontSize: 15,
                letterSpacing: "-0.015em",
                color: "var(--ink)",
              }}
            >
              Direct
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
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--muted)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 4,
              borderRadius: 6,
            }}
            title="Close"
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
          {/* ── Library (left ~35%) ── */}
          <div
            style={{
              width: "35%",
              flexShrink: 0,
              borderRight: "1px solid var(--line)",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "12px 14px 8px",
                borderBottom: "1px solid var(--line-2)",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--muted)",
                }}
              >
                {isListingLoading
                  ? "Library — loading…"
                  : `Library — ${library.length} rendered clip${library.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {isListingLoading ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "32px 0",
                    justifyContent: "center",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
                  Loading clips…
                </div>
              ) : library.length === 0 ? (
                <div
                  style={{
                    padding: "32px 0",
                    textAlign: "center",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  No rendered clips yet. Render some iterations first.
                </div>
              ) : (
                library.map((item) => (
                  <LibraryCard
                    key={item.id}
                    item={item}
                    onClick={() => addToSequence(item.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* ── Sequence + footer + output (right ~65%) ── */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            {/* Sequence label */}
            <div
              style={{
                padding: "12px 16px 8px",
                borderBottom: "1px solid var(--line-2)",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--muted)",
                }}
              >
                Sequence — {sequence.length} clip{sequence.length === 1 ? "" : "s"}
              </span>
            </div>

            {/* Sequence drag area */}
            <div
              style={{
                flexShrink: 0,
                overflowX: "auto",
                overflowY: "hidden",
                padding: "14px 16px",
                minHeight: 108,
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid var(--line-2)",
              }}
            >
              {sequence.length === 0 ? (
                <div
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px dashed var(--line)",
                    borderRadius: 8,
                    padding: "20px 24px",
                    fontSize: 12,
                    color: "var(--muted)",
                    minHeight: 80,
                  }}
                >
                  Click clips from the library to add them, drag to reorder, ✕ to remove.
                </div>
              ) : (
                <Reorder.Group
                  axis="x"
                  values={sequence}
                  onReorder={setSequence}
                  style={{ display: "flex", gap: 8, listStyle: "none", margin: 0, padding: 0 }}
                >
                  {sequence.map((item, idx) => (
                    <SequenceCard
                      key={item.key}
                      sequenceItem={item}
                      item={libraryMap.get(item.iteration_id)}
                      onRemove={() => removeFromSequence(idx)}
                    />
                  ))}
                </Reorder.Group>
              )}
            </div>

            {/* Footer: Generate + status */}
            <div
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderBottom: "1px solid var(--line-2)",
              }}
            >
              <button
                type="button"
                onClick={handleGenerate}
                disabled={sequence.length === 0 || status === "assembling"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background:
                    sequence.length === 0 || status === "assembling"
                      ? "rgba(11,11,16,0.1)"
                      : "var(--ink)",
                  color:
                    sequence.length === 0 || status === "assembling"
                      ? "var(--muted)"
                      : "var(--surface)",
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
              <span
                style={{
                  fontSize: 12,
                  color: statusColor,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {statusLine}
              </span>
            </div>

            {/* Output video — shown after complete */}
            <div ref={outputRef} style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {status === "complete" && assembledUrl ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.12em",
                      color: "var(--muted)",
                    }}
                  >
                    Output
                  </div>
                  <video
                    key={assembledUrl}
                    controls
                    src={assembledUrl}
                    style={{
                      maxWidth: "100%",
                      maxHeight: 360,
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--line)",
                      display: "block",
                    }}
                  />
                  <a
                    href={assembledUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, color: "var(--muted)", textDecoration: "underline" }}
                  >
                    Open in new tab
                  </a>
                </div>
              ) : status === "idle" || status === "failed" ? (
                <div style={{ padding: "24px 0", fontSize: 12, color: "var(--muted-2)" }}>
                  Assembled video will appear here after generation.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
