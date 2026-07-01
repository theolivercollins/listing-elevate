import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageUploadDropzone } from "@/components/blog/ImageUploadDropzone";
import { deleteImage, listImages, updateImage } from "@/lib/blog/api-client";
import { thumbUrl } from "@/lib/blog/image-url";
import type { BlogImage } from "@/lib/blog/types";
import { toast } from "sonner";
import { PageHeading, Card, Skeleton } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

const VOCAB = ["aerial","exterior","interior","team","area","lifestyle","event","seasonal_spring","seasonal_summer","seasonal_fall","seasonal_winter","data_chart"];

// ─── input style ─────────────────────────────────────────────────
const INPUT_STYLE: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: "var(--le-r-lg)",
  border: "1px solid var(--line, var(--le-border))",
  background: "var(--surface, var(--le-surface))",
  fontSize: 13,
  fontFamily: "var(--le-font-sans)",
  color: "var(--ink, var(--le-text))",
  outline: "none",
  width: 220,
};

export default function BlogImageLibrary() {
  const qc = useQueryClient();
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<BlogImage | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["blog-images", tag, q],
    queryFn: () => listImages({ tag: tag ?? undefined, q: q || undefined, limit: 500 }),
  });
  const images = data?.images ?? [];

  const patch = useMutation({
    mutationFn: ({ id, tags }: { id: string; tags: string[] }) => updateImage(id, { vision_tags: tags }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blog-images"] }),
  });
  const softDelete = useMutation({
    mutationFn: (id: string) => deleteImage(id),
    onSuccess: () => { toast.success("Archived"); qc.invalidateQueries({ queryKey: ["blog-images"] }); },
  });

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      <PageHeading
        eyebrow="Content · Blog · Images"
        title="Image library"
        sub={`${images.length} image${images.length === 1 ? "" : "s"} available for posts.`}
        actions={
          <button
            className="le-btn-dark"
            onClick={() => setUploadOpen(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
          >
            <Icon name="upload" size={13} />
            Upload
          </button>
        }
      />

      {/* Filter bar */}
      <Card padding={16}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input
            placeholder="Search caption…"
            value={q}
            onChange={e => setQ(e.target.value)}
            style={INPUT_STYLE}
          />
          <div className="le-seg">
            <button
              className={`le-seg-item${tag === null ? " is-active" : ""}`}
              onClick={() => setTag(null)}
            >
              All
            </button>
            {VOCAB.map(t => (
              <button
                key={t}
                className={`le-seg-item${tag === t ? " is-active" : ""}`}
                onClick={() => setTag(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Upload drop zone (always visible below filter) */}
      <Card padding={0} style={{ border: "2px dashed var(--line-2, var(--le-border-strong))" }}>
        <div style={{ padding: "64px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <Icon name="upload" size={24} style={{ color: "var(--muted-2, var(--le-faint))" }} />
          <div style={{ fontSize: 13, color: "var(--muted, var(--le-muted))", textAlign: "center" }}>
            Drop images here or{" "}
            <button
              onClick={() => setUploadOpen(true)}
              style={{ background: "none", border: "none", color: "var(--accent, var(--le-accent))", cursor: "pointer", fontSize: 13, fontFamily: "var(--le-font-sans)", padding: 0, fontWeight: 500 }}
            >
              browse to upload
            </button>
          </div>
        </div>
      </Card>

      {/* Grid */}
      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} width="100%" height="auto" borderRadius="var(--radius)" style={{ aspectRatio: "4/3" }} />
          ))}
        </div>
      ) : images.length === 0 ? (
        <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "var(--muted, var(--le-muted))" }}>
          No images match this filter.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
          {images.map(img => (
            <ImageTile
              key={img.id}
              img={img}
              onEdit={() => setEditing(img)}
              onDelete={() => softDelete.mutate(img.id)}
            />
          ))}
        </div>
      )}

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Upload images</DialogTitle></DialogHeader>
          <ImageUploadDropzone onUploaded={() => qc.invalidateQueries({ queryKey: ["blog-images"] })} />
        </DialogContent>
      </Dialog>

      {/* Tag edit dialog */}
      {editing && (
        <Dialog open onOpenChange={() => setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit tags</DialogTitle></DialogHeader>
            <img
              src={thumbUrl(editing.blob_url, { width: 600, quality: 75 })}
              style={{ width: "100%", borderRadius: "var(--le-r-md)", marginBottom: 8, display: "block" }}
              alt=""
            />
            <div style={{ fontSize: 12, color: "var(--muted, var(--le-muted))", marginBottom: 12 }}>{editing.vision_caption}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {VOCAB.map(t => {
                const on = editing.vision_tags.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => {
                      const next = on ? editing.vision_tags.filter(x => x !== t) : [...editing.vision_tags, t];
                      setEditing({ ...editing, vision_tags: next });
                    }}
                    style={{
                      padding: "5px 12px",
                      borderRadius: "var(--le-r-pill)",
                      border: on ? "none" : "1px solid var(--line, var(--le-border))",
                      background: on ? "var(--ink, var(--le-text))" : "var(--surface, var(--le-surface))",
                      color: on ? "var(--surface, var(--le-surface))" : "var(--ink-2, var(--le-text-secondary))",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "var(--le-font-sans)",
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="le-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="le-btn-dark" onClick={() => { patch.mutate({ id: editing.id, tags: editing.vision_tags }); setEditing(null); }}>Save</button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── image tile ──────────────────────────────────────────────────
function ImageTile({
  img,
  onEdit,
  onDelete,
}: {
  img: BlogImage;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      className="le-lift"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: "var(--surface, var(--le-surface))",
        borderRadius: "var(--radius)",
        boxShadow: hov ? "var(--shadow-md)" : "var(--shadow-sm)",
        transform: hov ? "translateY(-1px)" : "translateY(0)",
        transition: "box-shadow .15s, transform .15s",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "relative", width: "100%", paddingTop: "75%", background: "rgba(12,14,22,0.04)" }}>
        <img
          src={thumbUrl(img.blob_url, { width: 400, quality: 70 })}
          loading="lazy"
          decoding="async"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          alt={img.vision_caption ?? ""}
        />
      </div>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 11.5, color: "var(--ink-2, var(--le-text-secondary))", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {img.vision_caption ?? "—"}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {img.vision_tags.map(t => (
            <span
              key={t}
              style={{
                padding: "2px 6px",
                borderRadius: "var(--radius-pill)",
                background: "rgba(12,14,22,0.05)",
                fontSize: 10,
                color: "var(--muted, var(--le-muted))",
              }}
            >
              {t}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, paddingTop: 2 }}>
          <button
            onClick={onEdit}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: "var(--le-r-sm)", border: "1px solid var(--line, var(--le-border))", background: "transparent", cursor: "pointer", fontSize: 11.5, color: "var(--ink-2, var(--le-text-secondary))", fontFamily: "var(--le-font-sans)" }}
          >
            <Icon name="sliders" size={11} />
            Tags
          </button>
          <button
            onClick={onDelete}
            style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: "var(--le-r-sm)", border: "1px solid var(--line, var(--le-border))", background: "transparent", cursor: "pointer", color: "var(--bad, var(--le-bad))", fontFamily: "var(--le-font-sans)" }}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
