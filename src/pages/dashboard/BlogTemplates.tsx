import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteTemplate, listTemplates } from "@/lib/blog/api-client";
import { HtmlPreview } from "@/components/blog/HtmlPreview";
import type { BlogTemplate } from "@/lib/blog/types";
import { toast } from "sonner";
import { PageHeading, Card } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

export default function BlogTemplates() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["blog-templates"],
    queryFn: () => listTemplates(),
  });
  const templates = data?.templates ?? [];

  const del = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => { toast.success("Archived"); qc.invalidateQueries({ queryKey: ["blog-templates"] }); },
  });

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      <PageHeading
        eyebrow="Content · Blog · Templates"
        title="Templates"
        sub={`${templates.length} template${templates.length === 1 ? "" : "s"} saved for reuse.`}
        actions={
          <Link to="/dashboard/studio/blog/templates/new" style={{ textDecoration: "none" }}>
            <button className="le-btn-dark" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Icon name="plus" size={13} />
              New template
            </button>
          </Link>
        }
      />

      {isLoading ? (
        <div style={{ padding: "64px 0", display: "flex", justifyContent: "center" }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
            <path d="M21 12a9 9 0 1 1-6.22-8.56" />
          </svg>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : templates.length === 0 ? (
        <Card padding={48}>
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            No templates yet.{" "}
            <Link to="/dashboard/studio/blog/templates/new" style={{ color: "var(--accent)", fontWeight: 500 }}>
              Create one
            </Link>
            .
          </div>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {templates.map(t => (
            <TemplateCard key={t.id} t={t} onDelete={() => del.mutate(t.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── template card ────────────────────────────────────────────────
function TemplateCard({ t, onDelete }: { t: BlogTemplate; onDelete: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      className="le-lift"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: "var(--surface)",
        borderRadius: "var(--radius)",
        boxShadow: hov ? "var(--shadow-md)" : "var(--shadow-sm)",
        transform: hov ? "translateY(-1px)" : "translateY(0)",
        transition: "box-shadow .15s, transform .15s",
        overflow: "hidden",
      }}
    >
      {/* Preview thumbnail */}
      <div style={{ borderBottom: "1px solid var(--line-2)" }}>
        <HtmlPreview html={t.body_html} style={{ width: "100%", height: 180, border: "none", display: "block" }} />
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.015em" }}>{t.name}</div>
        {t.description && (
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>{t.description}</div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
          <Link to={`/dashboard/studio/blog/templates/${t.id}`} style={{ textDecoration: "none", flex: 1 }}>
            <button
              className="le-btn-ghost"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "center", fontSize: 12 }}
            >
              <Icon name="settings" size={12} />
              Edit
            </button>
          </Link>
          <Link to={`/dashboard/studio/blog/posts/new?template=${t.id}`} style={{ textDecoration: "none", flex: 1 }}>
            <button
              className="le-btn-ghost"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "center", fontSize: 12 }}
            >
              <Icon name="plus" size={12} />
              Use
            </button>
          </Link>
          <button
            onClick={onDelete}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "7px 10px",
              borderRadius: "var(--radius-pill)",
              border: "1px solid var(--line)",
              background: "transparent",
              cursor: "pointer",
              color: "var(--bad)",
              fontFamily: "var(--le-font-sans)",
            }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
