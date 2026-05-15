import { useState, useEffect, useRef, type CSSProperties, type ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { StudioNav } from '@/components/studio/StudioNav';
import { uploadSingleFile, getStoragePublicUrl } from '@/lib/photo-upload';
import '@/v2/styles/v2.css';

const EYEBROW: CSSProperties = {
  fontFamily: 'var(--le-font-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)',
};

const PAGE_H1: CSSProperties = {
  fontFamily: 'var(--le-font-sans)',
  fontSize: 'clamp(24px, 3.5vw, 38px)',
  fontWeight: 500,
  letterSpacing: '-0.035em',
  lineHeight: 0.98,
  color: '#fff',
  margin: 0,
};

const SECTION_HEADER: CSSProperties = {
  fontFamily: 'var(--le-font-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)',
  paddingBottom: 12,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  display: 'block',
  marginBottom: 20,
};

interface ClientFormState {
  name: string;
  contact_email: string;
  phone: string;
  monthly_rate_dollars: string;
  notes: string;
  brand_logo_url: string;
  brand_primary_hex: string;
  brand_secondary_hex: string;
  agent_name: string;
  agent_headshot_url: string;
  voice_id: string;
}

const EMPTY_FORM: ClientFormState = {
  name: '',
  contact_email: '',
  phone: '',
  monthly_rate_dollars: '',
  notes: '',
  brand_logo_url: '',
  brand_primary_hex: '#000000',
  brand_secondary_hex: '#ffffff',
  agent_name: '',
  agent_headshot_url: '',
  voice_id: '',
};

function centsFromDollars(dollars: string): number | null {
  const n = parseFloat(dollars);
  if (isNaN(n)) return null;
  return Math.round(n * 100);
}

const ClientEdit = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [form, setForm] = useState<ClientFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // File upload state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [headshotFile, setHeadshotFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [headshotPreview, setHeadshotPreview] = useState<string | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const headshotInputRef = useRef<HTMLInputElement>(null);

  // Temp ID for file uploads before the row is saved (create flow)
  const tempIdRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/studio/clients/${id}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        const c = data.client;
        if (!cancelled) {
          setForm({
            name: c.name ?? '',
            contact_email: c.contact_email ?? '',
            phone: c.phone ?? '',
            monthly_rate_dollars:
              c.monthly_rate_cents != null
                ? String(Math.round(c.monthly_rate_cents / 100))
                : '',
            notes: c.notes ?? '',
            brand_logo_url: c.brand_logo_url ?? '',
            brand_primary_hex: c.brand_primary_hex ?? '#000000',
            brand_secondary_hex: c.brand_secondary_hex ?? '#ffffff',
            agent_name: c.agent_name ?? '',
            agent_headshot_url: c.agent_headshot_url ?? '',
            voice_id: c.voice_id ?? '',
          });
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load client');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id, isNew]);

  const setField = (field: keyof ClientFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleLogoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const url = URL.createObjectURL(file);
    setLogoPreview(url);
  };

  const handleHeadshotChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setHeadshotFile(file);
    const url = URL.createObjectURL(file);
    setHeadshotPreview(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      // Upload any pending files first
      let logoUrl = form.brand_logo_url;
      let headshotUrl = form.agent_headshot_url;

      const uploadPrefix = isNew ? tempIdRef.current : id!;

      setUploadingFiles(true);
      if (logoFile) {
        const ext = logoFile.name.split('.').pop() ?? 'png';
        const path = `clients/${uploadPrefix}/logo.${ext}`;
        await uploadSingleFile(logoFile, path);
        logoUrl = getStoragePublicUrl(path);
      }
      if (headshotFile) {
        const ext = headshotFile.name.split('.').pop() ?? 'jpg';
        const path = `clients/${uploadPrefix}/headshot.${ext}`;
        await uploadSingleFile(headshotFile, path);
        headshotUrl = getStoragePublicUrl(path);
      }
      setUploadingFiles(false);

      const payload = {
        name: form.name.trim(),
        contact_email: form.contact_email.trim() || null,
        phone: form.phone.trim() || null,
        monthly_rate_cents: centsFromDollars(form.monthly_rate_dollars),
        notes: form.notes.trim() || null,
        brand_logo_url: logoUrl || null,
        brand_primary_hex: form.brand_primary_hex || null,
        brand_secondary_hex: form.brand_secondary_hex || null,
        agent_name: form.agent_name.trim() || null,
        agent_headshot_url: headshotUrl || null,
        voice_id: form.voice_id.trim() || null,
      };

      const url = isNew ? '/api/admin/studio/clients' : `/api/admin/studio/clients/${id}`;
      const method = isNew ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `${res.status} ${res.statusText}`);
      }

      navigate('/dashboard/studio/clients');
    } catch (err) {
      setUploadingFiles(false);
      setSubmitError(err instanceof Error ? err.message : 'Failed to save client');
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    try {
      const res = await fetch(`/api/admin/studio/clients/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `${res.status} ${res.statusText}`);
      }
      navigate('/dashboard/studio/clients');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to archive client');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="py-24 text-center text-sm text-destructive">{loadError}</div>
    );
  }

  const isBusy = submitting || uploadingFiles;

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div className="flex items-end justify-between gap-6">
        <div>
          <span style={EYEBROW}>— {isNew ? 'New Client' : 'Edit Client'}</span>
          <h2 className="mt-3" style={PAGE_H1}>
            {isNew ? 'New Client' : form.name || 'Edit Client'}
          </h2>
        </div>
        <button
          type="button"
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => navigate('/dashboard/studio/clients')}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to clients
        </button>
      </div>

      <StudioNav />

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-12">
        {/* ─── Basics ─── */}
        <section>
          <span style={SECTION_HEADER}>— Basics</span>
          <div className="space-y-6">
            <div>
              <Label className="label text-muted-foreground">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Acme Realty"
                required
                className="mt-2"
              />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <Label className="label text-muted-foreground">Contact email</Label>
                <Input
                  type="email"
                  value={form.contact_email}
                  onChange={(e) => setField('contact_email', e.target.value)}
                  placeholder="jane@acmerealty.com"
                  className="mt-2"
                />
              </div>
              <div>
                <Label className="label text-muted-foreground">Phone</Label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  placeholder="+1 555 000 0000"
                  className="mt-2"
                />
              </div>
            </div>

            <div>
              <Label className="label text-muted-foreground">Monthly rate ($)</Label>
              <div className="relative mt-2">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/60">
                  $
                </span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.monthly_rate_dollars}
                  onChange={(e) => setField('monthly_rate_dollars', e.target.value)}
                  placeholder="500"
                  className="tabular pl-7"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Enter amount in dollars — stored as cents.
              </p>
            </div>

            <div>
              <Label className="label text-muted-foreground">Notes</Label>
              <textarea
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                placeholder="Internal notes about this client…"
                rows={3}
                className="mt-2 flex min-h-[80px] w-full rounded-none border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:border-accent focus-visible:outline-none"
              />
            </div>
          </div>
        </section>

        {/* ─── Brand kit ─── */}
        <section>
          <span style={SECTION_HEADER}>— Brand kit</span>
          <div className="space-y-6">
            {/* Logo upload */}
            <div>
              <Label className="label text-muted-foreground">Brand logo</Label>
              <div className="mt-2 flex items-center gap-4">
                {(logoPreview || form.brand_logo_url) && (
                  <img
                    src={logoPreview ?? form.brand_logo_url}
                    alt="Logo preview"
                    className="h-12 w-12 rounded border border-border object-contain bg-secondary"
                  />
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoChange}
                />
                <button
                  type="button"
                  className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                  onClick={() => logoInputRef.current?.click()}
                >
                  {form.brand_logo_url || logoFile ? 'Replace logo' : 'Upload logo'}
                </button>
              </div>
            </div>

            {/* Colors */}
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <Label className="label text-muted-foreground">Primary hex</Label>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="color"
                    value={form.brand_primary_hex}
                    onChange={(e) => setField('brand_primary_hex', e.target.value)}
                    className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                    aria-label="Primary brand color picker"
                  />
                  <Input
                    value={form.brand_primary_hex}
                    onChange={(e) => setField('brand_primary_hex', e.target.value)}
                    placeholder="#000000"
                    maxLength={7}
                    className="tabular font-mono text-sm flex-1"
                  />
                </div>
              </div>
              <div>
                <Label className="label text-muted-foreground">Secondary hex</Label>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="color"
                    value={form.brand_secondary_hex}
                    onChange={(e) => setField('brand_secondary_hex', e.target.value)}
                    className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                    aria-label="Secondary brand color picker"
                  />
                  <Input
                    value={form.brand_secondary_hex}
                    onChange={(e) => setField('brand_secondary_hex', e.target.value)}
                    placeholder="#ffffff"
                    maxLength={7}
                    className="tabular font-mono text-sm flex-1"
                  />
                </div>
              </div>
            </div>

            {/* Agent name */}
            <div>
              <Label className="label text-muted-foreground">Agent name</Label>
              <Input
                value={form.agent_name}
                onChange={(e) => setField('agent_name', e.target.value)}
                placeholder="Jane Smith"
                className="mt-2"
              />
            </div>

            {/* Headshot upload */}
            <div>
              <Label className="label text-muted-foreground">Agent headshot</Label>
              <div className="mt-2 flex items-center gap-4">
                {(headshotPreview || form.agent_headshot_url) && (
                  <img
                    src={headshotPreview ?? form.agent_headshot_url}
                    alt="Headshot preview"
                    className="h-12 w-12 rounded-full border border-border object-cover bg-secondary"
                  />
                )}
                <input
                  ref={headshotInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleHeadshotChange}
                />
                <button
                  type="button"
                  className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                  onClick={() => headshotInputRef.current?.click()}
                >
                  {form.agent_headshot_url || headshotFile ? 'Replace headshot' : 'Upload headshot'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Voice (Phase 3 placeholder) ─── */}
        <section>
          <span style={SECTION_HEADER}>— Voice</span>
          <div>
            <Label className="label text-muted-foreground">
              ElevenLabs voice ID{' '}
              <span className="text-muted-foreground/50">— Phase 3 feature, can leave blank</span>
            </Label>
            <Input
              value={form.voice_id}
              onChange={(e) => setField('voice_id', e.target.value)}
              placeholder="pNInz6obpgDQGcFmaJgB"
              className="mt-2 font-mono text-sm"
            />
          </div>
        </section>

        {/* Submit error */}
        {submitError && (
          <div className="border border-destructive/40 bg-destructive/10 px-4 py-3">
            <p className="text-xs text-destructive">{submitError}</p>
          </div>
        )}

        {/* Form actions */}
        <div className="flex items-center justify-between gap-4 border-t border-border pt-6">
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isBusy || !form.name.trim()}>
              {isBusy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {uploadingFiles ? 'Uploading files…' : 'Saving…'}
                </>
              ) : isNew ? (
                'Create client'
              ) : (
                'Save changes'
              )}
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
              onClick={() => navigate('/dashboard/studio/clients')}
            >
              Cancel
            </button>
          </div>

          {/* Archive (edit only) */}
          {!isNew && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-destructive/70 hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Archive client
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive this client?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The client will be soft-deleted and hidden from default lists. Existing
                    properties and invoice history are preserved. This can be undone by the
                    database administrator.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleArchive}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Archive
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </form>
    </div>
  );
};

export default ClientEdit;
