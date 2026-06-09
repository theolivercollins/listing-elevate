// ModelFeedbackPanel — append-only qualitative feedback under each rendered clip.
//
// Shows prior feedback rows (date + text), a textarea to add new feedback, and
// a collapse/expand chevron. Default state: collapsed when no rows, expanded
// when at least one row exists.
//
// Design constraints (Oliver):
//  - var(--le-font-sans) throughout — no monospace, no JetBrains Mono.
//  - Append-only — no edit / delete UI in MVP.
//  - Sits flush below the video player, clearly distinct DOM region.
//
// Spec: docs/specs/2026-05-24-v1.1-quality-veo-feedback-design.md §3

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, MessageSquare } from "lucide-react";
import {
  listIterationFeedback,
  createIterationFeedback,
  type PromptLabModelFeedback,
} from "@/lib/promptLabApi";

interface ModelFeedbackPanelProps {
  iterationId: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function ModelFeedbackPanel({ iterationId }: ModelFeedbackPanelProps) {
  const [rows, setRows] = useState<PromptLabModelFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load existing feedback on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listIterationFeedback(iterationId)
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          // Default: expand when rows exist, collapse when empty.
          setExpanded(data.length > 0);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[ModelFeedbackPanel] load failed:", err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [iterationId]);

  async function handleSubmit() {
    const trimmed = comment.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const newRow = await createIterationFeedback(iterationId, trimmed);
      // Append new row to list (API returns ASC; new row is latest).
      setRows((prev) => [...prev, newRow]);
      setComment("");
      setExpanded(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save feedback");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd+Enter / Ctrl+Enter submits.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  const headerLabel = rows.length > 0
    ? `Feedback on this model (${rows.length})`
    : "Feedback on this model";

  return (
    <div
      data-lane="feedback-panel"
      style={{
        marginTop: 16,
        borderTop: "1px solid var(--line-2)",
        paddingTop: 12,
        fontFamily: "var(--le-font-sans)",
      }}
    >
      {/* Collapse / expand header */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.09em",
          color: "var(--muted)",
          fontFamily: "var(--le-font-sans)",
        }}
      >
        {expanded ? (
          <ChevronDown style={{ width: 12, height: 12 }} />
        ) : (
          <ChevronRight style={{ width: 12, height: 12 }} />
        )}
        <MessageSquare style={{ width: 11, height: 11 }} />
        {headerLabel}
      </button>

      {expanded && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Prior rows */}
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12 }}>
              <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
              Loading…
            </div>
          ) : rows.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((row) => (
                <div
                  key={row.id}
                  style={{
                    borderRadius: "var(--radius-sm)",
                    background: "var(--line-2)",
                    border: "1px solid var(--line-2)",
                    padding: "8px 12px",
                    fontSize: 12,
                    fontFamily: "var(--le-font-sans)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--muted)",
                      marginBottom: 4,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatDate(row.created_at)}
                  </div>
                  <div style={{ color: "var(--ink)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {row.comment}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
              No feedback yet on this iteration.
            </div>
          )}

          {/* Add new feedback */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <textarea
              ref={textareaRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={submitting}
              placeholder={`e.g. "tends to over-zoom on kitchens — prefer 0.5× speed" (⌘↵ to submit)`}
              rows={3}
              style={{
                padding: "9px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--line)",
                background: submitting ? "rgba(11,11,16,0.03)" : "var(--surface)",
                color: "var(--ink)",
                fontSize: 12,
                fontFamily: "var(--le-font-sans)",
                lineHeight: 1.5,
                resize: "vertical",
                minHeight: 70,
                outline: "none",
                width: "100%",
                boxSizing: "border-box",
                opacity: submitting ? 0.6 : 1,
              }}
            />
            {errorMsg && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--bad)",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(196,74,74,0.06)",
                  border: "1px solid rgba(196,74,74,0.15)",
                  padding: "4px 8px",
                }}
              >
                {errorMsg}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="le-btn-ghost"
                disabled={!comment.trim() || submitting}
                onClick={handleSubmit}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  opacity: !comment.trim() || submitting ? 0.5 : 1,
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                {submitting && <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />}
                {submitting ? "Saving…" : "Save feedback"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
