import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deletePost } from "@/lib/blog/api-client";

interface Props {
  open: boolean;
  onClose: () => void;
  postId: string | null;
  postTitle: string;
  /** True if the post was published on Sierra (has an external_post_id). */
  hasSierraCopy: boolean;
  /** Called after the mutation lands. Use to refresh queries or navigate. */
  onSuccess?: () => void;
}

export function DeletePostDialog({
  open, onClose, postId, postTitle, hasSierraCopy, onSuccess,
}: Props) {
  const [fromDashboard, setFromDashboard] = useState(true);
  const [fromSierra, setFromSierra] = useState(false);

  useEffect(() => {
    if (open) {
      setFromDashboard(true);
      setFromSierra(false);
    }
  }, [open]);

  const del = useMutation({
    mutationFn: () => {
      if (!postId) throw new Error("no post id");
      return deletePost(postId, { fromDashboard, fromSierra });
    },
    onSuccess: (r) => {
      const parts: string[] = [];
      if (fromDashboard) parts.push("removed from dashboard");
      if (fromSierra) parts.push("queued Sierra removal (≤60s)");
      toast.success(parts.join(" · ") || "Done");
      onClose();
      onSuccess?.();
    },
    onError: (e: any) => toast.error(`Delete failed: ${e.message}`),
  });

  const canConfirm = fromDashboard || fromSierra;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" /> Delete post
          </DialogTitle>
          <DialogDescription>
            Choose where to remove <span className="font-medium">{postTitle || "this post"}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <label className="flex items-start gap-3 rounded-md border p-3 hover:bg-muted/30">
            <Checkbox
              checked={fromDashboard}
              onCheckedChange={(v) => setFromDashboard(v === true)}
              disabled={del.isPending}
              className="mt-0.5"
            />
            <div className="space-y-0.5 text-sm">
              <div className="font-medium">Remove from this dashboard</div>
              <div className="text-xs text-muted-foreground">
                Hides it from the Listing Elevate dashboard. The published copy on Sierra is untouched unless you also tick below.
              </div>
            </div>
          </label>

          <label className={`flex items-start gap-3 rounded-md border p-3 ${hasSierraCopy ? "hover:bg-muted/30" : "opacity-60"}`}>
            <Checkbox
              checked={fromSierra}
              onCheckedChange={(v) => setFromSierra(v === true)}
              disabled={!hasSierraCopy || del.isPending}
              className="mt-0.5"
            />
            <div className="space-y-0.5 text-sm">
              <div className="font-medium">Remove from Sierra (public site)</div>
              <div className="text-xs text-muted-foreground">
                {hasSierraCopy
                  ? "Queues a Browserbase job that opens /blog-manager.aspx and deletes the row. Cron picks it up within ~60s."
                  : "Not published to Sierra yet — nothing to remove there."}
              </div>
            </div>
          </label>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={del.isPending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => del.mutate()}
            disabled={!canConfirm || del.isPending}
          >
            {del.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {del.isPending ? "Deleting…" : "Confirm delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
