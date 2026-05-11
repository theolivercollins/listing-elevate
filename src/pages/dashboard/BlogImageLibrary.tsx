import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageUploadDropzone } from "@/components/blog/ImageUploadDropzone";
import { deleteImage, listImages, updateImage } from "@/lib/blog/api-client";
import { thumbUrl } from "@/lib/blog/image-url";
import type { BlogImage } from "@/lib/blog/types";
import { Plus, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";

const VOCAB = ["aerial","exterior","interior","team","area","lifestyle","event","seasonal_spring","seasonal_summer","seasonal_fall","seasonal_winter","data_chart"];

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
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Image library <span className="ml-2 text-sm font-normal text-muted-foreground">{images.length}</span></h1>
        <Button onClick={() => setUploadOpen(true)}><Plus className="mr-1 h-4 w-4" /> Upload</Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search caption…" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
        <Button size="sm" variant={tag === null ? "default" : "outline"} onClick={() => setTag(null)}>All</Button>
        {VOCAB.map(t => (
          <Button key={t} size="sm" variant={tag === t ? "default" : "outline"} onClick={() => setTag(t)}>{t}</Button>
        ))}
      </div>

      {isLoading ? <div>Loading…</div> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {images.map(img => (
            <div key={img.id} className="overflow-hidden rounded-md border bg-card">
              <div className="relative w-full overflow-hidden bg-muted" style={{ paddingTop: "75%" }}>
                <img
                  src={thumbUrl(img.blob_url, { width: 400, quality: 70 })}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                  alt={img.vision_caption ?? ""}
                />
              </div>
              <div className="space-y-1 p-2">
                <div className="text-xs">{img.vision_caption ?? "—"}</div>
                <div className="flex flex-wrap gap-1">{img.vision_tags.map(t => (
                  <span key={t} className="rounded bg-muted px-1 text-[10px]">{t}</span>
                ))}</div>
                <div className="flex gap-1 pt-1">
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditing(img)}><Tag className="mr-1 h-3 w-3" /> Tags</Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => softDelete.mutate(img.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Upload images</DialogTitle></DialogHeader>
          <ImageUploadDropzone onUploaded={() => qc.invalidateQueries({ queryKey: ["blog-images"] })} />
        </DialogContent>
      </Dialog>

      {editing && (
        <Dialog open onOpenChange={() => setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit tags</DialogTitle></DialogHeader>
            <img src={thumbUrl(editing.blob_url, { width: 600, quality: 75 })} className="mb-2 rounded" alt="" />
            <div className="text-sm text-muted-foreground">{editing.vision_caption}</div>
            <div className="flex flex-wrap gap-2 pt-2">
              {VOCAB.map(t => {
                const on = editing.vision_tags.includes(t);
                return (
                  <Button key={t} size="sm" variant={on ? "default" : "outline"} onClick={() => {
                    const next = on ? editing.vision_tags.filter(x => x !== t) : [...editing.vision_tags, t];
                    setEditing({ ...editing, vision_tags: next });
                  }}>{t}</Button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => { patch.mutate({ id: editing.id, tags: editing.vision_tags }); setEditing(null); }}>Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
