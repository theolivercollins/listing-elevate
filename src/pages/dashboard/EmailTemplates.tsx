// src/pages/dashboard/EmailTemplates.tsx
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { deleteEmailTemplate, listEmailTemplates } from "@/lib/blog/api-client";
import { HtmlPreview } from "@/components/blog/HtmlPreview";
import { Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeading, EmptyState } from "@/components/dashboard/primitives";

export default function EmailTemplates() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["email-templates"],
    queryFn: () => listEmailTemplates(),
  });
  const templates = data?.templates ?? [];

  const del = useMutation({
    mutationFn: (id: string) => deleteEmailTemplate(id),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["email-templates"] }); },
    onError: (e: any) => toast.error(`Delete failed: ${e?.message ?? e}`),
  });

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeading
        eyebrow="Content"
        title="Email templates"
        sub={`${templates.length} saved ${templates.length === 1 ? "template" : "templates"}`}
        actions={
          <Link to="/dashboard/studio/email/templates/new">
            <Button><Plus className="mr-1 h-4 w-4" /> New template</Button>
          </Link>
        }
      />

      {isLoading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : templates.length === 0 ? (
        <EmptyState
          message="No email templates yet."
          icon="delivered"
          cta={{ label: "Create one", to: "/dashboard/studio/email/templates/new" }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="overflow-hidden rounded-md border bg-card">
              {t.thumbnail_url ? (
                <img
                  src={t.thumbnail_url}
                  alt={t.name}
                  className="w-full object-cover"
                  style={{ height: 180 }}
                />
              ) : (
                <div
                  className="flex items-center justify-center bg-muted/30"
                  style={{ height: 180 }}
                >
                  <HtmlPreview html={t.body_html || "<p></p>"} style={{ width: "100%", height: "100%", border: "none", display: "block" }} />
                </div>
              )}
              <div className="space-y-1 p-3">
                <div className="font-medium">{t.name}</div>
                {t.description && (
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                )}
                {t.default_subject && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3" /> {t.default_subject}
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Link to={`/dashboard/studio/email/templates/${t.id}`}>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                      <Pencil className="mr-1 h-3 w-3" /> Edit
                    </Button>
                  </Link>
                  <Link to={`/dashboard/studio/email/messages/new?template=${t.id}`}>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                      Use in email
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 px-2 text-xs"
                    onClick={() => {
                      if (!window.confirm("Delete this template?")) return;
                      del.mutate(t.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
