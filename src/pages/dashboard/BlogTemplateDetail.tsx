import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PostEditor, type EditorMode } from "@/components/blog/PostEditor";
import { analyzeTemplate, createTemplate, getTemplate, getTaxonomy, updateTemplate } from "@/lib/blog/api-client";
import type { AnalyzeTemplateResult } from "@/lib/blog/types";
import { toast } from "sonner";
import { PageHeading, Card } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

// ─── shared field styles ─────────────────────────────────────────
const INPUT_STYLE: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "9px 14px",
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  fontSize: 13,
  fontFamily: "var(--le-font-sans)",
  color: "var(--ink)",
  outline: "none",
  boxSizing: "border-box",
};

const TEXTAREA_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  resize: "vertical",
  minHeight: 72,
};

const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  appearance: "none",
  WebkitAppearance: "none",
  cursor: "pointer",
};

const FIELD_LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 11.5,
  fontWeight: 500,
  color: "var(--muted)",
  marginBottom: 6,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={FIELD_LABEL}>{label}</label>
      {children}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────
export default function BlogTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["blog-template", id],
    queryFn: () => getTemplate(id!),
    enabled: !isNew,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body_html, setBodyHtml] = useState("");
  const [mode, setMode] = useState<EditorMode>("source");
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeTemplateResult | null>(null);
  const [defaultAuthorLabel, setDefaultAuthorLabel] = useState("");
  const [defaultCategoryLabel, setDefaultCategoryLabel] = useState("");
  const [defaultMetaTitle, setDefaultMetaTitle] = useState("");
  const [defaultMetaDescription, setDefaultMetaDescription] = useState("");
  const [defaultMetaTags, setDefaultMetaTags] = useState("");

  const { data: taxonomyData } = useQuery({ queryKey: ["blog-taxonomy"], queryFn: () => getTaxonomy() });
  const taxonomy = taxonomyData ?? { authors: [], categories: [] };

  useEffect(() => {
    if (data?.template) {
      setName(data.template.name);
      setDescription(data.template.description ?? "");
      setBodyHtml(data.template.body_html);
      setDefaultAuthorLabel(data.template.default_author_label ?? "");
      setDefaultCategoryLabel(data.template.default_category_label ?? "");
      setDefaultMetaTitle(data.template.default_meta_title ?? "");
      setDefaultMetaDescription(data.template.default_meta_description ?? "");
      setDefaultMetaTags((data.template.default_meta_tags ?? []).join(", "));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const defaults = {
        default_author_label: defaultAuthorLabel || null,
        default_category_label: defaultCategoryLabel || null,
        default_meta_title: defaultMetaTitle || null,
        default_meta_description: defaultMetaDescription || null,
        default_meta_tags: defaultMetaTags
          ? defaultMetaTags.split(",").map(t => t.trim()).filter(Boolean)
          : [],
      };
      if (isNew) return createTemplate({ name, description: description || undefined, body_html, ...defaults });
      await updateTemplate(id!, { name, description: description || null, body_html, ...defaults });
      return { id: id! };
    },
    onSuccess: () => {
      toast.success(isNew ? "Created" : "Saved");
      qc.invalidateQueries({ queryKey: ["blog-templates"] });
      navigate("/dashboard/blog/templates");
    },
    onError: (e: unknown) => toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  const analyze = useMutation({
    mutationFn: () => analyzeTemplate(body_html),
    onSuccess: (r) => setAnalyzeResult(r),
    onError: (e: unknown) => toast.error(`Analyze failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { toast.error("File > 1MB"); return; }
    file.text().then((text) => { setBodyHtml(text); toast.success(`Loaded ${file.name}`); });
  }

  if (!isNew && isLoading) {
    return (
      <div style={{ padding: "64px 0", display: "flex", justifyContent: "center" }}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
          <path d="M21 12a9 9 0 1 1-6.22-8.56" />
        </svg>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      <PageHeading
        eyebrow="Content · Blog · Templates"
        title={isNew ? "New template" : `Edit: ${name}`}
        sub={isNew ? "Define a reusable HTML structure for blog posts." : "Update the template HTML and default field values."}
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="le-btn-ghost" onClick={() => navigate("/dashboard/blog/templates")}>
              Cancel
            </button>
            <button
              className="le-btn-dark"
              onClick={() => save.mutate()}
              disabled={!name || !body_html || save.isPending}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              {save.isPending ? (
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                </svg>
              ) : <Icon name="check" size={13} />}
              Save
            </button>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        }
      />

      {/* Basic info */}
      <Card padding={20}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Name">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Monthly Market Update"
              style={INPUT_STYLE}
            />
          </Field>
          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="When to use this template"
              style={TEXTAREA_STYLE}
            />
          </Field>
        </div>
      </Card>

      {/* Default fields */}
      <Card padding={20}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.015em", marginBottom: 4 }}>Default fields</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              When this template is selected on a new post, these values pre-fill the sidebar.
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Default author">
              <select
                value={defaultAuthorLabel}
                onChange={e => setDefaultAuthorLabel(e.target.value)}
                style={SELECT_STYLE}
              >
                <option value="">— None —</option>
                {taxonomy.authors.filter(a => a.label && !a.label.toLowerCase().startsWith("select")).map(a => (
                  <option key={a.id} value={a.label}>{a.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Default category">
              <select
                value={defaultCategoryLabel}
                onChange={e => setDefaultCategoryLabel(e.target.value)}
                style={SELECT_STYLE}
              >
                <option value="">— None —</option>
                {taxonomy.categories.filter(c => c.label && !c.label.toLowerCase().startsWith("choose") && !c.label.startsWith("---")).map(c => (
                  <option key={c.id} value={c.label}>{c.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Default meta title">
            <input value={defaultMetaTitle} onChange={e => setDefaultMetaTitle(e.target.value)} style={INPUT_STYLE} />
          </Field>
          <Field label="Default meta description">
            <textarea value={defaultMetaDescription} onChange={e => setDefaultMetaDescription(e.target.value)} rows={2} style={TEXTAREA_STYLE} />
          </Field>
          <Field label="Default meta tags (comma-separated)">
            <input value={defaultMetaTags} onChange={e => setDefaultMetaTags(e.target.value)} style={INPUT_STYLE} />
          </Field>
        </div>
      </Card>

      {/* Body HTML editor */}
      {/* overflow:visible is required so Tiptap table-resize handles are not clipped */}
      <Card padding={0}>
        {/* Editor toolbar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.01em" }}>Body HTML</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="le-btn-ghost"
              onClick={() => fileRef.current?.click()}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12 }}
            >
              <Icon name="upload" size={12} />
              Upload .html
            </button>
            <button
              className="le-btn-ghost"
              onClick={() => {
                if (!body_html || body_html.trim().length < 20) {
                  toast.error("Paste or upload HTML first (min 20 chars).");
                  return;
                }
                analyze.mutate();
              }}
              disabled={analyze.isPending}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12 }}
            >
              {analyze.isPending ? (
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                </svg>
              ) : <Icon name="sparkles" size={12} />}
              Analyze with AI
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".html,text/html" style={{ display: "none" }} onChange={onUpload} />
        </div>
        <PostEditor
          value={body_html}
          onChange={setBodyHtml}
          onInsertImageClick={() => toast.info("Image insert: use Post editor; templates should stay text-only for now")}
          mode={mode}
          onModeChange={setMode}
          minHeight={400}
        />
      </Card>

      {/* AI analyze result dialog */}
      <Dialog open={!!analyzeResult} onOpenChange={(v) => !v && setAnalyzeResult(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="sparkles" size={14} />
              Template analysis
            </DialogTitle>
          </DialogHeader>
          {analyzeResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Field label="Suggested name">
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={analyzeResult.suggested_name} readOnly style={{ ...INPUT_STYLE, flex: 1 }} />
                  <button className="le-btn-ghost" onClick={() => setName(analyzeResult.suggested_name)} style={{ fontSize: 12 }}>Apply</button>
                </div>
              </Field>
              <Field label="Suggested description">
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <textarea value={analyzeResult.suggested_description} readOnly rows={2} style={{ ...TEXTAREA_STYLE, flex: 1 }} />
                  <button className="le-btn-ghost" onClick={() => setDescription(analyzeResult.suggested_description)} style={{ fontSize: 12 }}>Apply</button>
                </div>
              </Field>
              {analyzeResult.detected_sections.length > 0 && (
                <Field label="Detected sections">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                    {analyzeResult.detected_sections.map((s, i) => (
                      <span
                        key={i}
                        style={{
                          padding: "3px 8px",
                          borderRadius: "var(--radius-pill)",
                          background: "rgba(11,11,16,0.05)",
                          fontSize: 11.5,
                          color: "var(--ink-2)",
                        }}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </Field>
              )}
              {analyzeResult.notes && (
                <Field label="Notes">
                  <pre style={{ whiteSpace: "pre-wrap", background: "rgba(11,11,16,0.03)", borderRadius: "var(--radius-sm)", padding: "12px 14px", fontSize: 12, color: "var(--ink-2)", fontFamily: "var(--le-font-sans)", margin: 0, border: "1px solid var(--line-2)" }}>
                    {analyzeResult.notes}
                  </pre>
                </Field>
              )}
              <div style={{ fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                Cost: ${(analyzeResult.cost_cents / 100).toFixed(2)} · Model: {analyzeResult.model}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="le-btn-ghost" onClick={() => setAnalyzeResult(null)}>Close</button>
                <button
                  className="le-btn-dark"
                  onClick={() => {
                    setName(analyzeResult.suggested_name);
                    setDescription(analyzeResult.suggested_description);
                    setAnalyzeResult(null);
                    toast.success("Applied suggestions");
                  }}
                >
                  Apply all
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
