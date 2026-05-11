import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PostEditor, type EditorMode } from "@/components/blog/PostEditor";
import { createTemplate, getTemplate, updateTemplate } from "@/lib/blog/api-client";
import { toast } from "sonner";
import { Upload } from "lucide-react";

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

  useEffect(() => {
    if (data?.template) {
      setName(data.template.name);
      setDescription(data.template.description ?? "");
      setBodyHtml(data.template.body_html);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createTemplate({ name, description: description || undefined, body_html });
      await updateTemplate(id!, { name, description: description || null, body_html });
      return { id: id! };
    },
    onSuccess: (r) => {
      toast.success(isNew ? "Created" : "Saved");
      qc.invalidateQueries({ queryKey: ["blog-templates"] });
      navigate(`/dashboard/blog/templates`);
    },
    onError: (e: any) => toast.error(`Save failed: ${e?.message ?? e}`),
  });

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { toast.error("File > 1MB"); return; }
    file.text().then((text) => { setBodyHtml(text); toast.success(`Loaded ${file.name}`); });
  }

  if (!isNew && isLoading) return <div>Loading…</div>;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{isNew ? "New template" : `Edit: ${name}`}</h1>
      <div className="space-y-4">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly Market Update" />
        </div>
        <div>
          <Label>Description (optional)</Label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="When to use this template" />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Body HTML</Label>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-3.5 w-3.5" /> Upload .html
            </Button>
            <input ref={fileRef} type="file" accept=".html,text/html" className="hidden" onChange={onUpload} />
          </div>
          <PostEditor
            value={body_html}
            onChange={setBodyHtml}
            onInsertImageClick={() => toast.info("Image insert: use Post editor; templates should stay text-only for now")}
            mode={mode}
            onModeChange={setMode}
            minHeight={400}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={!name || !body_html || save.isPending}>Save</Button>
          <Button variant="outline" onClick={() => navigate("/dashboard/blog/templates")}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
