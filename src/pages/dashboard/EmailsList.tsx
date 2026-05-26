// src/pages/dashboard/EmailsList.tsx
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listEmails, listPosts, deleteEmail, aiEmailFromPost, createEmail,
} from "@/lib/blog/api-client";
import type { EmailState } from "@/lib/blog/types";
import {
  ChevronDown, Loader2, Mail, MessageSquare, Plus, Sparkles, Trash2,
} from "lucide-react";
import { toast } from "sonner";

const STATE_FILTERS: Array<{ label: string; value: EmailState | "all" }> = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Ready", value: "ready" },
  { label: "Sent", value: "sent" },
  { label: "Failed", value: "failed" },
];

export default function EmailsList() {
  const [state, setState] = useState<EmailState | "all">("all");
  const [q, setQ] = useState("");
  const [postPickerOpen, setPostPickerOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["emails-list", state, q],
    queryFn: () => listEmails({
      state: state === "all" ? undefined : state,
      q: q || undefined,
      limit: 100,
    }),
  });

  const emails = data?.emails ?? [];

  const delEmail = useMutation({
    mutationFn: (id: string) => deleteEmail(id),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["emails-list"] });
    },
    onError: (e: any) => toast.error(`Delete failed: ${e?.message ?? e}`),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Emails</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <Plus className="mr-1 h-4 w-4" /> New email
              <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem
              onClick={() => navigate("/dashboard/studio/email/messages/new?chat=1")}
              className="cursor-pointer"
            >
              <MessageSquare className="mr-2 h-4 w-4" />
              <div className="flex flex-col">
                <span>Chat with Ally</span>
                <span className="text-xs text-muted-foreground">Build the email by talking to Ally</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigate("/dashboard/studio/email/messages/new")}
              className="cursor-pointer"
            >
              <Mail className="mr-2 h-4 w-4" />
              <div className="flex flex-col">
                <span>Visual builder</span>
                <span className="text-xs text-muted-foreground">Blank drag-and-drop editor</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setPostPickerOpen(true)}
              className="cursor-pointer"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              <div className="flex flex-col">
                <span>New from blog post</span>
                <span className="text-xs text-muted-foreground">AI converts a post to an email</span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav
          className="inline-flex items-center gap-1 rounded-full bg-muted/40 p-1"
          aria-label="Email state filter"
        >
          {STATE_FILTERS.map((f) => {
            const active = state === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setState(f.value)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </nav>
        <Input
          placeholder="Search subject…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {!isLoading && !isError && emails.length === 0 && state === "all" && !q ? (
        <EmptyState
          onChat={() => navigate("/dashboard/studio/email/messages/new?chat=1")}
          onBlank={() => navigate("/dashboard/studio/email/messages/new")}
          onFromPost={() => setPostPickerOpen(true)}
        />
      ) : (
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs">
            <tr>
              <th className="p-3">Subject</th>
              <th>State</th>
              <th>Audience</th>
              <th>Updated</th>
              <th>Cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
            ) : isError ? (
              <tr><td colSpan={6} className="p-4 text-center">
                <div className="text-sm text-destructive">Failed to load: {(error as any)?.message ?? String(error)}</div>
                <button onClick={() => refetch()} className="mt-2 text-xs underline text-muted-foreground">Retry</button>
              </td></tr>
            ) : emails.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">
                No emails match the current filter. <button onClick={() => { setState("all"); setQ(""); }} className="underline">Clear filters</button>.
              </td></tr>
            ) : emails.map((e) => (
              <tr key={e.id} className="border-t hover:bg-muted/20">
                <td className="p-3">
                  <Link to={`/dashboard/studio/email/messages/${e.id}`} className="font-medium underline-offset-2 hover:underline">
                    {e.subject || <span className="italic text-muted-foreground">Untitled</span>}
                  </Link>
                  {e.source_post_id && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">from post</span>
                  )}
                </td>
                <td><EmailStatePill state={e.state} /></td>
                <td className="text-xs text-muted-foreground">{e.audience ?? "—"}</td>
                <td className="text-xs text-muted-foreground">{new Date(e.updated_at).toLocaleString()}</td>
                <td className="text-xs">${(e.cost_usd_cents / 100).toFixed(2)}</td>
                <td className="pr-3">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm("Delete this email?")) return;
                        delEmail.mutate(e.id);
                      }}
                      aria-label="Delete email"
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
      )}

      <PostPickerDialog
        open={postPickerOpen}
        onClose={() => setPostPickerOpen(false)}
        onSuccess={(emailId) => navigate(`/dashboard/studio/email/messages/${emailId}`)}
      />
    </div>
  );
}

