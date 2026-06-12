import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { KpiCard, StatusPill, PropertyThumb, Card, MoneyValue, fmtDuration } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { fetchProperties, archiveProperty, rerunProperty, updatePropertyStatus } from "@/lib/api";
import type { Property } from "@/lib/types";

// ─── view-model ────────────────────────────────────────────────────

interface PropertyVM {
  id: string;
  address: string;
  status: string;
  photos: number;
  agent: string;
  cost: number | null; // cents
  duration_ms: number | null;
  thumb_hue: number;
  created_at_ms: number;
}

function fromLive(p: Property): PropertyVM {
  return {
    id: p.id,
    address: p.address,
    status: p.status,
    photos: p.photo_count ?? 0,
    agent: p.listing_agent ?? "",
    cost: p.total_cost_cents ?? null,
    duration_ms: p.processing_time_ms ?? null,
    thumb_hue: 200 + (parseInt(p.id.replace(/\D/g, "").slice(-4) || "0", 10) % 160),
    created_at_ms: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
  };
}

// ─── helpers ───────────────────────────────────────────────────────

function addressLine1(addr: string) {
  return addr.split(",")[0] ?? addr;
}
function addressLine2(addr: string) {
  return addr.split(",").slice(1).join(",").trim();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── inline styles ─────────────────────────────────────────────────

const GRID = "32px 2fr 1.2fr 1fr 1fr 1fr 1fr 32px";

const tabBtnBase: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 999,
  border: "none",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  transition: "background .2s",
  fontFamily: "var(--le-font-sans)",
};

const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 13px",
  borderRadius: 10,
  border: "1px solid rgba(15,24,60,0.08)",
  background: "rgba(255,255,255,0.6)",
  color: "var(--ink-2)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
};

const selBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.1)",
  color: "#fff",
  border: "none",
  fontSize: 11.5,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
};

const selBtnDanger: React.CSSProperties = {
  ...selBtn,
  background: "rgba(239,68,68,0.25)",
  color: "#fca5a5",
};

// ─── bulk action types ─────────────────────────────────────────────

type BulkAction = "archive" | "rerun" | "delivered";

interface ConfirmState {
  action: BulkAction;
  ids: string[];
}

// ─── main component ────────────────────────────────────────────────

