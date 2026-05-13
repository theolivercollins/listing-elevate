import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardButton } from "@/v2/components/dashboard/DashboardButton";
import { DashboardCard } from "@/v2/components/dashboard/DashboardCard";
import { EmptyState } from "@/v2/components/dashboard/EmptyState";
import { deleteTemplate, listTemplates } from "@/lib/blog/api-client";
import { HtmlPreview } from "@/components/blog/HtmlPreview";
import { Plus, Pencil, Trash2, LayoutTemplate } from "lucide-react";
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
        <h1 className="le-display text-[28px] font-medium tracking-tight">
          Templates{" "}
          <span className="ml-2 text-sm font-normal" style={{ color: "var(--le-text-muted)" }}>{templates.length}</span>
        </h1>
        <Link to="/dashboard/blog/templates/new">
          <DashboardButton variant="primary">
            <Plus className="h-4 w-4" /> New template
          </DashboardButton>
        </Link>
      </div>

      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--le-text-muted)" }}>Loading…</div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate className="h-8 w-8" />}
          title="No templates yet"
          body={
            <span>
              <Link to="/dashboard/blog/templates/new" className="underline">Create one</Link> to save reusable HTML layouts.
            </span>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map(t => (
            <DashboardCard key={t.id} padding="none" className="overflow-hidden">
              <HtmlPreview
                html={t.body_html}
                style={{ width: "100%", height: 180, border: "none", display: "block", borderRadius: 14 }}
              />
              <div className="space-y-1 p-3">
                <div className="font-medium">{t.name}</div>
                {t.description && (
                  <div className="text-xs" style={{ color: "var(--le-text-muted)" }}>{t.description}</div>
                )}
                <div className="flex gap-2 pt-2">
                  <Link to={`/dashboard/blog/templates/${t.id}`}>
                    <DashboardButton size="sm" variant="ghost">
                      <Pencil className="h-3 w-3" /> Edit
                    </DashboardButton>
                  </Link>
                  <Link to={`/dashboard/blog/posts/new?template=${t.id}`}>
                    <DashboardButton size="sm" variant="ghost">Use in new post</DashboardButton>
                  </Link>
                  <DashboardButton size="sm" variant="ghost" className="ml-auto" onClick={() => del.mutate(t.id)}>
                    <Trash2 className="h-3 w-3" />
                  </DashboardButton>
                </div>
              </div>
            </DashboardCard>
          ))}
        </div>
      )}
    </div>
  );
}
