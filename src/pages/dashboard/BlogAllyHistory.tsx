import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Trash2, ArrowRight, Sparkles, Search } from "lucide-react";
import { listPosts } from "@/lib/blog/api-client";
import { listAllPersisted, clearPersisted, type PersistedChatEntry } from "@/components/blog/ally-storage";
import { toast } from "sonner";

/**
 * Browse every Ally conversation you've had, across all posts. Each card
 * shows the post title, last message, proposal count, cost, and last
 * activity. Clicking a card jumps to the post; the floating chat resumes
 * the conversation automatically from localStorage.
 */
export default function BlogAllyHistory() {
  const [reloadTick, setReloadTick] = useState(0);
  const [q, setQ] = useState("");

  // localStorage is synchronous — read fresh on every reloadTick.
  const entries = useMemo(() => listAllPersisted(), [reloadTick]);

  // Resolve post titles via the listing endpoint. We could call getPost per id
  // but a single listPosts(limit=200) is cheaper and gives us the latest title
  // + state for each chat.
  const { data: postsData } = useQuery({
    queryKey: ["blog-posts-for-history"],
    queryFn: () => listPosts({ limit: 200 }),
  });
  const postById = useMemo(() => {
    const map = new Map<string, { title: string; state: string; updated_at: string }>();
    for (const p of postsData?.posts ?? []) {
      map.set(p.id, { title: p.title, state: p.state, updated_at: p.updated_at });
    }
    return map;
  }, [postsData]);

  const filtered = useMemo(() => {
    if (!q.trim()) return entries;
    const needle = q.toLowerCase();
    return entries.filter((e) => {
      const post = postById.get(e.postId);
      const blob = [
        post?.title ?? "",
        e.postId,
        e.data.messages.map((m) => m.content).join(" "),
      ].join(" ").toLowerCase();
      return blob.includes(needle);
    });
  }, [entries, postById, q]);

  function onDelete(entry: PersistedChatEntry) {
    const post = postById.get(entry.postId);
    if (!window.confirm(`Delete Ally's conversation about "${post?.title ?? entry.postId}"? The post itself isn't affected.`)) return;
    clearPersisted(entry.postId);
    setReloadTick((t) => t + 1);
    toast.success("Conversation deleted");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <MessageSquare className="h-5 w-5 text-primary" /> Ally history
          </h1>
          <p className="text-sm text-muted-foreground">
            Every conversation you've had with Ally, scoped to its post. Jump back to keep working — Ally remembers where you left off.
          </p>
        </div>
        <div className="ml-auto">
          <Link to="/dashboard/blog/posts">
            <Button variant="outline" size="sm">All posts</Button>
          </Link>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by post title or chat content…"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border bg-muted/20 p-12 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-3 text-sm font-medium">
            {entries.length === 0 ? "No Ally conversations yet" : "No chats match your search"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {entries.length === 0
              ? "Open any blog post and click 'Improve with Ally' to start one."
              : "Try clearing the search box."}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((entry) => {
            const post = postById.get(entry.postId);
            const lastMsg = [...entry.data.messages].reverse().find((m) => m.content?.trim());
            const proposals = entry.data.proposals?.length ?? 0;
            const cost = (entry.data.totalCostCents ?? 0) / 100;
            const updated = entry.data.updatedAt ? new Date(entry.data.updatedAt) : null;
            return (
              <div key={entry.postId} className="group rounded-md border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <Link
                    to={`/dashboard/blog/posts/${entry.postId}`}
                    className="line-clamp-1 flex-1 font-medium hover:underline"
                  >
                    {post?.title ?? <span className="text-muted-foreground">Deleted post · {entry.postId.slice(0, 8)}…</span>}
                  </Link>
                  <button
                    type="button"
                    onClick={() => onDelete(entry)}
                    className="invisible rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:visible"
                    aria-label="Delete this conversation"
                    title="Delete this conversation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  {post?.state && <span className="rounded bg-muted px-1.5 py-0.5">{post.state}</span>}
                  <span>{entry.data.messages.length} messages</span>
                  {proposals > 0 && <span>· {proposals} proposal{proposals === 1 ? "" : "s"}</span>}
                  {cost > 0 && <span>· ${cost.toFixed(3)}</span>}
                  {updated && <span className="ml-auto">{updated.toLocaleString()}</span>}
                </div>
                {lastMsg && (
                  <div className="line-clamp-2 rounded bg-muted/30 px-2.5 py-1.5 text-xs text-foreground/80">
                    <span className="font-medium">{lastMsg.role === "user" ? "You" : "Ally"}:</span> {lastMsg.content}
                  </div>
                )}
                <div className="mt-3 flex justify-end">
                  <Link to={`/dashboard/blog/posts/${entry.postId}`}>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      Resume <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
