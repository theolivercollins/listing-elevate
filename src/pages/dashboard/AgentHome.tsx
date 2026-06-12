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
import {
  EmptyState,
  PageHeading,
  PropertyThumb,
  StatusChip,
  fmtRel,
  SectionTitle,
} from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Parallel fetch of all three buckets. The server always filters by
        // user_id — the status param narrows the result set further.
        const [prodRes, deliveredRes, attentionRes] = await Promise.all([
          fetchProperties({ limit: 20 }).catch(() => ({ properties: [] as Property[], total: 0 })),
          fetchProperties({ status: "complete", limit: 20 }).catch(() => ({ properties: [] as Property[], total: 0 })),
          fetchProperties({ status: "needs_review", limit: 20 }).catch(() => ({ properties: [] as Property[], total: 0 })),
        ]);
        if (cancelled) return;

        // Filter prod results to only in-production statuses
        const prodProps = (prodRes.properties ?? []).filter((p: Property) =>
          IN_PRODUCTION_STATUSES.includes(p.status)
        );
        // Pending payment: agent started checkout but didn't complete it
        const pendingPaymentProps = (prodRes.properties ?? []).filter(
          (p: Property) => p.status === "pending_payment"
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

        setPendingPayment(pendingPaymentProps);
        setInProd(prodProps);
        setDelivered(deliveredRes.properties ?? []);
        setAttention(attentionAll);
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

  const allEmpty = !loading && pendingPayment.length === 0 && inProd.length === 0 && delivered.length === 0 && attention.length === 0;

  return (
    <div data-testid="agent-home" className="flex flex-col gap-6 p-6">
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
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--warn)",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
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
                actions={
                  <Link
                    to={`/status/${p.id}`}
                    style={{
                      fontSize: 12,
                      color: "var(--accent)",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
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
      {!loading && delivered.length > 0 && (
        <Section>
          <SectionTitle eyebrow="Ready to share" title="Delivered" />
          <div style={{ marginTop: 16 }}>
            {delivered.map((p) => (
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
                        style={{
                          fontSize: 12,
                          color: "var(--ink)",
                          textDecoration: "none",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
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
      )}
    </div>
  );
}
