/**
 * AgentHome — the agent (non-admin) dashboard landing.
 *
 * Replaces the placeholder with the real agent experience:
 *   - PageHeading with eyebrow "Your studio", greeting, primary CTA → /upload
 *   - "In production" section: active orders with StatusChip + ordered date
 *   - "Delivered" section: watch link + copy share link (horizontal_video_url)
 *   - "Needs attention" section: failed/needs_review orders shown plainly
 *   - EmptyState when all sections are empty — never sample data
 *
 * Data comes from the existing /api/properties endpoint which server-side
 * filters by user_id — no new endpoints needed.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchProperties } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Property } from "@/lib/types";
import { orderStatusEntry } from "@/lib/order-status";
import {
  EmptyState,
  PageHeading,
  PropertyThumb,
  StatusChip,
  SkeletonRow,
  fmtRel,
  SectionTitle,
} from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

// "delivered" is in the PropertyStatus union but absent from the API status
// filter calls below — include it so those orders appear in the Delivered bucket.
const DELIVERED_STATUSES = ["complete", "delivered"] as const;

// ─── Production statuses (non-terminal) ──────────────────────────────────────
const IN_PRODUCTION_STATUSES = [
  "queued",
  "ingesting",
  "analyzing",
  "scripting",
  "generating",
  "retry_1",
  "retry_2",
  "qc",
  "assembling",
];

// ─── Attention statuses (failed / needs_review) ───────────────────────────────
const ATTENTION_STATUSES = ["needs_review", "failed", "qc_hard_reject", "qc_soft_reject"];

// ─── Progress timeline ────────────────────────────────────────────────────────
// The 5 user-facing pipeline stages, in order. These are the canonical labels
// from ORDER_STATUS_MAP (via orderStatusEntry) — we never invent new stages.
// "Needs attention" is deliberately NOT here: those orders live in a different
// section and show no timeline.
const STAGE_ORDER = [
  "Received",
  "Crafting scenes",
  "Rendering",
  "In review",
  "Delivered",
] as const;

// Coarse human ETA buckets — qualitative only, NO countdown, NO invented number.
const SIX_HOURS_MS = 6 * 3600 * 1000;
const ONE_DAY_MS = 24 * 3600 * 1000;

/** Median of a numeric array (returns null if empty). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Qualitative ETA phrase derived from the agent's OWN delivered orders.
 * Returns null (phrase OMITTED) unless there are >= 3 delivered samples with a
 * truthy processing_time_ms to compute a stable median. The returned phrase
 * carries NO digits — coarse human bucket only.
 */
function etaPhrase(delivered: Property[]): string | null {
  const samples = delivered
    .map((p) => p.processing_time_ms)
    .filter((ms): ms is number => typeof ms === "number" && ms > 0);
  if (samples.length < 3) return null;
  const med = median(samples);
  if (med == null) return null;
  if (med < SIX_HOURS_MS) return "Usually ready within a few hours";
  if (med < ONE_DAY_MS) return "Usually ready within a day";
  return "Usually ready within a couple of days";
}

