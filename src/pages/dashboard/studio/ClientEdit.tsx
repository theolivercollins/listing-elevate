import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Trash2, ArrowLeft } from 'lucide-react';
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
import { StudioShell } from '@/components/studio/StudioShell';
import { uploadSingleFile, getStoragePublicUrl } from '@/lib/photo-upload';

// ─── Form state ───────────────────────────────────────────────────────────────

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

// ─── Field label component ─────────────────────────────────────────────────────

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--le-muted)',
        marginBottom: 6,
      }}
    >
      {children}
      {required && (
        <span style={{ color: 'var(--le-bad)', marginLeft: 3 }}>*</span>
      )}
    </label>
  );
}

// ─── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: '0 0 16px 0',
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: '-0.015em',
        color: 'var(--le-ink)',
      }}
    >
      {children}
    </h3>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

const ClientEdit = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [form, setForm] = useState<ClientFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [headshotFile, setHeadshotFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [headshotPreview, setHeadshotPreview] = useState<string | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const headshotInputRef = useRef<HTMLInputElement>(null);
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
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load client');
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
    setLogoPreview(URL.createObjectURL(file));
  };

  const handleHeadshotChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setHeadshotFile(file);
    setHeadshotPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
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
      <StudioShell>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
          <Loader2 size={20} className="studio-spinner" style={{ color: 'var(--le-muted)' }} />
        </div>
      </StudioShell>
    );
  }

  if (loadError) {
    return (
      <StudioShell>
        <div className="studio-error-strip" style={{ marginTop: 24 }}>{loadError}</div>
      </StudioShell>
    );
  }

  const isBusy = submitting || uploadingFiles;

  return (
    <StudioShell>
      {/* ─── Page heading ─── */}
      <div className="studio-page-heading">
        <div>
          <span className="studio-page-eyebrow">Studio · clients</span>
          <h1 className="studio-page-h1" style={{ fontSize: 40 }}>
            {isNew ? 'New client' : form.name || 'Edit client'}
          </h1>
        </div>
        <div className="studio-page-actions">
          {!isNew && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="studio-btn-ghost"
                  style={{ color: 'var(--le-bad)', borderColor: 'rgba(196,74,74,0.2)' }}
                >
                  <Trash2 size={13} strokeWidth={1.6} />
                  Archive
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
          <button
            type="button"
            className="studio-btn-ghost"
            onClick={() => navigate('/dashboard/studio/clients')}
          >
            <ArrowLeft size={13} strokeWidth={1.6} />
            Cancel
          </button>
          <button
            type="submit"
            form="client-edit-form"
            className="studio-cta-primary"
            disabled={isBusy || !form.name.trim()}
          >
            {isBusy ? (
              <>
                <Loader2 size={13} className="studio-spinner" />
                {uploadingFiles ? 'Uploading…' : 'Saving…'}
              </>
            ) : isNew ? (
              'Create client'
            ) : (
              'Save changes'
            )}
          </button>
        </div>
      </div>

      {/* ─── StudioNav ─── */}
      <StudioNav />

      {/* ─── Form ─── */}
      <form
        id="client-edit-form"
        onSubmit={handleSubmit}
        style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        {/* ── Section 1: Basics ── */}
        <div className="studio-card" style={{ padding: 24 }}>
          <SectionHeading>Basics</SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <FieldLabel required>Name</FieldLabel>
              <input
                className="studio-input"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Acme Realty"
                required
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
              }}
            >
              <div>
                <FieldLabel>Contact email</FieldLabel>
                <input
                  className="studio-input"
                  type="email"
                  value={form.contact_email}
                  onChange={(e) => setField('contact_email', e.target.value)}
                  placeholder="jane@acmerealty.com"
                />
              </div>
              <div>
                <FieldLabel>Phone</FieldLabel>
                <input
                  className="studio-input"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  placeholder="+1 555 000 0000"
                />
              </div>
            </div>

            <div>
              <FieldLabel>Monthly rate ($)</FieldLabel>
              <div style={{ position: 'relative' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: 13.5,
                    color: 'var(--le-muted)',
                    pointerEvents: 'none',
                  }}
                >
                  $
                </span>
                <input
                  className="studio-input studio-tabnum"
                  type="number"
                  min={0}
                  step={1}
                  value={form.monthly_rate_dollars}
                  onChange={(e) => setField('monthly_rate_dollars', e.target.value)}
                  placeholder="500"
                  style={{ paddingLeft: 26 }}
                />
              </div>
              <p style={{ marginTop: 5, fontSize: 11.5, color: 'var(--le-muted-2)' }}>
                Enter in dollars — stored as cents.
              </p>
            </div>

            <div>
              <FieldLabel>Notes</FieldLabel>
              <textarea
                className="studio-textarea"
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                placeholder="Internal notes about this client…"
                rows={3}
              />
            </div>
          </div>
        </div>

        {/* ── Section 2: Brand kit ── */}
        <div className="studio-card" style={{ padding: 24 }}>
          <SectionHeading>Brand kit</SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Logo upload */}
            <div>
              <FieldLabel>Brand logo</FieldLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {(logoPreview || form.brand_logo_url) && (
                  <img
                    src={logoPreview ?? form.brand_logo_url}
                    alt="Logo preview"
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 'var(--le-radius-sm)',
                      border: '1px solid var(--le-line)',
                      objectFit: 'contain',
                      background: 'rgba(11,11,16,0.03)',
                    }}
                  />
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleLogoChange}
                />
                <button
                  type="button"
                  className="studio-btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {form.brand_logo_url || logoFile ? 'Replace logo' : 'Upload logo'}
                </button>
              </div>
            </div>

            {/* Color pickers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
              }}
            >
              <div>
                <FieldLabel>Primary color</FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    value={form.brand_primary_hex}
                    onChange={(e) => setField('brand_primary_hex', e.target.value)}
                    style={{
                      width: 36,
                      height: 36,
                      cursor: 'pointer',
                      borderRadius: 8,
                      border: '1px solid var(--le-line)',
                      padding: 2,
                      background: 'transparent',
                    }}
                    aria-label="Primary brand color picker"
                  />
                  <input
                    className="studio-input studio-tabnum"
                    value={form.brand_primary_hex}
                    onChange={(e) => setField('brand_primary_hex', e.target.value)}
                    placeholder="#000000"
                    maxLength={7}
                    style={{ flex: 1 }}
                  />
                </div>
              </div>
              <div>
                <FieldLabel>Secondary color</FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    value={form.brand_secondary_hex}
                    onChange={(e) => setField('brand_secondary_hex', e.target.value)}
                    style={{
                      width: 36,
                      height: 36,
                      cursor: 'pointer',
                      borderRadius: 8,
                      border: '1px solid var(--le-line)',
                      padding: 2,
                      background: 'transparent',
                    }}
                    aria-label="Secondary brand color picker"
                  />
                  <input
                    className="studio-input studio-tabnum"
                    value={form.brand_secondary_hex}
                    onChange={(e) => setField('brand_secondary_hex', e.target.value)}
                    placeholder="#ffffff"
                    maxLength={7}
                    style={{ flex: 1 }}
                  />
                </div>
              </div>
            </div>

            {/* Agent name */}
            <div>
              <FieldLabel>Agent name</FieldLabel>
              <input
                className="studio-input"
                value={form.agent_name}
                onChange={(e) => setField('agent_name', e.target.value)}
                placeholder="Jane Smith"
              />
            </div>

            {/* Headshot upload */}
            <div>
              <FieldLabel>Agent headshot</FieldLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {(headshotPreview || form.agent_headshot_url) && (
                  <img
                    src={headshotPreview ?? form.agent_headshot_url}
                    alt="Headshot preview"
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      border: '1px solid var(--le-line)',
                      objectFit: 'cover',
                      background: 'rgba(11,11,16,0.03)',
                    }}
                  />
                )}
                <input
                  ref={headshotInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleHeadshotChange}
                />
                <button
                  type="button"
                  className="studio-btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={() => headshotInputRef.current?.click()}
                >
                  {form.agent_headshot_url || headshotFile ? 'Replace headshot' : 'Upload headshot'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Section 3: Voice (Phase 3) ── */}
        <div className="studio-card" style={{ padding: 24 }}>
          <SectionHeading>Voice</SectionHeading>
          <div>
            <FieldLabel>ElevenLabs voice ID</FieldLabel>
            <input
              className="studio-input studio-tabnum"
              value={form.voice_id}
              onChange={(e) => setField('voice_id', e.target.value)}
              placeholder="pNInz6obpgDQGcFmaJgB"
            />
            <p style={{ marginTop: 5, fontSize: 11.5, color: 'var(--le-muted-2)' }}>
              Phase 3 feature — can leave blank.
            </p>
          </div>
        </div>

        {/* ── Error ── */}
        {submitError && (
          <div className="studio-error-strip">{submitError}</div>
        )}

        {/* ── Form actions (bottom inline) ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '16px 0',
          }}
        >
          <button
            type="button"
            className="studio-btn-ghost"
            onClick={() => navigate('/dashboard/studio/clients')}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="studio-cta-primary"
            disabled={isBusy || !form.name.trim()}
          >
            {isBusy ? (
              <>
                <Loader2 size={13} className="studio-spinner" />
                {uploadingFiles ? 'Uploading…' : 'Saving…'}
              </>
            ) : isNew ? (
              'Create client'
            ) : (
              'Save changes'
            )}
          </button>
        </div>
      </form>
    </StudioShell>
  );
};

export default ClientEdit;
