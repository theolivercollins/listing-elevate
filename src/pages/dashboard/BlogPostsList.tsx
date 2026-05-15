import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listPosts, listTemplates } from "@/lib/blog/api-client";
import { thumbUrl } from "@/lib/blog/image-url";
import type { BlogPostState } from "@/lib/blog/types";
import {
  Plus, ExternalLink, Pencil, Sparkles, LayoutTemplate, ChevronDown, Trash2,
} from "lucide-react";
import { DeletePostDialog } from "@/components/blog/DeletePostDialog";

const STATE_FILTERS: Array<{ label: string; value: BlogPostState | "all" }> = [
  { label: "All", value: "all" },
  { label: "Drafts", value: "awaiting_approval" },
  { label: "Live", value: "live" },
  { label: "On hold", value: "on_hold" },
  { label: "Quarantined", value: "quarantined" },
];

export default function BlogPostsList() {
  const [state, setState] = useState<BlogPostState | "all">("all");
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["blog-posts-list", state, q],
    queryFn: () => listPosts({
      state: state === "all" ? undefined : state,
      q: q || undefined,
      limit: 100,
    }),
  });

  // Load templates so we can offer "Start from template" as a sub-menu.
  const { data: tplData } = useQuery({
    queryKey: ["blog-templates"],
    queryFn: () => listTemplates(),
  });
  const templates = tplData?.templates ?? [];

  const posts = data?.posts ?? [];
  const qc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; hasSierra: boolean } | null>(null);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Blog posts</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <Plus className="mr-1 h-4 w-4" /> New post
              <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={() => navigate("/dashboard/blog/posts/new")} className="cursor-pointer">
              <Pencil className="mr-2 h-4 w-4" />
              <div className="flex flex-col">
                <span>Write manually</span>
                <span className="text-xs text-muted-foreground">Blank editor — type or paste HTML</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/dashboard/blog/posts/new?ai=1")} className="cursor-pointer">
              <Sparkles className="mr-2 h-4 w-4" />
              <div className="flex flex-col">
                <span>Generate with AI</span>
                <span className="text-xs text-muted-foreground">Claude writes the first draft</span>
              </div>
            </DropdownMenuItem>
            {templates.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1 text-xs text-muted-foreground">From template</div>
                {templates.slice(0, 6).map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => navigate(`/dashboard/blog/posts/new?template=${t.id}`)}
                    className="cursor-pointer"
                  >
                    <LayoutTemplate className="mr-2 h-4 w-4" />
                    <span className="truncate">{t.name}</span>
                  </DropdownMenuItem>
                ))}
                {templates.length > 6 && (
                  <DropdownMenuItem onClick={() => navigate("/dashboard/blog/templates")} className="cursor-pointer text-xs text-muted-foreground">
                    Manage templates →
                  </DropdownMenuItem>
                )}
              </>
            )}
            {templates.length === 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/dashboard/blog/templates/new")} className="cursor-pointer">
                  <LayoutTemplate className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span>Create a template</span>
                    <span className="text-xs text-muted-foreground">Save HTML to reuse later</span>
                  </div>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATE_FILTERS.map(f => (
          <Button key={f.value} size="sm" variant={state === f.value ? "default" : "outline"} onClick={() => setState(f.value)}>
            {f.label}
          </Button>
        ))}
        <Input placeholder="Search title…" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
      </div>

      <DeletePostDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        postId={deleteTarget?.id ?? null}
        postTitle={deleteTarget?.title ?? ""}
        hasSierraCopy={deleteTarget?.hasSierra ?? false}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["blog-posts-list"] })}
      />

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs">
            <tr><th className="p-3">Title</th><th>State</th><th>Image</th><th>Author</th><th>Updated</th><th>Cost</th><th></th></tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
            ) : isError ? (
              <tr><td colSpan={7} className="p-4 text-center">
                <div className="text-sm text-destructive">Failed to load posts: {(error as any)?.message ?? String(error)}</div>
                <button onClick={() => refetch()} className="mt-2 text-xs underline text-muted-foreground">Retry</button>
              </td></tr>
            ) : posts.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">
                {state === "all" && !q ? (
                  <>No posts yet — click <span className="font-medium">New post</span> to start.</>
                ) : (
                  <>No posts match {state !== "all" && <span className="font-mono">state={state}</span>} {q && <span>title contains "{q}"</span>}. Try the <button onClick={() => { setState("all"); setQ(""); }} className="underline">All</button> filter.</>
                )}
              </td></tr>
            ) : posts.map(p => (
              <tr key={p.id} className="border-t hover:bg-muted/20">
                <td className="p-3"><Link to={`/dashboard/blog/posts/${p.id}`} className="font-medium underline-offset-2 hover:underline">{p.title}</Link></td>
                <td><StatePill state={p.state} /></td>
                <td>{p.image ? <img src={thumbUrl(p.image.blob_url, { width: 120, quality: 65 })} loading="lazy" decoding="async" className="h-8 w-12 rounded object-cover" alt="" /> : "—"}</td>
                <td>{p.author_label ?? "—"}</td>
                <td className="text-xs text-muted-foreground">{new Date(p.updated_at).toLocaleString()}</td>
                <td className="text-xs">${(p.cost_usd_cents / 100).toFixed(2)}</td>
                <td className="pr-3">
                  <div className="flex items-center justify-end gap-3">
                    {p.external_post_url && (
                      <a href={p.external_post_url} target="_blank" rel="noreferrer" aria-label="Open on Sierra">
                        <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ id: p.id, title: p.title, hasSierra: !!p.external_post_url })}
                      aria-label="Delete post"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatePill({ state }: { state: BlogPostState }) {
  const color = state === "live" ? "bg-green-100 text-green-800" :
                state === "quarantined" ? "bg-red-100 text-red-800" :
                state === "awaiting_approval" ? "bg-amber-100 text-amber-800" :
                state === "on_hold" ? "bg-slate-200 text-slate-800" :
                "bg-muted text-muted-foreground";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${color}`}>{state}</span>;
}