// ─── Per-order progress timeline strip ────────────────────────────────────────
function OrderTimeline({ property }: { property: Property }) {
  const activeLabel = orderStatusEntry(property.status).label;
  const activeIdx = STAGE_ORDER.indexOf(activeLabel as (typeof STAGE_ORDER)[number]);

  return (
    <div
      data-testid={`order-timeline-${property.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginTop: 10,
      }}
    >
      {STAGE_ORDER.map((stage, idx) => {
        const isDone = activeIdx >= 0 && idx < activeIdx;
        const isActive = idx === activeIdx;
        // checked → --good, lit → --accent, muted → --muted-2
        const dotColor = isDone
          ? "var(--good)"
          : isActive
            ? "var(--accent)"
            : "var(--muted-2)";
        const labelColor = isActive
          ? "var(--ink)"
          : isDone
            ? "var(--muted)"
            : "var(--muted-2)";
        return (
          <div
            key={stage}
            data-stage={stage}
            data-stage-active={isActive ? "true" : "false"}
            data-stage-done={isDone ? "true" : "false"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              flex: idx < STAGE_ORDER.length - 1 ? 1 : "0 0 auto",
              minWidth: 0,
            }}
          >
            <span
              aria-hidden
              style={{
                width: isActive ? 9 : 7,
                height: isActive ? 9 : 7,
                borderRadius: "50%",
                background: dotColor,
                flexShrink: 0,
                boxShadow: isActive ? "0 0 0 3px rgba(42,111,219,0.14)" : "none",
              }}
            />
            <span
              style={{
                fontSize: 10.5,
                fontWeight: isActive ? 600 : 500,
                color: labelColor,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {stage}
            </span>
            {idx < STAGE_ORDER.length - 1 && (
              <span
                aria-hidden
                style={{
                  flex: 1,
                  height: 1.5,
                  borderRadius: 1,
                  background: isDone ? "var(--good)" : "var(--line-2)",
                  minWidth: 8,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Derive a stable hue from an id string so PropertyThumb is consistent
function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h + id.charCodeAt(i) * 7) % 360;
  }
  return h;
}

// Copy text to clipboard with a brief visual flash
function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [value]);

  return (
    <button
      type="button"
      className="le-btn-ghost"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}
      onClick={handleCopy}
    >
      <Icon name={copied ? "check" : "external"} size={12} />
      {copied ? "Copied!" : label}
    </button>
  );
}

// ─── Order row (shared between sections) ─────────────────────────────────────
interface OrderRowProps {
  property: Property;
  /** Slot for section-specific actions (watch, copy, etc.) */
  actions?: React.ReactNode;
  /** Optional message shown below the address */
  note?: React.ReactNode;
}

function OrderRow({ property, actions, note }: OrderRowProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr auto",
        gap: 14,
        alignItems: "center",
        padding: "14px 0",
        borderBottom: "1px solid var(--line-2)",
      }}
    >
      <PropertyThumb hue={hueFromId(property.id)} size={44} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {property.address}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 4,
          }}
        >
          <StatusChip status={property.status} />
          <span style={{ fontSize: 11.5, color: "var(--muted-2)" }}>
            {fmtRel(property.created_at)}
          </span>
        </div>
        {note && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {note}
          </div>
        )}
      </div>
      {actions && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </div>
  );
}

// ─── Download icon (not in icons.tsx — inline SVG matching the shared style) ──
function DownloadIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v10M7 15l5 5 5-5" />
      <path d="M3 20h18" />
    </svg>
  );
}

// ─── Hero card for the newest delivered order ─────────────────────────────────
// Only rendered when the newest delivered order has horizontal_video_url.
// Falls back to a compact OrderRow when there is no URL.
interface DeliveredHeroProps {
  property: Property;
}

function DeliveredHeroCard({ property }: DeliveredHeroProps) {
  const url = property.horizontal_video_url!;
  const hue = hueFromId(property.id);

  return (
    <div
      data-testid="delivered-hero-card"
      style={{
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid var(--line-2)",
        marginBottom: 16,
      }}
    >
      {/* Poster + play overlay */}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Watch video for ${property.address}`}
        style={{
          display: "block",
          position: "relative",
          aspectRatio: "16/9",
          background: `hsl(${hue} 40% 14%)`,
          textDecoration: "none",
          overflow: "hidden",
        }}
      >
        {/* PropertyThumb fills the poster surface */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PropertyThumb hue={hue} size={80} />
        </div>
        {/* Play button overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.28)",
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.92)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
            }}
          >
            <Icon name="play" size={20} style={{ color: "var(--ink)", marginLeft: 2 }} />
          </div>
        </div>
      </a>

      {/* Address + actions */}
      <div
        style={{
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "var(--surface-2, var(--surface))",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--ink)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {property.address}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted-2)", marginTop: 2 }}>
            {fmtRel(property.created_at)}
          </div>
        </div>

        {/* Three flat actions: Watch · Download · Share */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {/* Watch */}
          <a
            data-testid="hero-action-watch"
            href={url}
            target="_blank"
            rel="noreferrer"
            className="le-btn-ghost"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              textDecoration: "none",
            }}
          >
            <Icon name="play" size={12} />
            Watch
          </a>

          {/* Download */}
          <a
            data-testid="hero-action-download"
            href={url}
            download
            className="le-btn-ghost"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              textDecoration: "none",
            }}
          >
            <DownloadIcon size={12} />
            Download
          </a>

          {/* Share — same CopyButton mechanic, relabeled */}
          <span data-testid="hero-action-share">
            <CopyButton value={url} label="Share" />
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="le-card" style={{ padding: 24 }}>
      {children}
    </section>
  );
}

