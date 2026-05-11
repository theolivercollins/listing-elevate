import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { deleteTemplate, listTemplates } from "@/lib/blog/api-client";
import { HtmlPreview } from "@/components/blog/HtmlPreview";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Templates <span className="ml-2 text-sm font-normal text-muted-foreground">{templates.length}</span></h1>
        <Link to="/dashboard/blog/templates/new"><Button><Plus className="mr-1 h-4 w-4" /> New template</Button></Link>
      </div>
      {isLoading ? <div>Loading…</div> : templates.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No templates yet. <Link to="/dashboard/blog/templates/new" className="underline">Create one</Link>.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map(t => (
            <div key={t.id} className="overflow-hidden rounded-md border bg-card">
              <HtmlPreview html={t.body_html} style={{ width: "100%", height: 180, border: "none", display: "block" }} />
              <div className="space-y-1 p-3">
                <div className="font-medium">{t.name}</div>
                {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                <div className="flex gap-2 pt-2">
                  <Link to={`/dashboard/blog/templates/${t.id}`}>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs"><Pencil className="mr-1 h-3 w-3" /> Edit</Button>
                  </Link>
                  <Link to={`/dashboard/blog/posts/new?template=${t.id}`}>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">Use in new post</Button>
                  </Link>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs ml-auto" onClick={() => del.mutate(t.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
