// src/pages/dashboard/EmailsList.tsx
//
// Mirror of BlogPostsList.tsx structure — same page-heading, KPI strip,
// Card-wrapped table, tab pills with counts, custom v3-token dropdown,
// div-grid rows, and matching empty state. Visual parity is intentional
// so the Email tab feels like part of the same product as Blog.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listEmails,
  listPosts,
  deleteEmail,
  aiEmailFromPost,
  createEmail,
} from "@/lib/blog/api-client";
import type { EmailState } from "@/lib/blog/types";
import { PageHeading, KpiCard, Card } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { ListTabs } from "@/components/dashboard/ListTabs";
import { StatePill, EMAIL_STATE_PILL_MAP } from "@/components/dashboard/StatePill";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import React from "react";

// ─── constants ────────────────────────────────────────────────────────────────

const STATE_FILTERS: Array<{ label: string; value: EmailState | "all" }> = [
  { label: "All",    value: "all"    },
  { label: "Draft",  value: "draft"  },
  { label: "Ready",  value: "ready"  },
  { label: "Sent",   value: "sent"   },
  { label: "Failed", value: "failed" },
];

// ─── "New email" dropdown (native, v3 tokens — matches Blog's NewPostDropdown) ─

function NewEmailDropdown({
  navigate,
  onPickFromPost,
}: {
  navigate: ReturnType<typeof useNavigate>;
  onPickFromPost: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 16px",
          borderRadius: 12,
          border: "none",
          background: "var(--ink)",
          color: "var(--surface)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "var(--le-font-sans)",
        }}
      >
        <Icon name="plus" size={15} strokeWidth={2.2} />
        New email
        <Icon name="chevron-down" size={13} strokeWidth={2} />
      </button>

      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              zIndex: 50,
              minWidth: 280,
              background: "var(--surface)",
              borderRadius: 14,
              boxShadow: "0 20px 60px -16px rgba(11,18,32,0.22)",
              border: "1px solid rgba(15,24,60,0.06)",
              overflow: "hidden",
              fontFamily: "var(--le-font-sans)",
            }}
          >
            <DropItem
              icon="spark"
              label="Chat with Ally"
              sub="Build the email by talking to Ally"
              onClick={() => {
                setOpen(false);
                navigate("/dashboard/studio/email/messages/new?chat=1");
              }}
            />
            <DropItem
              icon="image"
              label="Visual builder"
              sub="Blank drag-and-drop editor"
              onClick={() => {
                setOpen(false);
                navigate("/dashboard/studio/email/messages/new");
              }}
            />
            <div style={{ height: 1, background: "rgba(15,24,60,0.05)", margin: "4px 0" }} />
            <DropItem
              icon="sparkles"
              label="New from blog post"
              sub="AI converts a post to an email"
              onClick={() => {
                setOpen(false);
                onPickFromPost();
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function DropItem({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  sub?: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 14px",
        background: hovered ? "rgba(15,24,60,0.03)" : "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--le-font-sans)",
        transition: "background .15s",
      }}
    >
      <div
        style={{
          marginTop: 1,
          width: 28,
          height: 28,
          borderRadius: 8,
          background: "rgba(15,24,60,0.04)",
          display: "grid",
          placeItems: "center",
          color: "var(--ink-2)",
          flexShrink: 0,
        }}
      >
        <Icon name={icon} size={14} strokeWidth={1.6} />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 1 }}>{sub}</div>}
      </div>
    </button>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function EmailsList() {
  const [activeState, setActiveState] = useState<EmailState | "all">("all");
  const [q, setQ] = useState("");
  const [postPickerOpen, setPostPickerOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["emails-list", activeState, q],
    queryFn: () =>
      listEmails({
        state: activeState === "all" ? undefined : activeState,
        q: q || undefined,
        limit: 100,
      }),
  });

  const emails = data?.emails ?? [];

  // KPI counts (always reflect ALL emails, not just current filter)
  const allEmails = data?.emails ?? [];
  const draftCount = allEmails.filter((e) => e.state === "draft").length;
  const sentCount = allEmails.filter((e) => e.state === "sent").length;
  const failedCount = allEmails.filter((e) => e.state === "failed").length;

  // Tab counts based on current filter
  const tabCounts: Record<EmailState | "all", number> = {
    all: emails.length,
    draft: emails.filter((e) => e.state === "draft").length,
    ready: emails.filter((e) => e.state === "ready").length,
    sending: emails.filter((e) => e.state === "sending").length,
    sent: emails.filter((e) => e.state === "sent").length,
    failed: emails.filter((e) => e.state === "failed").length,
  };

  const delEmail = useMutation({
    mutationFn: (id: string) => deleteEmail(id),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["emails-list"] });
    },
    onError: (e: any) => toast.error(`Delete failed: ${e?.message ?? e}`),
  });

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Page heading */}
      <PageHeading
        eyebrow="Content"
        title="Emails"
        sub="Compose, preview, and send marketing emails."
        actions={
          <NewEmailDropdown
            navigate={navigate}
            onPickFromPost={() => setPostPickerOpen(true)}
          />
        }
      />

      {/* KPI strip */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KpiCard label="Total emails" value={allEmails.length} />
        <KpiCard label="Drafts" value={draftCount} />
        <KpiCard label="Sent" value={sentCount} />
        <KpiCard label="Failed" value={failedCount} />
      </section>

      {/* Table card */}
      <Card padding={20}>
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          {/* Tab pills */}
          <ListTabs
            filters={STATE_FILTERS}
            active={activeState}
            counts={tabCounts}
            onChange={setActiveState}
          />

          <div style={{ flex: 1 }} />

          {/* Search */}
          <div
            className="le-card-flat"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              minWidth: 240,
            }}
          >
            <Icon name="search" size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
            <input
              placeholder="Search subject…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 12.5,
                fontFamily: "var(--le-font-sans)",
                color: "var(--ink)",
              }}
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--muted)",
                  lineHeight: 0,
                  padding: 0,
                }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Column header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 100px 120px 110px 80px 60px",
            gap: 12,
            padding: "8px 14px",
            borderBottom: "1px solid var(--line)",
            alignItems: "center",
          }}
        >
          <span className="le-d-label">Subject</span>
          <span className="le-d-label">State</span>
          <span className="le-d-label">Audience</span>
          <span className="le-d-label">Updated</span>
          <span className="le-d-label" style={{ textAlign: "right" }}>Cost</span>
          <span />
        </div>

        {/* Body */}
        {isLoading ? (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Loading…
          </div>
        ) : isError ? (
          <div style={{ padding: "48px 0", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "var(--bad)" }}>
              Failed to load emails: {(error as any)?.message ?? String(error)}
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "var(--muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
                fontFamily: "var(--le-font-sans)",
              }}
            >
              Retry
            </button>
          </div>
        ) : emails.length === 0 ? (
          <div style={{ padding: "56px 0", textAlign: "center" }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "rgba(15,24,60,0.04)",
                display: "grid",
                placeItems: "center",
                color: "var(--muted)",
                margin: "0 auto 14px",
              }}
            >
              <Icon name="delivered" size={20} strokeWidth={1.4} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
              {activeState === "all" && !q ? "No emails yet" : "No emails match your filters"}
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 360, margin: "0 auto" }}>
              {activeState === "all" && !q ? (
                "Click New email to start composing your first email."
              ) : (
                <>
                  {activeState !== "all" && (
                    <span>
                      State: <strong>{activeState}</strong>.{" "}
                    </span>
                  )}
                  {q && <span>Subject contains "{q}". </span>}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveState("all");
                      setQ("");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--accent)",
                      fontSize: 13,
                      fontFamily: "var(--le-font-sans)",
                      textDecoration: "underline",
                    }}
                  >
                    Clear filters
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          emails.map((e) => (
            <EmailRow
              key={e.id}
              e={e}
              onDelete={() => {
                if (!window.confirm("Delete this email?")) return;
                delEmail.mutate(e.id);
              }}
              navigate={navigate}
            />
          ))
        )}
      </Card>

      <PostPickerDialog
        open={postPickerOpen}
        onClose={() => setPostPickerOpen(false)}
        onSuccess={(emailId) => navigate(`/dashboard/studio/email/messages/${emailId}`)}
      />
    </div>
  );
}

