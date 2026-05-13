import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageUploadDropzone } from "@/components/blog/ImageUploadDropzone";
import { DashboardButton } from "@/v2/components/dashboard/DashboardButton";
import { DashboardCard } from "@/v2/components/dashboard/DashboardCard";
import { StatusPill } from "@/v2/components/dashboard/StatusPill";
import { ChipTabs } from "@/v2/components/dashboard/ChipTabs";
import { deleteImage, listImages, updateImage } from "@/lib/blog/api-client";
import { thumbUrl } from "@/lib/blog/image-url";
import type { BlogImage } from "@/lib/blog/types";
import { Plus, Trash2, Tag } from "lucide-react";
import { toast } from "sonner";

const VOCAB = ["aerial","exterior","interior","team","area","lifestyle","event","seasonal_spring","seasonal_summer","seasonal_fall","seasonal_winter","data_chart"];

const TAG_FILTER_ITEMS = [
  { value: "__all__", label: "All" },
  ...VOCAB.map(t => ({ value: t, label: t })),
];

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
        <h1 className="le-display text-[28px] font-medium tracking-tight">
          Image library{" "}
          <span className="ml-2 text-sm font-normal" style={{ color: "var(--le-text-muted)" }}>{images.length}</span>
        </h1>
        <DashboardButton variant="primary" onClick={() => setUploadOpen(true)}>
          <Plus className="h-4 w-4" /> Upload
        </DashboardButton>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search caption…" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
        <div className="overflow-x-auto">
          <ChipTabs
            items={TAG_FILTER_ITEMS}
            value={tag ?? "__all__"}
            onChange={(v) => setTag(v === "__all__" ? null : v)}
            ariaLabel="Filter images by tag"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--le-text-muted)" }}>Loading…</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {images.map(img => (
            <DashboardCard key={img.id} padding="sm" className="overflow-hidden !p-0">
              <div
                className="relative w-full overflow-hidden"
                style={{ paddingTop: "75%", background: "var(--le-bg-sunken)" }}
              >
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
                <div className="flex flex-wrap gap-1">
                  {img.vision_tags.map(t => (
                    <StatusPill key={t} tone="muted">{t}</StatusPill>
                  ))}
                </div>
                <div className="flex gap-1 pt-1">
                  <DashboardButton size="sm" variant="ghost" onClick={() => setEditing(img)}>
                    <Tag className="h-3 w-3" /> Tags
                  </DashboardButton>
                  <DashboardButton size="sm" variant="ghost" onClick={() => softDelete.mutate(img.id)}>
                    <Trash2 className="h-3 w-3" />
                  </DashboardButton>
                </div>
              </div>
            </DashboardCard>
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
            <img src={thumbUrl(editing.blob_url, { width: 600, quality: 75 })} className="mb-2 rounded-[8px]" alt="" />
            <div className="text-sm" style={{ color: "var(--le-text-muted)" }}>{editing.vision_caption}</div>
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
