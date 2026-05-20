// src/pages/dashboard/EmailDetail.tsx
//
// Handles both /dashboard/blog/emails/new AND /dashboard/blog/emails/:id.
// ?chat=1 on /new routes to EmailChatCompose instead.

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  createEmail, getEmail, updateEmail, sendEmail, testSendEmail, listEmailTemplates,
} from "@/lib/blog/api-client";
import type { UpdateEmailInput } from "@/lib/blog/types";
import EmailDesigner, { type EmailDesignerHandle } from "@/components/blog/EmailDesigner";
import { AllyEmailFloatingChat } from "@/components/blog/AllyEmailFloatingChat";
import EmailChatCompose from "./EmailChatCompose";
import { toast } from "sonner";
import { FlaskConical, Loader2, Mail, Send } from "lucide-react";

interface FormState {
  subject: string;
  preheader: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  audience: string;
  recipients: string; // newline-separated
  template_id: string;
}

const emptyForm: FormState = {
  subject: "", preheader: "", from_name: "", from_email: "",
  reply_to: "", audience: "", recipients: "", template_id: "",
};

export default function EmailDetail() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // /emails/new?chat=1 → dedicated chat-compose page
  if (isNew && searchParams.get("chat") === "1") {
    return <EmailChatCompose />;
  }

  const [form, setForm] = useState<FormState>(emptyForm);
  const [designJson, setDesignJson] = useState<any>(null);
  const [bodyHtml, setBodyHtml] = useState("");
  const [activeTab, setActiveTab] = useState<"builder" | "ally">("builder");
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);

  const designerRef = useRef<EmailDesignerHandle>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["email-detail", id],
    queryFn: () => getEmail(id!),
    enabled: !isNew,
  });

  const { data: tplData } = useQuery({
    queryKey: ["email-templates"],
    queryFn: () => listEmailTemplates(),
  });
  const templates = tplData?.templates ?? [];

  // Hydrate form from loaded email
  useEffect(() => {
    const email = data?.email;
    if (!email) return;
    setForm({
      subject: email.subject ?? "",
      preheader: email.preheader ?? "",
      from_name: email.from_name ?? "",
      from_email: email.from_email ?? "",
      reply_to: email.reply_to ?? "",
      audience: email.audience ?? "",
      recipients: (email.recipients_json ?? []).join("\n"),
      template_id: email.template_id ?? "",
    });
    setDesignJson(email.design_json ?? null);
    setBodyHtml(email.body_html ?? "");
  }, [data]);

  // Build UpdateEmailInput from form
  function buildPatch(): UpdateEmailInput {
    return {
      subject: form.subject || undefined,
      preheader: form.preheader || null,
      from_name: form.from_name || null,
      from_email: form.from_email || null,
      reply_to: form.reply_to || null,
      audience: form.audience || null,
      recipients_json: form.recipients ? form.recipients.split("\n").map((e) => e.trim()).filter(Boolean) : [],
      design_json: designJson,
      body_html: bodyHtml || undefined,
    };
  }

  const saveNew = useMutation({
    mutationFn: () => createEmail({
      ...buildPatch(),
      authored: "manual",
      initial_state: "draft",
    }),
    onSuccess: (r) => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["emails-list"] });
      navigate(`/dashboard/blog/emails/${r.id}`);
    },
    onError: (e: any) => toast.error(`Save failed: ${e?.message ?? e}`),
  });

  const saveEdit = useMutation({
    mutationFn: () => updateEmail(id!, buildPatch()),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["email-detail", id] });
    },
    onError: (e: any) => toast.error(`Save failed: ${e?.message ?? e}`),
  });

  const doTestSend = useMutation({
    mutationFn: () => testSendEmail(id!, testEmail),
    onSuccess: () => { toast.success(`Test sent to ${testEmail}`); setTestDialogOpen(false); },
    onError: (e: any) => toast.error(`Test send failed: ${e?.message ?? e}`),
  });

  const doSend = useMutation({
    mutationFn: () => sendEmail(id!),
    onSuccess: () => {
      toast.success("Sending…");
      setSendConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["email-detail", id] });
      qc.invalidateQueries({ queryKey: ["emails-list"] });
    },
    onError: (e: any) => toast.error(`Send failed: ${e?.message ?? e}`),
  });

  // Export HTML from designer before saving
  function handleSave() {
    if (!designerRef.current) {
      isNew ? saveNew.mutate() : saveEdit.mutate();
      return;
    }
    designerRef.current.exportHtml((design, html) => {
      setDesignJson(design);
      setBodyHtml(html);
      // After setting state, trigger save on next tick
      setTimeout(() => isNew ? saveNew.mutate() : saveEdit.mutate(), 0);
    });
  }

  function applyAllyPatch(patch: Partial<{ subject: string; preheader: string; body_html: string; from_name: string; from_email: string; audience: string }>) {
    setForm((f) => ({
      ...f,
      subject: patch.subject !== undefined ? patch.subject : f.subject,
      preheader: patch.preheader !== undefined ? patch.preheader : f.preheader,
      from_name: patch.from_name !== undefined ? patch.from_name : f.from_name,
      from_email: patch.from_email !== undefined ? patch.from_email : f.from_email,
      audience: patch.audience !== undefined ? patch.audience : f.audience,
    }));
    if (patch.body_html) setBodyHtml(patch.body_html);
  }

  if (!isNew && isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const email = data?.email;
  const isSent = email?.state === "sent" || email?.state === "sending";

  return (
    <div className="flex h-[calc(100vh-72px)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b bg-background px-5 py-3 shrink-0">
        <div className="flex-1">
          <h1 className="text-lg font-semibold">
            {isNew ? "New email" : form.subject || "Email"}
          </h1>
          {email && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <EmailStatePill state={email.state} />
              {email.sent_at && <span>Sent {new Date(email.sent_at).toLocaleString()}</span>}
              {email.source_post_id && (
                <a
                  href={`/dashboard/blog/posts/${email.source_post_id}`}
                  className="underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Source post
                </a>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSave} disabled={saveNew.isPending || saveEdit.isPending}>
            {(saveNew.isPending || saveEdit.isPending) && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
          {!isNew && !isSent && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTestDialogOpen(true)}
            >
              <FlaskConical className="mr-1 h-3.5 w-3.5" /> Send test
            </Button>
          )}
          {!isNew && !isSent && (
            <Button
              size="sm"
              onClick={() => setSendConfirmOpen(true)}
              disabled={doSend.isPending}
            >
              <Send className="mr-1 h-3.5 w-3.5" /> Send
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Visual builder or Ally tab */}
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Tab bar */}
          <div className="flex gap-0 border-b shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab("builder")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "builder" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Visual Builder
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ally")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "ally" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Ally Chat
            </button>
          </div>

          {activeTab === "builder" ? (
            <div className="flex-1 min-h-0">
              <EmailDesigner
                ref={designerRef}
                initialDesign={designJson}
                initialHtml={bodyHtml}
                onSave={(design, html) => {
                  setDesignJson(design);
                  setBodyHtml(html);
                }}
                onTestSend={!isNew && !isSent ? () => setTestDialogOpen(true) : undefined}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6">
              <p className="text-sm text-muted-foreground mb-4">
                Chat with Ally to improve this email. Changes are proposals — click Apply to accept them, then Save to persist.
              </p>
              {!isNew && (
                <p className="text-xs text-muted-foreground">
                  Use the floating Ally button (bottom right) to chat inline while viewing the builder.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Metadata sidebar */}
        <div className="w-72 shrink-0 border-l bg-muted/10 overflow-y-auto">
          <div className="p-4 space-y-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email details</div>

            <div>
              <Label className="text-xs">Subject</Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="Your subject line"
              />
            </div>

            <div>
              <Label className="text-xs">Preheader</Label>
              <Input
                value={form.preheader}
                onChange={(e) => setForm({ ...form, preheader: e.target.value })}
                placeholder="Preview text after subject…"
              />
            </div>

            <div>
              <Label className="text-xs">From name</Label>
              <Input
                value={form.from_name}
                onChange={(e) => setForm({ ...form, from_name: e.target.value })}
                placeholder="Listing Elevate"
              />
            </div>

            <div>
              <Label className="text-xs">From email</Label>
              <Input
                value={form.from_email}
                onChange={(e) => setForm({ ...form, from_email: e.target.value })}
                placeholder="hello@example.com"
                type="email"
              />
            </div>

            <div>
              <Label className="text-xs">Reply-to</Label>
              <Input
                value={form.reply_to}
                onChange={(e) => setForm({ ...form, reply_to: e.target.value })}
                placeholder="optional"
                type="email"
              />
            </div>

            <div>
              <Label className="text-xs">Audience</Label>
              <Input
                value={form.audience}
                onChange={(e) => setForm({ ...form, audience: e.target.value })}
                placeholder="e.g. Buyers, Sellers, All"
              />
            </div>

            <div>
              <Label className="text-xs">Recipients (one per line)</Label>
              <Textarea
                value={form.recipients}
                onChange={(e) => setForm({ ...form, recipients: e.target.value })}
                placeholder="email@example.com"
                rows={4}
                className="font-mono text-xs"
              />
            </div>

            {templates.length > 0 && (
              <div>
                <Label className="text-xs">Template</Label>
                <select
                  value={form.template_id}
                  onChange={(e) => setForm({ ...form, template_id: e.target.value })}
                  className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">— None —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}

            {email?.cost_usd_cents !== undefined && email.cost_usd_cents > 0 && (
              <div className="text-xs text-muted-foreground">
                Cost: ${(email.cost_usd_cents / 100).toFixed(3)}
              </div>
            )}

            {email?.send_error && (
              <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">
                Send error: {email.send_error}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Ally floating chat — only on existing emails */}
      {!isNew && (
        <AllyEmailFloatingChat
          emailId={id!}
          currentBodyHtml={bodyHtml}
          current={{
            subject: form.subject,
            preheader: form.preheader,
            from_name: form.from_name,
            from_email: form.from_email,
            audience: form.audience,
          }}
          onApply={applyAllyPatch}
          sourcePostId={email?.source_post_id ?? null}
          contextLabel={isSent ? "Sent email — view only" : "Editing draft email"}
        />
      )}

      {/* Test send dialog */}
      <Dialog open={testDialogOpen} onOpenChange={(v) => { if (!v) setTestDialogOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-primary" /> Send test email
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">Send to</Label>
              <Input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTestDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => doTestSend.mutate()}
                disabled={!testEmail || doTestSend.isPending}
              >
                {doTestSend.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Send test
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send confirm dialog */}
      <Dialog open={sendConfirmOpen} onOpenChange={(v) => { if (!v) setSendConfirmOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" /> Send this email?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will send to all recipients immediately. This action cannot be undone.
            </p>
            {form.subject && (
              <div className="rounded bg-muted p-3 text-sm">
                <span className="font-medium">Subject:</span> {form.subject}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSendConfirmOpen(false)}>Cancel</Button>
              <Button
                onClick={() => doSend.mutate()}
                disabled={doSend.isPending}
              >
                {doSend.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                Send now
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmailStatePill({ state }: { state: string }) {
  const color =
    state === "sent" ? "bg-green-100 text-green-800" :
    state === "failed" ? "bg-red-100 text-red-800" :
    state === "ready" ? "bg-blue-100 text-blue-800" :
    state === "sending" ? "bg-amber-100 text-amber-800" :
    "bg-muted text-muted-foreground";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${color}`}>{state}</span>;
}
