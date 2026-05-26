// src/pages/dashboard/EmailTemplateDetail.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createEmailTemplate, getEmailTemplate, updateEmailTemplate,
} from "@/lib/blog/api-client";
import EmailDesigner, { type EmailDesignerHandle } from "@/components/blog/EmailDesigner";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function EmailTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["email-template", id],
    queryFn: () => getEmailTemplate(id!),
    enabled: !isNew,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultSubject, setDefaultSubject] = useState("");
  const [defaultPreheader, setDefaultPreheader] = useState("");
  const [defaultFromName, setDefaultFromName] = useState("");
  const [defaultFromEmail, setDefaultFromEmail] = useState("");
  const [defaultAudience, setDefaultAudience] = useState("");

  // Design JSON + HTML are owned by the EmailDesigner; we export them on save.
  const [initialDesign, setInitialDesign] = useState<any>(null);
  const [initialHtml, setInitialHtml] = useState("");
  const designerRef = useRef<EmailDesignerHandle>(null);

  useEffect(() => {
    const tpl = data?.template;
    if (!tpl) return;
    setName(tpl.name);
    setDescription(tpl.description ?? "");
    setDefaultSubject(tpl.default_subject ?? "");
    setDefaultPreheader(tpl.default_preheader ?? "");
    setDefaultFromName(tpl.default_from_name ?? "");
    setDefaultFromEmail(tpl.default_from_email ?? "");
    setDefaultAudience(tpl.default_audience ?? "");
    setInitialDesign(tpl.design_json ?? null);
    setInitialHtml(tpl.body_html ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: async (args: { design: any; html: string }) => {
      const defaults = {
        default_subject: defaultSubject || null,
        default_preheader: defaultPreheader || null,
        default_from_name: defaultFromName || null,
        default_from_email: defaultFromEmail || null,
        default_audience: defaultAudience || null,
      };
      if (isNew) {
        return createEmailTemplate({
          name,
          description: description || null,
          design_json: args.design,
          body_html: args.html,
          ...defaults,
        });
      }
      await updateEmailTemplate(id!, {
        name,
        description: description || null,
        design_json: args.design,
        body_html: args.html,
        ...defaults,
      });
      return { id: id! };
    },
    onSuccess: (r) => {
      toast.success(isNew ? "Created" : "Saved");
      qc.invalidateQueries({ queryKey: ["email-templates"] });
      if (isNew) navigate(`/dashboard/studio/email/templates/${(r as any).id}`);
    },
    onError: (e: any) => toast.error(`Save failed: ${e?.message ?? e}`),
  });

  function handleSave() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!designerRef.current) {
      save.mutate({ design: null, html: "" });
      return;
    }
    designerRef.current.exportHtml((design, html) => {
      save.mutate({ design, html });
    });
  }

  if (!isNew && isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="flex h-[calc(100vh-72px)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b bg-background px-5 py-3 shrink-0">
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{isNew ? "New email template" : `Edit: ${name}`}</h1>
        </div>
        <Button variant="outline" onClick={() => navigate("/dashboard/studio/email/templates")}>Cancel</Button>
        <Button onClick={handleSave} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>

      {/* Body: fields on left, designer on right */}
      <div className="flex flex-1 min-h-0">
        {/* Metadata sidebar */}
        <div className="w-72 shrink-0 border-r bg-muted/10 overflow-y-auto p-4 space-y-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Template details</div>

          <div>
            <Label className="text-xs">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monthly newsletter" />
          </div>

          <div>
            <Label className="text-xs">Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When to use this template" rows={2} />
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="text-xs font-medium text-muted-foreground">Default fields (optional)</div>
            <p className="text-[11px] text-muted-foreground">
              Pre-fill these when the template is selected on a new email.
            </p>

            <div>
              <Label className="text-xs">Default subject</Label>
              <Input value={defaultSubject} onChange={(e) => setDefaultSubject(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Default preheader</Label>
              <Input value={defaultPreheader} onChange={(e) => setDefaultPreheader(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Default from name</Label>
              <Input value={defaultFromName} onChange={(e) => setDefaultFromName(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Default from email</Label>
              <Input value={defaultFromEmail} onChange={(e) => setDefaultFromEmail(e.target.value)} type="email" />
            </div>
            <div>
              <Label className="text-xs">Default audience</Label>
              <Input value={defaultAudience} onChange={(e) => setDefaultAudience(e.target.value)} placeholder="e.g. All, Buyers" />
            </div>
          </div>
        </div>

        {/* Designer */}
        <div className="flex-1 min-h-0">
          <EmailDesigner
            ref={designerRef}
            initialDesign={initialDesign}
            initialHtml={initialHtml}
            onSave={(design, html) => save.mutate({ design, html })}
          />
        </div>
      </div>
    </div>
  );
}