const Properties = () => {
  const navigate = useNavigate();

  const [rawProperties, setRawProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "active" | "complete" | "review">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // bulk op state
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; label: string } | null>(null);

  // ── fetch ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetchProperties({ page: 1, limit: 200 });
        if (!cancelled) setRawProperties(res.properties);
      } catch {
        // fall through to sample data
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // ── view-model ───────────────────────────────────────────────────
  const allVM: PropertyVM[] = rawProperties.map(fromLive);

  // ── search ───────────────────────────────────────────────────────
  const searchLower = search.toLowerCase();
  const searched = searchLower
    ? allVM.filter(
        (p) =>
          p.address.toLowerCase().includes(searchLower) ||
          p.agent.toLowerCase().includes(searchLower),
      )
    : allVM;

  // ── tabs ─────────────────────────────────────────────────────────
  const ACTIVE_STATUSES = new Set(["queued", "ingesting", "analyzing", "scripting", "generating", "qc", "assembling"]);

  const tabCounts = {
    all: searched.length,
    active: searched.filter((p) => ACTIVE_STATUSES.has(p.status)).length,
    complete: searched.filter((p) => p.status === "complete").length,
    review: searched.filter((p) => p.status === "needs_review").length,
  };

  const filtered = searched.filter((p) => {
    if (tab === "all") return true;
    if (tab === "active") return ACTIVE_STATUSES.has(p.status);
    if (tab === "complete") return p.status === "complete";
    if (tab === "review") return p.status === "needs_review";
    return true;
  });

  // ── KPI totals ───────────────────────────────────────────────────
  const totalListings = allVM.length;
  const activeCount = allVM.filter((p) => ACTIVE_STATUSES.has(p.status)).length;
  const completed = allVM.filter((p) => p.status === "complete" && p.duration_ms);
  const avgDeliveryMs =
    completed.length > 0
      ? completed.reduce((s, p) => s + (p.duration_ms ?? 0), 0) / completed.length
      : null;
  const rerunCount = allVM.filter((p) => p.status === "needs_review").length;

  // ── KPI deltas (live-computed, null if not enough data) ──────────
  const now = Date.now();
  const MS_7D = 7 * 24 * 60 * 60 * 1000;
  const thisWeek = allVM.filter((p) => now - p.created_at_ms < MS_7D);
  const prevWeek = allVM.filter((p) => {
    const age = now - p.created_at_ms;
    return age >= MS_7D && age < 2 * MS_7D;
  });

  function pctChange(curr: number, prev: number): number | null {
    if (prev === 0 || curr === 0) return null;
    return ((curr - prev) / prev) * 100;
  }

  const totalListingsDelta = pctChange(thisWeek.length, prevWeek.length);

  const thisWeekActive = thisWeek.filter((p) => ACTIVE_STATUSES.has(p.status)).length;
  const prevWeekActive = prevWeek.filter((p) => ACTIVE_STATUSES.has(p.status)).length;
  const activeCountDelta = pctChange(thisWeekActive, prevWeekActive);

  const completedThisWeek = allVM.filter(
    (p) => p.status === "complete" && p.duration_ms != null && now - p.created_at_ms < MS_7D,
  );
  const completedPrevWeek = allVM.filter(
    (p) => p.status === "complete" && p.duration_ms != null && (() => { const age = now - p.created_at_ms; return age >= MS_7D && age < 2 * MS_7D; })(),
  );
  const avgDeliveryThisWeek =
    completedThisWeek.length > 0
      ? completedThisWeek.reduce((s, p) => s + (p.duration_ms ?? 0), 0) / completedThisWeek.length
      : null;
  const avgDeliveryPrevWeek =
    completedPrevWeek.length > 0
      ? completedPrevWeek.reduce((s, p) => s + (p.duration_ms ?? 0), 0) / completedPrevWeek.length
      : null;
  const avgDeliveryDelta =
    avgDeliveryThisWeek != null && avgDeliveryPrevWeek != null
      ? pctChange(avgDeliveryThisWeek, avgDeliveryPrevWeek)
      : null;

  // ── selection helpers ─────────────────────────────────────────────
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((p) => p.id)),
    );
  }, [filtered]);

  // ── bulk action helpers ───────────────────────────────────────────
  const requestBulk = useCallback((action: BulkAction) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    // Skip confirm modal for single selection
    if (ids.length === 1) {
      void executeBulk(action, ids);
    } else {
      setConfirm({ action, ids });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const actionLabel = (action: BulkAction) => {
    if (action === "archive") return "Archive";
    if (action === "rerun") return "Re-run pipeline";
    return "Mark delivered";
  };

  const executeBulk = async (action: BulkAction, ids: string[]) => {
    setConfirm(null);
    setBulkRunning(true);

    const verbIng = action === "archive" ? "Archiving" : action === "rerun" ? "Re-running" : "Marking delivered";

    // Optimistic UI — update local state immediately
    if (action === "archive") {
      setRawProperties((prev) =>
        prev.filter((p) => !ids.includes(p.id))
      );
    } else if (action === "rerun") {
      setRawProperties((prev) =>
        prev.map((p) => ids.includes(p.id) ? { ...p, status: "queued" as const } : p)
      );
    } else if (action === "delivered") {
      setRawProperties((prev) =>
        prev.map((p) => ids.includes(p.id) ? { ...p, status: "delivered" as const } : p)
      );
    }

    // Clear selection upfront
    setSelected(new Set());

    const rollback = new Map<string, string>();
    const succeeded: string[] = [];
    const failed: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      setBulkProgress({ done: i, total: ids.length, label: `${verbIng} ${i + 1} of ${ids.length}…` });

      // Capture original status for rollback
      const original = rawProperties.find((p) => p.id === id);
      if (original) rollback.set(id, original.status);

      try {
        if (action === "archive") {
          await archiveProperty(id);
        } else if (action === "rerun") {
          await rerunProperty(id);
        } else {
          await updatePropertyStatus(id, "delivered");
        }
        succeeded.push(id);
      } catch {
        failed.push(id);
        // Roll back this specific property
        if (rollback.has(id)) {
          const origStatus = rollback.get(id)!;
          if (action === "archive") {
            // Put it back in the list
            setRawProperties((prev) => {
              const already = prev.find((p) => p.id === id);
              if (already) return prev;
              const restored = rawProperties.find((p) => p.id === id);
              return restored ? [...prev, restored] : prev;
            });
          } else {
            setRawProperties((prev) =>
              prev.map((p) => p.id === id ? { ...p, status: origStatus as Property["status"] } : p)
            );
          }
        }
      }

      // Small stagger to avoid hammering the API (skip after last item)
      if (i < ids.length - 1) await sleep(120);
    }

    setBulkProgress(null);
    setBulkRunning(false);

    // Toast summary
    const verb = action === "archive" ? "archived" : action === "rerun" ? "queued for re-run" : "marked delivered";
    if (failed.length === 0) {
      toast.success(`${succeeded.length} ${succeeded.length === 1 ? "listing" : "listings"} ${verb}.`);
    } else if (succeeded.length === 0) {
      toast.error(`All ${failed.length} operations failed.`);
    } else {
      toast.warning(`${succeeded.length} succeeded, ${failed.length} failed.`);
    }
  };

  // ── tab button ───────────────────────────────────────────────────
  const TabBtn = ({
    id,
    label,
    count,
  }: {
    id: typeof tab;
    label: string;
    count: number;
  }) => {
    const active = tab === id;
    return (
      <button
        onClick={() => setTab(id)}
        style={{
          ...tabBtnBase,
          background: active ? "var(--ink)" : "transparent",
          color: active ? "#fff" : "var(--muted)",
        }}
      >
        {label}
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 999,
            background: active ? "rgba(255,255,255,0.18)" : "rgba(15,24,60,0.05)",
          }}
        >
          {count}
        </span>
      </button>
    );
  };

  if (loading) {
    return (
      <div className="le-fade-up" style={{ padding: "80px 0", display: "flex", justifyContent: "center" }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI row */}
      <section
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}
      >
        <KpiCard
          label="Total listings"
          value={totalListings}
          sub={thisWeek.length > 0 ? `+${thisWeek.length} this week` : "no new this week"}
          delta={totalListingsDelta}
        />
        <KpiCard
          label="Active"
          value={activeCount}
          sub="across all stages"
          delta={activeCountDelta}
        />
        <KpiCard
          label="Avg delivery"
          value={avgDeliveryMs ? fmtDuration(avgDeliveryMs) : "—"}
          sub="below 72h SLA"
          delta={avgDeliveryDelta}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Reruns"
          value={rerunCount}
          sub={rerunCount > 0 ? `${((rerunCount / Math.max(totalListings, 1)) * 100).toFixed(1)}% rerun rate` : "no reruns"}
          delta={null}
          deltaPositiveIsGood={false}
        />
      </section>

      {/* Table card */}
      <Card padding={20}>
        {/* Tabs + filter row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <TabBtn id="all" label="All" count={tabCounts.all} />
            <TabBtn id="active" label="Active" count={tabCounts.active} />
            <TabBtn id="complete" label="Delivered" count={tabCounts.complete} />
            <TabBtn id="review" label="Review" count={tabCounts.review} />
          </div>

          <div style={{ flex: 1 }} />

          {/* Search */}
          <div
            className="le-card-flat"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", minWidth: 260 }}
          >
            <Icon name="search" size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
            <input
              placeholder="Filter listings…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 12.5,
                fontFamily: "var(--le-font-sans)",
                color: "var(--ink)",
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", lineHeight: 0, padding: 0 }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>

          <button style={ghostBtn}>
            <Icon name="filter" size={14} />
            Filters
          </button>
          <button style={ghostBtn}>
            <Icon name="upload" size={14} />
            Export
          </button>
        </div>

        {/* Header row */}
        <div className="le-table-scroll is-wide">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 16,
            padding: "10px 14px",
            borderBottom: "1px solid var(--line)",
            alignItems: "center",
          }}
        >
          <input
            type="checkbox"
            checked={filtered.length > 0 && selected.size === filtered.length}
            onChange={toggleAll}
            style={{ accentColor: "var(--accent)", cursor: "pointer" }}
          />
          <span className="le-d-label">Property</span>
          <span className="le-d-label">Agent</span>
          <span className="le-d-label">Status</span>
          <span className="le-d-label" style={{ textAlign: "right" }}>
            Photos
          </span>
          <span className="le-d-label" style={{ textAlign: "right" }}>
            Duration
          </span>
          <span className="le-d-label" style={{ textAlign: "right" }}>
            Cost
          </span>
          <span />
        </div>

        {/* Body rows */}
        {filtered.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            {allVM.length === 0
              ? "No listings yet — your first listing will appear here once submitted."
              : "No listings match your filters."}
          </div>
        ) : (
          filtered.map((p) => (
            <PropertyRow
              key={p.id}
              p={p}
              selected={selected.has(p.id)}
              onToggle={toggle}
              onNavigate={() => navigate("/dashboard/properties/" + p.id)}
            />
          ))
        )}
        </div>
      </Card>

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            padding: "10px 12px 10px 18px",
            borderRadius: 16,
            background: "var(--ink)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 14,
            boxShadow: "0 24px 60px -20px rgba(11,18,32,0.5)",
            whiteSpace: "nowrap",
            opacity: bulkRunning ? 0.7 : 1,
            pointerEvents: bulkRunning ? "none" : undefined,
            transition: "opacity .2s",
          }}
        >
          {bulkProgress ? (
            <span style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 14, height: 14, borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff",
                animation: "spin 0.8s linear infinite",
                flexShrink: 0,
                display: "inline-block",
              }} />
              {bulkProgress.label}
            </span>
          ) : (
            <>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                {selected.size} selected
              </span>
              <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.18)", flexShrink: 0 }} />
              <button
                style={selBtn}
                onClick={() => requestBulk("rerun")}
              >
                <Icon name="retry" size={13} />
                Re-run
              </button>
              <button
                style={selBtn}
                onClick={() => requestBulk("delivered")}
              >
                <Icon name="delivered" size={13} />
                Mark delivered
              </button>
              <button
                style={selBtnDanger}
                onClick={() => requestBulk("archive")}
              >
                <Icon name="archive" size={13} />
                Archive
              </button>
              <button
                onClick={() => setSelected(new Set())}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  background: "#fff",
                  color: "var(--ink)",
                  border: "none",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                Discard
              </button>
            </>
          )}
        </div>
      )}

      {/* Confirmation modal */}
      {confirm && (
        <ConfirmModal
          action={confirm.action}
          count={confirm.ids.length}
          label={actionLabel(confirm.action)}
          onConfirm={() => executeBulk(confirm.action, confirm.ids)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// ─── ConfirmModal ──────────────────────────────────────────────────

function ConfirmModal({
  action,
  count,
  label,
  onConfirm,
  onCancel,
}: {
  action: BulkAction;
  count: number;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isDestructive = action === "archive";

  const body =
    action === "archive"
      ? `${count} ${count === 1 ? "listing" : "listings"} will be moved to archived status. No data is deleted.`
      : action === "rerun"
      ? `${count} ${count === 1 ? "listing" : "listings"} will be reset and re-queued. Existing scenes and logs will be cleared.`
      : `${count} ${count === 1 ? "listing" : "listings"} will be marked as delivered.`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(11,18,32,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 20,
          padding: "28px 32px",
          width: 400,
          maxWidth: "calc(100vw - 40px)",
          boxShadow: "0 32px 80px -20px rgba(11,18,32,0.3)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", fontFamily: "var(--le-font-sans)" }}>
          {label} {count} {count === 1 ? "listing" : "listings"}?
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", fontFamily: "var(--le-font-sans)", lineHeight: 1.5 }}>
          {body}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button
            onClick={onCancel}
            style={{
              padding: "9px 18px",
              borderRadius: 10,
              border: "1px solid rgba(15,24,60,0.12)",
              background: "transparent",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              color: "var(--ink-2)",
              fontFamily: "var(--le-font-sans)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "9px 18px",
              borderRadius: 10,
              border: "none",
              background: isDestructive ? "rgb(239,68,68)" : "var(--ink)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "var(--le-font-sans)",
            }}
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PropertyRow ───────────────────────────────────────────────────

function PropertyRow({
  p,
  selected,
  onToggle,
  onNavigate,
}: {
  p: PropertyVM;
  selected: boolean;
  onToggle: (id: string) => void;
  onNavigate: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onNavigate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "32px 2fr 1.2fr 1fr 1fr 1fr 1fr 32px",
        gap: 16,
        padding: "12px 14px",
        borderBottom: "1px solid rgba(15,24,60,0.04)",
        alignItems: "center",
        cursor: "pointer",
        background: selected || hovered ? "rgba(15,24,60,0.02)" : "transparent",
        transition: "background .15s",
      }}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggle(p.id)}
        style={{ accentColor: "var(--accent)", cursor: "pointer" }}
      />

      {/* Address */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <PropertyThumb hue={p.thumb_hue} size={36} />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: "var(--ink)",
            }}
          >
            {addressLine1(p.address)}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 2 }}>
            {addressLine2(p.address)}
          </div>
        </div>
      </div>

      {/* Agent */}
      <span
        style={{
          fontSize: 12.5,
          color: "var(--ink-2)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {p.agent}
      </span>

      {/* Status */}
      <StatusPill status={p.status} />

      {/* Photos */}
      <span
        style={{
          fontSize: 12.5,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: "var(--ink-2)",
        }}
      >
        {p.photos}
      </span>

      {/* Duration */}
      <span
        style={{
          fontSize: 12.5,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: "var(--muted)",
        }}
      >
        {p.duration_ms ? fmtDuration(p.duration_ms) : "—"}
      </span>

      {/* Cost */}
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: "var(--ink)",
        }}
      >
        <MoneyValue cents={p.cost} />
      </span>

      {/* Dots */}
      <button
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--muted-2)",
          cursor: "pointer",
          lineHeight: 0,
          padding: 0,
        }}
      >
        <Icon name="dots" size={14} />
      </button>
    </div>
  );
}

export default Properties;
