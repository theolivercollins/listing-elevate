import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DashboardButton } from "@/v2/components/dashboard/DashboardButton";
import { StatusPill } from "@/v2/components/dashboard/StatusPill";
import { ChipTabs } from "@/v2/components/dashboard/ChipTabs";
import { listPosts, listTemplates } from "@/lib/blog/api-client";
import { thumbUrl } from "@/lib/blog/image-url";
import type { BlogPostState } from "@/lib/blog/types";
import {
  Plus, ExternalLink, Pencil, Sparkles, LayoutTemplate, ChevronDown,
} from "lucide-react";

const STATE_FILTERS: Array<{ label: string; value: BlogPostState | "all" }> = [
  { label: "All", value: "all" },
  { label: "Drafts", value: "awaiting_approval" },
  { label: "Live", value: "live" },
  { label: "Quarantined", value: "quarantined" },
];

export default function BlogPostsList() {
  const [state, setState] = useState<BlogPostState | "all">("all");
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="le-display text-[28px] font-medium tracking-tight">Blog posts</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <DashboardButton variant="primary">
              <Plus className="h-4 w-4" /> New post
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </DashboardButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={() => navigate("/dashboard/blog/posts/new")} className="cursor-pointer">
              <Pencil className="mr-2 h-4 w-4" />
              <div className="flex flex-col">
                <span>Write manually</span>
                <span className="text-xs" style={{ color: "var(--le-text-muted)" }}>Blank editor — type or paste HTML</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/dashboard/blog/posts/new?ai=1")} className="cursor-pointer">
              <Sparkles className="mr-2 h-4 w-4" />
              <div className="flex flex-col">
                <span>Generate with AI</span>
                <span className="text-xs" style={{ color: "var(--le-text-muted)" }}>Claude writes the first draft</span>
              </div>
            </DropdownMenuItem>
            {templates.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1 text-xs" style={{ color: "var(--le-text-muted)" }}>From template</div>
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
                  <DropdownMenuItem onClick={() => navigate("/dashboard/blog/templates")} className="cursor-pointer text-xs" style={{ color: "var(--le-text-muted)" }}>
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
                    <span className="text-xs" style={{ color: "var(--le-text-muted)" }}>Save HTML to reuse later</span>
                  </div>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ChipTabs
          items={STATE_FILTERS}
          value={state}
          onChange={(v) => setState(v)}
          ariaLabel="Filter posts by state"
        />
        <Input placeholder="Search title…" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
      </div>

      <div
        className="rounded-[14px] border overflow-hidden"
        style={{ borderColor: "var(--le-border)", background: "var(--le-bg-elev)" }}
      >
        <table className="w-full text-sm">
          <thead
            className="text-left text-xs"
            style={{ background: "var(--le-bg-sunken)" }}
          >
            <tr>
              <th className="p-3">Title</th>
              <th>State</th>
              <th>Image</th>
              <th>Author</th>
              <th>Updated</th>
              <th>Cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>Loading…</td>
              </tr>
            ) : posts.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>No posts</td>
              </tr>
            ) : posts.map(p => (
              <tr key={p.id} className="border-t" style={{ borderColor: "var(--le-border)" }}>
                <td className="p-3">
                  <Link to={`/dashboard/blog/posts/${p.id}`} className="font-medium underline-offset-2 hover:underline">{p.title}</Link>
                </td>
                <td><StatusPill status={p.state} /></td>
                <td>{p.image ? <img src={thumbUrl(p.image.blob_url, { width: 120, quality: 65 })} loading="lazy" decoding="async" className="h-8 w-12 rounded-[8px] object-cover" alt="" /> : "—"}</td>
                <td>{p.author_label ?? "—"}</td>
                <td className="text-xs" style={{ color: "var(--le-text-muted)" }}>{new Date(p.updated_at).toLocaleString()}</td>
                <td className="text-xs">${(p.cost_usd_cents / 100).toFixed(2)}</td>
                <td>{p.external_post_url && <a href={p.external_post_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
