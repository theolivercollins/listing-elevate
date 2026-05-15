import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listPosts, listTemplates } from "@/lib/blog/api-client";
import { thumbUrl } from "@/lib/blog/image-url";
import type { BlogPostState, BlogPostListItem } from "@/lib/blog/types";
import { PageHeading, Card } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

// ─── state filter config ──────────────────────────────────────────
const STATE_FILTERS: Array<{ label: string; value: BlogPostState | "all" }> = [
  { label: "All", value: "all" },
  { label: "Drafts", value: "awaiting_approval" },
  { label: "Live", value: "live" },
  { label: "Quarantined", value: "quarantined" },
];

// ─── blog post status → design token mapping ─────────────────────
function blogStatePill(state: BlogPostState) {
  const MAP: Record<string, { label: string; color: string; bg: string }> = {
    live:             { label: "Live",        color: "var(--good)",   bg: "rgba(47,138,85,0.10)" },
    awaiting_approval:{ label: "Draft",       color: "var(--muted)",  bg: "rgba(11,11,16,0.05)" },
    publish_due:      { label: "Publish due", color: "var(--accent)", bg: "rgba(42,111,219,0.10)" },
    publishing:       { label: "Publishing",  color: "var(--accent)", bg: "rgba(42,111,219,0.10)" },
    failed:           { label: "Failed",      color: "var(--bad)",    bg: "rgba(196,74,74,0.10)" },
    quarantined:      { label: "Quarantined", color: "var(--bad)",    bg: "rgba(196,74,74,0.10)" },
    paused:           { label: "Paused",      color: "var(--warn)",   bg: "rgba(182,128,44,0.10)" },
  };
  const s = MAP[state] ?? { label: state, color: "var(--muted)", bg: "rgba(11,11,16,0.05)" };
  return (
    <span
      className="le-status-pill"
      style={{ background: s.bg, color: s.color }}
    >
      <span className="le-status-dot" />
      {s.label}
    </span>
  );
}