// ─── AgentHome ────────────────────────────────────────────────────────────────
export default function AgentHome() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [pendingPayment, setPendingPayment] = useState<Property[]>([]);
  const [inProd, setInProd] = useState<Property[]>([]);
  const [delivered, setDelivered] = useState<Property[]>([]);
  const [attention, setAttention] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  // fetchError: surface API outages honestly rather than silently rendering
  // "No orders yet" when the user may have active orders.
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Parallel fetch. Server requires auth and filters by submitted_by for
        // non-admin callers. Errors propagate rather than silently returning [].
        const [prodRes, completedRes, deliveredRes, attentionRes] = await Promise.all([
          fetchProperties({ limit: 50 }),
          // "complete" status
          fetchProperties({ status: "complete", limit: 50 }),
          // "delivered" status — present in PropertyStatus union; must be fetched
          // separately since the API takes a single status string.
          fetchProperties({ status: "delivered" as Property["status"], limit: 50 }),
          fetchProperties({ status: "needs_review", limit: 50 }),
        ]);
        if (cancelled) return;

        // Filter prod results to only in-production statuses
        const prodProps = (prodRes.properties ?? []).filter((p: Property) =>
          IN_PRODUCTION_STATUSES.includes(p.status)
        );
        // Pending payment: agent started checkout but didn't complete it.
        const pendingPaymentProps = (prodRes.properties ?? []).filter(
          (p: Property) => (p.status as string) === "pending_payment"
        );
        // Attention: needs_review + any ATTENTION_STATUS from the prod bucket
        const attentionFromProd = (prodRes.properties ?? []).filter((p: Property) =>
          ATTENTION_STATUSES.includes(p.status)
        );
        const attentionAll = [
          ...attentionFromProd,
          ...(attentionRes.properties ?? []),
        ].filter(
          (p: Property, idx, arr) => arr.findIndex((x) => x.id === p.id) === idx
        );

        // Merge complete + delivered, de-duplicate by id
        const deliveredAll = [
          ...(completedRes.properties ?? []),
          ...(deliveredRes.properties ?? []),
        ].filter(
          (p: Property, idx, arr) => arr.findIndex((x) => x.id === p.id) === idx
        );

        setPendingPayment(pendingPaymentProps);
        setInProd(prodProps);
        setDelivered(deliveredAll);
        setAttention(attentionAll);
      } catch (err) {
        if (!cancelled) {
          setFetchError(
            err instanceof Error ? err.message : "Could not load orders. Please refresh.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const firstName = profile?.first_name ?? null;
  const greeting = firstName ? `Good to see you, ${firstName}.` : "Good to see you.";

  const allEmpty = !loading && !fetchError && pendingPayment.length === 0 && inProd.length === 0 && delivered.length === 0 && attention.length === 0;

  // Qualitative ETA derived from the agent's OWN delivered orders. null when
  // there are < 3 samples — in which case the phrase is omitted entirely.
  const eta = etaPhrase(delivered);

  return (
    <div data-testid="agent-home" className="flex flex-col gap-6">
      {/* ── Page heading ────────────────────────────────────────────────── */}
      <PageHeading
        eyebrow="Your studio"
        title="Listing videos"
        sub={greeting}
        actions={
          <Link
            to="/upload"
            className="le-btn-dark"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="upload" size={15} />
            Order a video
          </Link>
        }
      />

      {/* ── Loading skeleton ─────────────────────────────────────────── */}
      {loading && (
        <Section>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </Section>
      )}

      {/* ── Fetch error — surface honestly, not as "No orders yet" ────── */}
      {fetchError && !loading && (
        <Section>
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--bad)" }}>
            {fetchError}
          </div>
        </Section>
      )}

      {/* ── All empty ─────────────────────────────────────────────────── */}
      {allEmpty && (
        <Section>
          <EmptyState
            message="No orders yet. Submit your first listing and get a cinematic video in 72 hours."
            icon="home"
            cta={{
              label: "Order a video",
              onClick: () => navigate("/upload"),
            }}
          />
        </Section>
      )}

      {/* ── Finish checkout ──────────────────────────────────────────── */}
      {!loading && pendingPayment.length > 0 && (
        <Section>
          <SectionTitle eyebrow="Action needed" title="Finish checkout" />
          <div style={{ marginTop: 16 }}>
            {pendingPayment.map((p) => (
              <OrderRow
                key={p.id}
                property={p}
                note="Your order is reserved — complete checkout to start production."
                actions={
                  <Link
                    to={`/upload/cancelled?property_id=${p.id}`}
                    className="le-btn-ghost"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, textDecoration: "none" }}
                  >
                    <Icon name="external" size={11} />
                    Finish checkout
                  </Link>
                }
              />
            ))}
          </div>
        </Section>
      )}

      {/* ── Needs attention ──────────────────────────────────────────── */}
      {!loading && attention.length > 0 && (
        <Section>
          <SectionTitle eyebrow="Action needed" title="Needs attention" />
          <div style={{ marginTop: 16 }}>
            {attention.map((p) => (
              <OrderRow
                key={p.id}
                property={p}
                note="Our team has been notified and is looking into this."
              />
            ))}
          </div>
        </Section>
      )}

      {/* ── In production ─────────────────────────────────────────────── */}
      {!loading && inProd.length > 0 && (
        <Section>
          <SectionTitle eyebrow="Active" title="In production" />
          <div style={{ marginTop: 16 }}>
            {inProd.map((p) => (
              <OrderRow
                key={p.id}
                property={p}
                note={
                  <>
                    <OrderTimeline property={p} />
                    {eta && (
                      <div
                        data-testid={`order-eta-${p.id}`}
                        style={{
                          fontSize: 11.5,
                          color: "var(--muted)",
                          marginTop: 8,
                        }}
                      >
                        {eta}
                      </div>
                    )}
                  </>
                }
                actions={
                  <Link
                    to={`/status/${p.id}`}
                    className="le-btn-ghost"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, textDecoration: "none" }}
                  >
                    Track
                    <Icon name="external" size={11} />
                  </Link>
                }
              />
            ))}
          </div>
        </Section>
      )}

      {/* ── Delivered ─────────────────────────────────────────────────── */}
      {!loading && delivered.length > 0 && (() => {
        // Sort by created_at descending to identify the newest order
        const sortedDelivered = [...delivered].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        const [newestDelivered, ...olderDelivered] = sortedDelivered;
        // Only use the hero card when the newest order has a video URL
        const showHero = !!newestDelivered?.horizontal_video_url;
        const heroOrder = showHero ? newestDelivered : null;
        // Compact rows: older delivered + newest if it has no video URL
        const compactOrders = showHero ? olderDelivered : sortedDelivered;

        return (
          <Section>
            <SectionTitle eyebrow="Ready to share" title="Delivered" />
            <div style={{ marginTop: 16 }}>
              {/* Hero card for newest delivered order (when it has a video) */}
              {heroOrder && <DeliveredHeroCard property={heroOrder} />}

              {/* Compact rows for all older delivered orders */}
              {compactOrders.map((p) => (
                <OrderRow
                  key={p.id}
                  property={p}
                  actions={
                    <>
                      {p.horizontal_video_url && (
                        <a
                          href={p.horizontal_video_url}
                          target="_blank"
                          rel="noreferrer"
                          className="le-btn-ghost"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, textDecoration: "none" }}
                        >
                          <Icon name="play" size={12} />
                          Watch
                        </a>
                      )}
                      {p.horizontal_video_url && (
                        <CopyButton
                          value={p.horizontal_video_url}
                          label="Copy link"
                        />
                      )}
                    </>
                  }
                />
              ))}
            </div>
          </Section>
        );
      })()}
    </div>
  );
}
