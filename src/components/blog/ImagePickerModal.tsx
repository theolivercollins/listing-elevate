import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listImages } from "@/lib/blog/api-client";
import { thumbUrl } from "@/lib/blog/image-url";
import { ImageUploadDropzone } from "./ImageUploadDropzone";
import type { BlogImage } from "@/lib/blog/types";

const TAGS = ["aerial","exterior","interior","team","area","lifestyle","event","seasonal_summer","data_chart"];

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (img: BlogImage) => void;
}

export function ImagePickerModal({ open, onClose, onSelect }: Props) {
  const [images, setImages] = useState<BlogImage[]>([]);
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"library" | "upload">("library");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listImages({ tag: tag ?? undefined, q: q || undefined, limit: 200 })
      .then(r => setImages(r.images))
      .finally(() => setLoading(false));
  }, [open, tag, q]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Pick an image</DialogTitle></DialogHeader>
        <div className="flex gap-2 border-b pb-2">
          <Button size="sm" variant={tab === "library" ? "default" : "ghost"} onClick={() => setTab("library")}>Library</Button>
          <Button size="sm" variant={tab === "upload" ? "default" : "ghost"} onClick={() => setTab("upload")}>Upload new</Button>
        </div>

        {tab === "library" ? (
          <>
            <div className="flex flex-wrap items-center gap-2 py-2">
              <Input placeholder="search caption…" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
              <Button size="sm" variant={tag === null ? "default" : "outline"} onClick={() => setTag(null)}>All</Button>
              {TAGS.map(t => (
                <Button key={t} size="sm" variant={tag === t ? "default" : "outline"} onClick={() => setTag(t)}>{t}</Button>
              ))}
            </div>
            {loading ? <div>Loading…</div> : (
              <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto p-1">
                {images.map(img => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => { onSelect(img); onClose(); }}
                    className="group flex flex-col overflow-hidden rounded-md border bg-card text-left hover:ring-2 hover:ring-primary"
                  >
                    <div className="relative w-full overflow-hidden bg-muted" style={{ paddingTop: "75%" }}>
                      <img
                        src={thumbUrl(img.blob_url, { width: 400, quality: 70 })}
                        alt={img.vision_caption ?? ""}
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    </div>
                    <div className="truncate p-2 text-xs">{img.vision_caption ?? "—"}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <ImageUploadDropzone onUploaded={(img) => { setImages(prev => [img, ...prev]); setTab("library"); }} />
        )}
      </DialogContent>
    </Dialog>
  );
}
