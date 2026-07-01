import { useEffect, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/dashboard/primitives";
import { listImages, uploadImage } from "@/lib/blog/api-client";
import { thumbUrl } from "@/lib/blog/image-url";
import type { BlogImage } from "@/lib/blog/types";
import { Check, Upload, Search, X, Loader2, Image as ImageIcon } from "lucide-react";

const TAGS = [
  "aerial", "exterior", "interior", "team",
  "area", "lifestyle", "event", "seasonal_summer", "data_chart",
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (img: BlogImage) => void;
  /** Currently selected image id — highlights the active tile in the grid. */
  selectedId?: string | null;
}

// Skeleton tile shown while images load
function SkeletonTile() {
  return (
    <Skeleton
      width="100%"
      height="auto"
      borderRadius="var(--le-r-lg)"
      style={{ aspectRatio: "4/3" }}
    />
  );
}

// Single image tile
function ImageTile({
  img,
  selected,
  onSelect,
}: {
  img: BlogImage;
  selected: boolean;
  onSelect: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  // Preload full thumb on hover
  const onMouseEnter = useCallback(() => {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = thumbUrl(img.blob_url, { width: 800, quality: 80 });
    document.head.appendChild(link);
    setTimeout(() => link.remove(), 5000);
  }, [img.blob_url]);

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      title={img.vision_caption ?? undefined}
      style={{
        position: "relative",
        aspectRatio: "4/3",
        borderRadius: "var(--le-r-lg)",
        overflow: "hidden",
        background: "rgba(11,11,16,0.06)",
        border: selected ? "2px solid var(--accent, #172033)" : "2px solid transparent",
        boxShadow: selected ? "0 0 0 2px rgba(23,32,51,0.25)" : undefined,
        cursor: "pointer",
        padding: 0,
        transition: "border-color .15s, box-shadow .15s, transform .15s",
        willChange: "transform",
      }}
      onFocus={(e) => { e.currentTarget.style.outline = "2px solid var(--accent, #172033)"; e.currentTarget.style.outlineOffset = "2px"; }}
      onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
      onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.97)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = ""; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
    >
      {/* Skeleton shown until image loads */}
      {!loaded && (
        <Skeleton width="100%" height="100%" borderRadius={0} style={{ position: "absolute", inset: 0 }} />
      )}
      <img
        src={thumbUrl(img.blob_url, { width: 240, quality: 75, resize: "cover" })}
        alt={img.vision_caption ?? ""}
        loading="eager"
        decoding="async"
        onLoad={() => setLoaded(true)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: loaded ? 1 : 0,
          transition: "opacity .2s",
        }}
      />
      {/* Caption tooltip on hover */}
      {img.vision_caption && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "20px 8px 6px",
            background: "linear-gradient(to top, rgba(11,11,16,0.7) 0%, transparent 100%)",
            color: "#fff",
            fontSize: 11,
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            opacity: 0,
            transition: "opacity .15s",
            pointerEvents: "none",
          }}
          className="img-tile-caption"
        >
          {img.vision_caption}
        </div>
      )}
      {/* Checkmark overlay for selected */}
      {selected && (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "var(--accent, #172033)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check size={13} color="var(--le-accent-fg, #fff)" strokeWidth={3} />
        </div>
      )}
    </button>
  );
}

// Upload tile — opens file picker; manages its own uploading state
function UploadTile({ onUploaded }: { onUploaded: (img: BlogImage) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    for (const f of files) {
      try {
        const img = await uploadImage(f);
        onUploaded(img);
      } catch {
        // silent — parent will show error if needed
      }
    }
    setUploading(false);
  };

  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        style={{
          aspectRatio: "4/3",
          borderRadius: "var(--le-r-lg)",
          border: "2px dashed rgba(11,11,16,0.18)",
          background: "rgba(11,11,16,0.025)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: "var(--muted, #656b7a)",
          cursor: uploading ? "wait" : "pointer",
          transition: "background .15s, border-color .15s",
          fontSize: 12,
          fontWeight: 500,
        }}
        onMouseEnter={(e) => {
          if (uploading) return;
          e.currentTarget.style.background = "rgba(23,32,51,0.06)";
          e.currentTarget.style.borderColor = "rgba(23,32,51,0.4)";
          e.currentTarget.style.color = "var(--accent, #172033)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(11,11,16,0.025)";
          e.currentTarget.style.borderColor = "rgba(11,11,16,0.18)";
          e.currentTarget.style.color = "var(--muted, #656b7a)";
        }}
        disabled={uploading}
      >
        {uploading ? (
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
        ) : (
          <Upload size={20} />
        )}
        <span>{uploading ? "Uploading…" : "Upload new"}</span>
      </button>
    </>
  );
}

