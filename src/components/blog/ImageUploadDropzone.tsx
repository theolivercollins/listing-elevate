import { useState, useCallback } from "react";
import { uploadImage } from "@/lib/blog/api-client";
import type { BlogImage } from "@/lib/blog/types";
import { Upload as UploadIcon } from "lucide-react";

interface Props {
  onUploaded: (img: BlogImage) => void;
  maxFiles?: number;
}

export function ImageUploadDropzone({ onUploaded, maxFiles = 10 }: Props) {
  const [progress, setProgress] = useState<Record<string, "uploading" | "tagging" | "done" | "error">>({});

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).slice(0, maxFiles);
    await Promise.all(arr.map(async (f) => {
      const key = `${f.name}-${f.size}`;
      setProgress(p => ({ ...p, [key]: "uploading" }));
      try {
        const img = await uploadImage(f);
        setProgress(p => ({ ...p, [key]: "done" }));
        onUploaded(img);
      } catch (e) {
        setProgress(p => ({ ...p, [key]: "error" }));
      }
    }));
  }, [maxFiles, onUploaded]);

  return (
    <div
      className="flex h-32 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/40 bg-muted/20 text-sm text-muted-foreground hover:bg-muted/40"
      onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
      onDragOver={e => e.preventDefault()}
      onClick={() => document.getElementById("blog-img-upload-input")?.click()}
    >
      <input id="blog-img-upload-input" type="file" accept="image/*" multiple className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
      <div className="flex flex-col items-center gap-2">
        <UploadIcon className="h-6 w-6" />
        <span>Drop images here or click to select</span>
        {Object.entries(progress).map(([k, v]) => <span key={k} className="text-xs">{k}: {v}</span>)}
      </div>
    </div>
  );
}
