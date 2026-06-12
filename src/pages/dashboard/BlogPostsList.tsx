import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listPosts, listTemplates } from "@/lib/blog/api-client";
import { thumbUrl } from "@/lib/blog/image-url";
import type { BlogPostState } from "@/lib/blog/types";
import { PageHeading, KpiCard, Card } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { ListTabs } from "@/components/dashboard/ListTabs";
import { StatePill, BLOG_STATE_PILL_MAP } from "@/components/dashboard/StatePill";
import { DeletePostDialog } from "@/components/blog/DeletePostDialog";

// ─── constants ────────────────────────────────────────────────────────────────

const STATE_FILTERS: Array<{ label: string; value: BlogPostState | "all" }> = [
  { label: "All",          value: "all" },
  { label: "Drafts",       value: "awaiting_approval" },
  { label: "Live",         value: "live" },
  { label: "On hold",      value: "on_hold" },
  { label: "Quarantined",  value: "quarantined" },
];

// ─── inline styles (v3 tokens) ────────────────────────────────────────────────

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

// ─── "New post" dropdown (native, v3 tokens) ──────────────────────────────────

function NewPostDropdown({
  templates,
  navigate,
}: {
  templates: Array<{ id: string; name: string }>;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 16px",
          borderRadius: 12,
          border: "none",
          background: "var(--ink)",
          color: "var(--surface)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "var(--le-font-sans)",
        }}
      >
        <Icon name="plus" size={15} strokeWidth={2.2} />
        New post
        <Icon name="chevron-down" size={13} strokeWidth={2} />
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              zIndex: 50,
              minWidth: 260,
              background: "var(--surface)",
              borderRadius: 14,
              boxShadow: "0 20px 60px -16px rgba(11,18,32,0.22)",
              border: "1px solid rgba(15,24,60,0.06)",
              overflow: "hidden",
              fontFamily: "var(--le-font-sans)",
            }}
          >
            <DropItem
              icon="spark"
              label="Chat with AI"
              sub="Build the post by talking to Claude"
              onClick={() => { setOpen(false); navigate("/dashboard/studio/blog/posts/new?chat=1"); }}
            />
            <DropItem
              icon="sparkles"
              label="Quick AI draft"
              sub="One-shot — fill a prompt, get a draft"
              onClick={() => { setOpen(false); navigate("/dashboard/studio/blog/posts/new?ai=1"); }}
            />
            <DropItem
              icon="book"
              label="Write manually"
              sub="Blank editor — type or paste HTML"
              onClick={() => { setOpen(false); navigate("/dashboard/studio/blog/posts/new"); }}
            />

            {/* separator */}
            <div style={{ height: 1, background: "rgba(15,24,60,0.05)", margin: "4px 0" }} />

            {templates.length > 0 ? (
              <>
                <div
                  style={{
                    padding: "6px 14px 4px",
                    fontSize: 10.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    color: "var(--muted)",
                  }}
                >
                  From template
                </div>
                {templates.slice(0, 6).map((t) => (
                  <DropItem
                    key={t.id}
                    icon="branch"
                    label={t.name}
                    onClick={() => { setOpen(false); navigate(`/dashboard/studio/blog/posts/new?template=${t.id}`); }}
                  />
                ))}
                {templates.length > 6 && (
                  <button
                    type="button"
                    onClick={() => { setOpen(false); navigate("/dashboard/studio/blog/templates"); }}
                    style={{
                      width: "100%",
                      padding: "8px 14px",
                      background: "none",
                      border: "none",
                      textAlign: "left",
                      fontSize: 12,
                      color: "var(--muted)",
                      cursor: "pointer",
                      fontFamily: "var(--le-font-sans)",
                    }}
                  >
                    Manage templates →
                  </button>
                )}
              </>
            ) : (
              <DropItem
                icon="branch"
                label="Create a template"
                sub="Save HTML to reuse later"
                onClick={() => { setOpen(false); navigate("/dashboard/studio/blog/templates/new"); }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DropItem({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  sub?: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 14px",
        background: hovered ? "rgba(15,24,60,0.03)" : "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--le-font-sans)",
        transition: "background .15s",
      }}
    >
      <div
        style={{
          marginTop: 1,
          width: 28,
          height: 28,
          borderRadius: 8,
          background: "rgba(15,24,60,0.04)",
          display: "grid",
          placeItems: "center",
          color: "var(--ink-2)",
          flexShrink: 0,
        }}
      >
        <Icon name={icon} size={14} strokeWidth={1.6} />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>{sub}</div>}
      </div>
    </button>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function BlogPostsList() {
  const [activeState, setActiveState] = useState<BlogPostState | "all">("all");
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["blog-posts-list", activeState, q],
    queryFn: () => listPosts({
      state: activeState === "all" ? undefined : activeState,
      q: q || undefined,
      limit: 100,
    }),
  });

  const { data: tplData } = useQuery({
    queryKey: ["blog-templates"],
    queryFn: () => listTemplates(),
  });
  const templates = tplData?.templates ?? [];

  const posts = data?.posts ?? [];
  const qc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; hasSierra: boolean } | null>(null);

  // ── KPI counts ──────────────────────────────────────────────────────────────
  const allPosts = data?.posts ?? [];
  const liveCount   = allPosts.filter(p => p.state === "live").length;
  const draftCount  = allPosts.filter(p => p.state === "awaiting_approval").length;
  const holdCount   = allPosts.filter(p => p.state === "on_hold").length;

  // ── tab counts (based on whatever search filter is active) ──────────────────
  const tabCounts: Record<BlogPostState | "all", number> = {
    all:               posts.length,
    live:              posts.filter(p => p.state === "live").length,
    awaiting_approval: posts.filter(p => p.state === "awaiting_approval").length,
    on_hold:           posts.filter(p => p.state === "on_hold").length,
    quarantined:       posts.filter(p => p.state === "quarantined").length,
  };

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Page heading */}
      <PageHeading
        eyebrow="Content"
        title="Blog posts"
        sub="Create and manage blog content published to your website."
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link
              to="/dashboard/studio/blog/market-update"
              style={ghostBtn}
              title="Generate the monthly market-update posts + email"
            >
              <Icon name="trend-up" size={14} />
              Market Update
            </Link>
            <Link
              to="/dashboard/studio/blog/ally-history"
              style={ghostBtn}
              title="Browse your Ally conversation history"
            >
              <Icon name="activity" size={14} />
              Ally history
            </Link>
            <NewPostDropdown templates={templates} navigate={navigate} />
          </div>
        }
      />

      {/* KPI strip */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KpiCard label="Total posts"  value={allPosts.length} />
        <KpiCard label="Live"         value={liveCount}       />
        <KpiCard label="Drafts"       value={draftCount}      />
        <KpiCard label="On hold"      value={holdCount}       />
      </section>

      {/* Table card */}
      <Card padding={20}>
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          {/* Tab pills */}
          <ListTabs
            filters={STATE_FILTERS}
            active={activeState}
            counts={tabCounts}
            onChange={setActiveState}
          />

          <div style={{ flex: 1 }} />

          {/* Search */}
          <div
            className="le-card-flat"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", minWidth: 240 }}
          >
            <Icon name="search" size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
            <input
              placeholder="Search title…"
              value={q}
              onChange={e => setQ(e.target.value)}
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
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", lineHeight: 0, padding: 0 }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Column header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 100px 72px 120px 100px 70px 60px",
            gap: 12,
            padding: "8px 14px",
            borderBottom: "1px solid var(--line)",
            alignItems: "center",
          }}
        >
          <span className="le-d-label">Title</span>
          <span className="le-d-label">State</span>
          <span className="le-d-label">Image</span>
          <span className="le-d-label">Author</span>
          <span className="le-d-label">Updated</span>
          <span className="le-d-label" style={{ textAlign: "right" }}>Cost</span>
          <span />
        </div>

        {/* Body */}
        {isLoading ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Loading…
          </div>
        ) : isError ? (
          <div style={{ padding: "48px 0", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "var(--bad)" }}>
              Failed to load posts: {(error as any)?.message ?? String(error)}
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "var(--muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
                fontFamily: "var(--le-font-sans)",
              }}
            >
              Retry
            </button>
          </div>
        ) : posts.length === 0 ? (
          <div style={{ padding: "56px 0", textAlign: "center" }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "rgba(15,24,60,0.04)",
                display: "grid",
                placeItems: "center",
                color: "var(--muted)",
                margin: "0 auto 14px",
              }}
            >
              <Icon name="book" size={20} strokeWidth={1.4} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
              {activeState === "all" && !q ? "No posts yet" : "No posts match your filters"}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 320, margin: "0 auto" }}>
              {activeState === "all" && !q
                ? "Click New post to start writing your first blog post."
                : (
                  <>
                    {activeState !== "all" && <span>State: <strong>{activeState}</strong>. </span>}
                    {q && <span>Title contains "{q}". </span>}
                    <button
                      type="button"
                      onClick={() => { setActiveState("all"); setQ(""); }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--accent)",
                        fontSize: 13,
                        fontFamily: "var(--le-font-sans)",
                        textDecoration: "underline",
                      }}
                    >
                      Clear filters
                    </button>
                  </>
                )
              }
            </div>
          </div>
        ) : (
          posts.map(p => (
            <PostRow
              key={p.id}
              p={p}
              onDelete={() => setDeleteTarget({ id: p.id, title: p.title, hasSierra: !!p.external_post_url })}
              navigate={navigate}
            />
          ))
        )}
      </Card>

      <DeletePostDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        postId={deleteTarget?.id ?? null}
        postTitle={deleteTarget?.title ?? ""}
        hasSierraCopy={deleteTarget?.hasSierra ?? false}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["blog-posts-list"] })}
      />
    </div>
  );
}