// Tag pill button
function TagPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 12px",
        borderRadius: "var(--le-r-pill)",
        border: active ? "1.5px solid var(--accent, #172033)" : "1.5px solid rgba(11,11,16,0.12)",
        background: active ? "rgba(23,32,51,0.1)" : "transparent",
        color: active ? "var(--accent, #172033)" : "var(--muted, #656b7a)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all .12s",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );
}

export function ImagePickerModal({ open, onClose, onSelect, selectedId }: Props) {
  const [images, setImages] = useState<BlogImage[]>([]);
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounce search by 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Load images whenever picker opens or filter changes
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listImages({ tag: tag ?? undefined, q: debouncedQ || undefined, limit: 60 })
      .then((r) => setImages(r.images))
      .catch(() => {/* swallow */})
      .finally(() => setLoading(false));
  }, [open, tag, debouncedQ]);

  // Focus search on open
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 80);
    } else {
      // Reset filters on close so next open feels fresh
      setQ("");
      setDebouncedQ("");
      setTag(null);
    }
  }, [open]);

  function handleSelect(img: BlogImage) {
    onSelect(img);
    onClose();
  }

  function handleUploaded(img: BlogImage) {
    // Prepend newly uploaded image + auto-select it
    setImages((prev) => [img, ...prev]);
    handleSelect(img);
  }

  // The grid shows: Upload tile first, then images (skeleton or real)
  const SKELETONS = 12;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="le-dash-shell"
        style={{
          maxWidth: 780,
          width: "95vw",
          padding: 0,
          overflow: "hidden",
          borderRadius: "var(--le-r-xl)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "88vh",
        }}
      >
        {/* Header */}
        <DialogHeader
          style={{
            padding: "18px 20px 14px",
            borderBottom: "1px solid var(--line, rgba(12,14,22,0.08))",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ImageIcon size={16} style={{ color: "var(--muted, #656b7a)", flexShrink: 0 }} />
            <DialogTitle style={{ fontSize: 15, fontWeight: 600, color: "var(--ink, #0c0e16)", margin: 0 }}>
              Image library
            </DialogTitle>
            {images.length > 0 && !loading && (
              <span style={{ fontSize: 12, color: "var(--muted, #656b7a)", marginLeft: 4 }}>
                {images.length} image{images.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </DialogHeader>

        {/* Search + Tag filters */}
        <div
          style={{
            padding: "12px 20px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            borderBottom: "1px solid var(--line, rgba(12,14,22,0.08))",
            flexShrink: 0,
            background: "var(--surface, #fff)",
          }}
        >
          {/* Search row */}
          <div style={{ position: "relative" }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: 11,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--muted, #656b7a)",
                pointerEvents: "none",
              }}
            />
            <Input
              ref={searchRef}
              placeholder="Search by caption or filename…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ paddingLeft: 32, paddingRight: q ? 32 : undefined, height: 36 }}
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--muted, #656b7a)",
                  padding: 2,
                  display: "flex",
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Tag pills row */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
            <TagPill label="All" active={tag === null} onClick={() => setTag(null)} />
            {TAGS.map((t) => (
              <TagPill key={t} label={t} active={tag === t} onClick={() => setTag(t === tag ? null : t)} />
            ))}
          </div>
        </div>

        {/* Image grid */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px 20px",
            background: "var(--bg, #f4f5f8)",
          }}
        >
          {/* Empty state */}
          {!loading && images.length === 0 && (
            <div
              style={{
                padding: "48px 0",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                color: "var(--muted, #656b7a)",
                fontSize: 13,
              }}
            >
              <ImageIcon size={28} style={{ opacity: 0.35 }} />
              <div>
                {q || tag
                  ? "No images match this filter."
                  : "No images yet — upload your first one."}
              </div>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 10,
            }}
          >
            {/* Upload tile always first */}
            <UploadTile onUploaded={handleUploaded} />

            {/* Skeleton tiles while loading */}
            {loading && Array.from({ length: SKELETONS }).map((_, i) => (
              <SkeletonTile key={`sk-${i}`} />
            ))}

            {/* Real image tiles */}
            {!loading && images.map((img) => (
              <ImageTile
                key={img.id}
                img={img}
                selected={img.id === selectedId}
                onSelect={() => handleSelect(img)}
              />
            ))}
          </div>
        </div>

        {/* Sticky caption hover CSS — injected once */}
        <style>{`
          .img-tile-caption { opacity: 0 !important; }
          button:hover .img-tile-caption { opacity: 1 !important; }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
