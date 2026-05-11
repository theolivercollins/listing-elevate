import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listPosts } from "@/lib/blog/api-client";
import { thumbUrl } from "@/lib/blog/image-url";
import type { BlogPostState } from "@/lib/blog/types";
import { Plus, ExternalLink } from "lucide-react";

const STATE_FILTERS: Array<{ label: string; value: BlogPostState | "all" }> = [
  { label: "All", value: "all" },
  { label: "Drafts", value: "awaiting_approval" },
  { label: "Live", value: "live" },
  { label: "Quarantined", value: "quarantined" },
];

export default function BlogPostsList() {
  const [state, setState] = useState<BlogPostState | "all">("all");
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["blog-posts-list", state, q],
    queryFn: () => listPosts({
      state: state === "all" ? undefined : state,
      q: q || undefined,
      limit: 100,
    }),
  });

  const posts = data?.posts ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Blog posts</h1>
        <Link to="/dashboard/blog/posts/new">
          <Button><Plus className="mr-1 h-4 w-4" /> New post</Button>
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATE_FILTERS.map(f => (
          <Button key={f.value} size="sm" variant={state === f.value ? "default" : "outline"} onClick={() => setState(f.value)}>
            {f.label}
          </Button>
        ))}
        <Input placeholder="Search title…" value={q} onChange={e => setQ(e.target.value)} className="max-w-xs" />
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs">
            <tr><th className="p-3">Title</th><th>State</th><th>Image</th><th>Author</th><th>Updated</th><th>Cost</th><th></th></tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
            ) : posts.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No posts</td></tr>
            ) : posts.map(p => (
              <tr key={p.id} className="border-t hover:bg-muted/20">
                <td className="p-3"><Link to={`/dashboard/blog/posts/${p.id}`} className="font-medium underline-offset-2 hover:underline">{p.title}</Link></td>
                <td><StatePill state={p.state} /></td>
                <td>{p.image ? <img src={thumbUrl(p.image.blob_url, { width: 120, quality: 65 })} loading="lazy" decoding="async" className="h-8 w-12 rounded object-cover" alt="" /> : "—"}</td>
                <td>{p.author_label ?? "—"}</td>
                <td className="text-xs text-muted-foreground">{new Date(p.updated_at).toLocaleString()}</td>
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

function StatePill({ state }: { state: BlogPostState }) {
  const color = state === "live" ? "bg-green-100 text-green-800" :
                state === "quarantined" ? "bg-red-100 text-red-800" :
                state === "awaiting_approval" ? "bg-amber-100 text-amber-800" :
                "bg-muted text-muted-foreground";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${color}`}>{state}</span>;
}