// ─── PostRow ─────────────────────────────────────────────────────────────────

import type { BlogPostListItem } from "@/lib/blog/types";
import React from "react";

function PostRow({
  p,
  onDelete,
  navigate,
}: {
  p: BlogPostListItem;
  onDelete: () => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => navigate(`/dashboard/studio/blog/posts/${p.id}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 100px 72px 120px 100px 70px 60px",
        gap: 12,
        padding: "12px 14px",
        borderBottom: "1px solid rgba(15,24,60,0.04)",
        alignItems: "center",
        cursor: "pointer",
        background: hovered ? "rgba(15,24,60,0.02)" : "transparent",
        transition: "background .15s",
      }}
    >
      {/* Title */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {p.title}
        </div>
      </div>

      {/* State */}
      <div><StatePill state={p.state} map={BLOG_STATE_PILL_MAP} /></div>

      {/* Thumbnail */}
      <div>
        {p.image ? (
          <img
            src={thumbUrl(p.image.blob_url, { width: 120, quality: 65 })}
            loading="lazy"
            decoding="async"
            style={{
              height: 32,
              width: 48,
              borderRadius: 6,
              objectFit: "cover",
              display: "block",
            }}
            alt=""
          />
        ) : (
          <span style={{ fontSize: 12, color: "var(--muted-2)" }}>—</span>
        )}
      </div>

      {/* Author */}
      <span
        style={{
          fontSize: 12.5,
          color: "var(--ink-2)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {p.author_label ?? "—"}
      </span>

      {/* Updated */}
      <span
        style={{
          fontSize: 11.5,
          color: "var(--muted)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {new Date(p.updated_at).toLocaleDateString()}
      </span>

      {/* Cost */}
      <span
        style={{
          fontSize: 12.5,
          color: "var(--ink-2)",
          fontVariantNumeric: "tabular-nums",
          textAlign: "right",
        }}
      >
        ${(p.cost_usd_cents / 100).toFixed(2)}
      </span>

      {/* Row actions */}
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}
        onClick={e => e.stopPropagation()}
      >
        {p.external_post_url && (
          <a
            href={p.external_post_url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on Sierra"
            style={{ color: "var(--muted-2)", lineHeight: 0 }}
          >
            <Icon name="external" size={14} />
          </a>
        )}
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete post"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--muted)",
            display: "grid",
            placeItems: "center",
            padding: 4,
            borderRadius: 6,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--bad)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--muted)")}
        >
          <Icon name="archive" size={14} />
        </button>
      </div>
    </div>
  );
}