// ─── EmailRow ────────────────────────────────────────────────────────────────

function EmailRow({
  e,
  onDelete,
  navigate,
}: {
  e: any;
  onDelete: () => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => navigate(`/dashboard/studio/email/messages/${e.id}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 100px 120px 110px 80px 60px",
        gap: 12,
        padding: "12px 14px",
        borderBottom: "1px solid rgba(15,24,60,0.04)",
        alignItems: "center",
        cursor: "pointer",
        background: hovered ? "rgba(15,24,60,0.02)" : "transparent",
        transition: "background .15s",
      }}
    >
      {/* Subject */}
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {e.subject || <span style={{ color: "var(--muted)", fontStyle: "italic" }}>Untitled</span>}
        </div>
        {e.source_post_id && (
          <span
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 999,
              background: "rgba(15,24,60,0.05)",
              color: "var(--muted)",
              flexShrink: 0,
            }}
          >
            from post
          </span>
        )}
      </div>

      {/* State */}
      <div><StatePill state={e.state} map={EMAIL_STATE_PILL_MAP} /></div>

      {/* Audience */}
      <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {e.audience ?? "—"}
      </div>

      {/* Updated */}
      <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
        {new Date(e.updated_at).toLocaleDateString()}
      </div>

      {/* Cost */}
      <div style={{ fontSize: 12, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
        ${(e.cost_usd_cents / 100).toFixed(2)}
      </div>

      {/* Actions */}
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}
        onClick={(ev) => ev.stopPropagation()}
      >
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete email"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--muted)",
            display: "grid",
            placeItems: "center",
            padding: 4,
            borderRadius: 6,
          }}
          onMouseEnter={(ev) => (ev.currentTarget.style.color = "var(--bad)")}
          onMouseLeave={(ev) => (ev.currentTarget.style.color = "var(--muted)")}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Post picker dialog (unchanged from prior — keeps the AI-from-post flow) ──

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
            <Icon name="sparkles" size={16} /> Convert blog post to email
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
            <button
              type="button"
              onClick={onClose}
              disabled={convert.isPending}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "1px solid rgba(15,24,60,0.08)",
                background: "rgba(255,255,255,0.6)",
                color: "var(--ink-2)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "var(--le-font-sans)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => convert.mutate()}
              disabled={!selectedPostId || convert.isPending}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 12,
                border: "none",
                background: "var(--ink)",
                color: "var(--surface)",
                fontSize: 13,
                fontWeight: 600,
                cursor: !selectedPostId || convert.isPending ? "not-allowed" : "pointer",
                opacity: !selectedPostId || convert.isPending ? 0.5 : 1,
                fontFamily: "var(--le-font-sans)",
              }}
            >
              {convert.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Icon name="sparkles" size={13} />}
              Convert to email
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
