import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { KpiCard, StatusPill, PropertyThumb, Card, fmtCents, fmtDuration } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { SAMPLE_PROPERTIES } from "@/components/dashboard/sample-data";
import type { SampleProperty } from "@/components/dashboard/sample-data";
import { fetchProperties } from "@/lib/api";
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

function fromSample(p: SampleProperty): PropertyVM {
  return {
    id: p.id,
    address: p.address,
    status: p.status,
    photos: p.photos,
    agent: p.agent,
    cost: p.cost,
    duration_ms: p.duration_ms,
    thumb_hue: p.thumb_hue,
    created_at_ms: p.created_at,
  };
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

// ─── main component ────────────────────────────────────────────────

const Properties = () => {
  const navigate = useNavigate();

  const [rawProperties, setRawProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "active" | "complete" | "review">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
  const allVM: PropertyVM[] =
    rawProperties.length > 0
      ? rawProperties.map(fromLive)
      : SAMPLE_PROPERTIES.map(fromSample);

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
            borderRadius: 99,
            background: active ? "rgba(255,255,255,0.18)" : "rgba(15,24,60,0.05)",
          }}
        >
          {count}
        </span>
      </button>
    );
  };

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI row */}
      <section
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}
      >
        <KpiCard
          label="Total listings"
          value={totalListings}
          sub="+12 this week"
          delta={4.9}
        />
        <KpiCard
          label="Active"
          value={activeCount}
          sub="across all stages"
          delta={8.1}
        />
        <KpiCard
          label="Avg delivery"
          value={avgDeliveryMs ? fmtDuration(avgDeliveryMs) : "—"}
          sub="below 72h SLA"
          delta={-12.4}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Reruns"
          value={rerunCount}
          sub={rerunCount > 0 ? `${((rerunCount / totalListings) * 100).toFixed(1)}% rerun rate` : "no reruns"}
          delta={-1.8}
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
        {loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            No listings match your filters.
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
      </Card>

      {/* Floating selection bar */}
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
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Selected: {selected.size}</span>
          <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.18)", flexShrink: 0 }} />
          <button style={selBtn}>
            <Icon name="retry" size={13} />
            Rerun
          </button>
          <button style={selBtn}>
            <Icon name="upload" size={13} />
            Export
          </button>
          <button style={selBtn}>
            <Icon name="x" size={13} />
            Delete
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
        </div>
      )}
    </div>
  );
};

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
        {fmtCents(p.cost)}
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