function EmptyState({
  onChat,
  onBlank,
  onFromPost,
}: {
  onChat: () => void;
  onBlank: () => void;
  onFromPost: () => void;
}) {
  const cards = [
    {
      title: "Chat with Ally",
      sub: "Tell Ally what you want to say. She drafts the subject, preheader, body, and audience.",
      icon: MessageSquare,
      onClick: onChat,
      cta: "Start a chat",
    },
    {
      title: "Visual builder",
      sub: "Drag-and-drop on a blank canvas. Native blocks, MJML output, brand-styled.",
      icon: Mail,
      onClick: onBlank,
      cta: "Open builder",
    },
    {
      title: "From a blog post",
      sub: "Pick a recent post and Ally converts it to a matching email.",
      icon: Sparkles,
      onClick: onFromPost,
      cta: "Pick a post",
    },
  ];
  return (
    <div className="rounded-2xl border bg-background/50 px-6 py-12">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
          <Mail className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">No emails yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick how you want to start your first email.
        </p>
      </div>
      <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.title}
              type="button"
              onClick={c.onClick}
              className="group flex flex-col rounded-xl border bg-background p-4 text-left transition-all hover:border-foreground/30 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
            >
              <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60 transition-colors group-hover:bg-foreground group-hover:text-background">
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-sm font-semibold">{c.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.sub}</div>
              <div className="mt-3 text-xs font-medium text-foreground/80 group-hover:text-foreground">
                {c.cta} →
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmailStatePill({ state }: { state: EmailState }) {
  const color =
    state === "sent" ? "bg-green-100 text-green-800" :
    state === "failed" ? "bg-red-100 text-red-800" :
    state === "ready" ? "bg-blue-100 text-blue-800" :
    state === "sending" ? "bg-amber-100 text-amber-800" :
    "bg-muted text-muted-foreground";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${color}`}>{state}</span>;
}

// ---------------------------------------------------------------------------
// Post picker dialog — pick a recent post and convert it to an email via AI.
// ---------------------------------------------------------------------------
interface PostPickerProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (emailId: string) => void;
}

function PostPickerDialog({ open, onClose, onSuccess }: PostPickerProps) {
  const [selectedPostId, setSelectedPostId] = useState("");

  const { data } = useQuery({
    queryKey: ["blog-posts-list-picker"],
    queryFn: () => listPosts({ limit: 30 }),
    enabled: open,
  });
  const posts = data?.posts ?? [];

  const convert = useMutation({
    mutationFn: async () => {
      if (!selectedPostId) throw new Error("Pick a post first");
      const result = await aiEmailFromPost(selectedPostId);
      const { id } = await createEmail({
        subject: result.subject,
        preheader: result.preheader,
        body_html: result.body_html,
        from_name: result.from_name,
        from_email: result.from_email,
        audience: result.audience,
        source_post_id: selectedPostId,
        authored: "auto",
        initial_state: "draft",
      });
      return id;
    },
    onSuccess: (emailId) => {
      toast.success("Email created from post");
      onClose();
      onSuccess(emailId);
    },
    onError: (e: any) => toast.error(`Conversion failed: ${e?.message ?? e}`),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Convert blog post to email
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Ally will read the selected post and draft a matching email — subject, preheader, body, and audience.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium">Select a post</label>
            <select
              value={selectedPostId}
              onChange={(e) => setSelectedPostId(e.target.value)}
              className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">— Choose a post —</option>
              {posts.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={convert.isPending}>Cancel</Button>
            <Button
              onClick={() => convert.mutate()}
              disabled={!selectedPostId || convert.isPending}
            >
              {convert.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
              Convert to email
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
