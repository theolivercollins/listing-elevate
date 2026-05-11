import { useQuery } from "@tanstack/react-query";
import { getPost } from "@/lib/blog/api-client";

interface Props { postId: string; }

export function PublishHistoryPanel({ postId }: Props) {
  const { data } = useQuery({ queryKey: ["blog-post", postId], queryFn: () => getPost(postId) });
  const jobs = data?.jobs ?? [];
  if (jobs.length === 0) return null;
  return (
    <div className="mt-6 rounded-md border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">Publish history</h3>
      <ul className="space-y-1 text-xs">
        {jobs.map(j => (
          <li key={j.id} className="flex items-center gap-2">
            <span className="text-muted-foreground">{new Date(j.created_at).toLocaleString()}</span>
            <span className="font-mono">{j.kind}</span>
            <span className={j.state === "done" ? "text-green-600" : j.state === "failed" ? "text-red-600" : "text-muted-foreground"}>{j.state}</span>
            {j.last_error && <span className="text-red-500">— {j.last_error.slice(0, 80)}</span>}
            {j.replay_url && <a href={j.replay_url} target="_blank" rel="noreferrer" className="text-primary underline">replay ↗</a>}
          </li>
        ))}
      </ul>
    </div>
  );
}