// ─── dropdown menu (native, no shadcn) ───────────────────────────
function NewPostMenu({ templates, navigate }: {
  templates: Array<{ id: string; name: string }>;
  navigate: (to: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        className="le-btn-dark"
        onClick={() => setOpen(v => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
      >
        <Icon name="plus" size={13} />
        New post
        <Icon name="chevron-down" size={12} style={{ opacity: 0.7 }} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: 260,
            background: "var(--surface)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--line)",
            boxShadow: "var(--shadow-lg)",
            zIndex: 200,
            padding: "4px 0",
          }}
        >
          <MenuRow
            icon="book"
            label="Write manually"
            sub="Blank editor — type or paste HTML"
            onClick={() => { setOpen(false); navigate("/dashboard/blog/posts/new"); }}
          />
          <MenuRow
            icon="sparkles"
            label="Generate with AI"
            sub="Claude writes the first draft"
            onClick={() => { setOpen(false); navigate("/dashboard/blog/posts/new?ai=1"); }}
          />
          {templates.length > 0 && (
            <>
              <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
              <div style={{ padding: "4px 14px 2px", fontSize: 11, color: "var(--muted)" }}>From template</div>
              {templates.slice(0, 6).map(t => (
                <MenuRow
                  key={t.id}
                  icon="logs"
                  label={t.name}
                  onClick={() => { setOpen(false); navigate(`/dashboard/blog/posts/new?template=${t.id}`); }}
                />
              ))}
              {templates.length > 6 && (
                <MenuRow
                  icon="chevron-right"
                  label="Manage templates"
                  onClick={() => { setOpen(false); navigate("/dashboard/blog/templates"); }}
                />
              )}
            </>
          )}
          {templates.length === 0 && (
            <>
              <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
              <MenuRow
                icon="logs"
                label="Create a template"
                sub="Save HTML to reuse later"
                onClick={() => { setOpen(false); navigate("/dashboard/blog/templates/new"); }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuRow({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  sub?: string;
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
        padding: "8px 14px",
        background: hov ? "rgba(11,11,16,0.03)" : "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <Icon name={icon} size={14} style={{ color: "var(--muted)", marginTop: 1, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>{sub}</div>}
      </div>
    </button>
  );
}

// ─── input style ─────────────────────────────────────────────────
const INPUT_STYLE: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  fontSize: 13,
  fontFamily: "var(--le-font-sans)",
  color: "var(--ink)",
  outline: "none",
  width: 220,
};

// ─── page ─────────────────────────────────────────────────────────
export default function BlogPostsList() {
  const [state, setState] = useState<BlogPostState | "all">("all");
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["blog-posts-list", state, q],
    queryFn: () => listPosts({
      state: state === "all" ? undefined : state,
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

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      <PageHeading
        eyebrow="Content · Blog · Posts"
        title="Blog posts"
        sub="All posts across draft, scheduled, and live states."
        actions={<NewPostMenu templates={templates} navigate={navigate} />}
      />

      {/* Filter bar */}
      <Card padding={16}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="le-seg">
            {STATE_FILTERS.map(f => (
              <button
                key={f.value}
                className={`le-seg-item${state === f.value ? " is-active" : ""}`}
                onClick={() => setState(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            placeholder="Search title…"
            value={q}
            onChange={e => setQ(e.target.value)}
            style={INPUT_STYLE}
          />
        </div>
      </Card>

      {/* Table */}
      <Card padding={0} style={{ overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 130px 72px 140px 140px 90px 40px",
          gap: 12,
          padding: "10px 18px",
          borderBottom: "1px solid var(--line)",
          alignItems: "center",
        }}>
          <span className="le-d-label">Title</span>
          <span className="le-d-label">State</span>
          <span className="le-d-label">Image</span>
          <span className="le-d-label">Author</span>
          <span className="le-d-label">Updated</span>
          <span className="le-d-label">Cost</span>
          <span className="le-d-label"></span>
        </div>

        {isLoading && (
          <div style={{ padding: "64px 0", display: "flex", justifyContent: "center" }}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.22-8.56" />
            </svg>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {!isLoading && posts.length === 0 && (
          <div style={{ padding: "64px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
            No posts match this filter.
          </div>
        )}

        {!isLoading && posts.map((p, i) => (
          <PostRow key={p.id} p={p} isLast={i === posts.length - 1} />
        ))}
      </Card>
    </div>
  );
}

// ─── table row ────────────────────────────────────────────────────
function PostRow({ p, isLast }: { p: BlogPostListItem; isLast: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 130px 72px 140px 140px 90px 40px",
        gap: 12,
        padding: "12px 18px",
        borderBottom: isLast ? "none" : "1px solid var(--line-2)",
        alignItems: "center",
        background: hov ? "rgba(11,11,16,0.02)" : "transparent",
        transition: "background .15s",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Link
          to={`/dashboard/blog/posts/${p.id}`}
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--ink)",
            textDecoration: "none",
          }}
        >
          {p.title}
        </Link>
      </div>
      <div>{blogStatePill(p.state)}</div>
      <div>
        {p.image
          ? <img src={thumbUrl(p.image.blob_url, { width: 120, quality: 65 })} loading="lazy" decoding="async" style={{ width: 48, height: 32, objectFit: "cover", borderRadius: "var(--radius-sm)", display: "block", border: "1px solid var(--line-2)" }} alt="" />
          : <span style={{ fontSize: 12, color: "var(--muted-2)" }}>—</span>
        }
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{p.author_label ?? "—"}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
        {new Date(p.updated_at).toLocaleString()}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
        ${(p.cost_usd_cents / 100).toFixed(2)}
      </div>
      <div>
        {p.external_post_url && (
          <a href={p.external_post_url} target="_blank" rel="noreferrer" style={{ color: "var(--muted)" }}>
            <Icon name="external" size={14} />
          </a>
        )}
      </div>
    </div>
  );
}
