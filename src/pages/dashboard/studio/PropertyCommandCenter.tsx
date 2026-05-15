import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, Copy, Check, Plus, AlertTriangle, ExternalLink } from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { SceneStrip } from '@/components/studio/SceneStrip';
import { getRelativeTime, formatCents } from '@/lib/types';
import type { ClientRow, RevisionNoteRow, PropertyPreviewRow } from '../../../../lib/types/operator-studio';
import '@/v2/styles/v2.css';

// ─── Local types ─────────────────────────────────────────────────────────────

interface PropertyRow {
  id: string;
  address: string;
  status: string;
  horizontal_video_url: string | null;
  vertical_video_url: string | null;
  client_id: string | null;
  client: ClientRow | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_footage: number | null;
  price: number | null;
}

interface SceneRow {
  id: string;
  scene_number: number;
  room_type: string | null;
  clip_url: string | null;
  status: string;
}

interface CostBundle {
  total_cents: number;
  by_provider: Record<string, number>;
}

interface Bundle {
  property: PropertyRow;
  scenes: SceneRow[];
  revision_notes: RevisionNoteRow[];
  previews: PropertyPreviewRow[];
  cost: CostBundle;
}

// ─── Style constants ──────────────────────────────────────────────────────────

const EYEBROW: CSSProperties = {
  fontFamily: 'var(--le-font-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)',
};

const SECTION_HEADER: CSSProperties = {
  ...EYEBROW,
  paddingBottom: 10,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  display: 'block',
  marginBottom: 16,
};

const GHOST_BTN: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  fontSize: 11,
  fontWeight: 500,
  background: 'transparent',
  color: '#fff',
  border: '1px solid rgba(220,230,255,0.18)',
  borderRadius: 2,
  cursor: 'pointer',
  fontFamily: 'var(--le-font-sans)',
};

const ACCENT_BTN: CSSProperties = {
  ...GHOST_BTN,
  background: 'var(--le-accent)',
  color: 'var(--le-accent-fg)',
  border: 'none',
};

// ─── Terminal statuses (stop polling when reached) ────────────────────────────

const TERMINAL_STATUSES = new Set(['complete', 'failed']);

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  let bg = 'rgba(255,255,255,0.1)';
  let color = 'rgba(255,255,255,0.7)';
  if (status === 'complete') { bg = 'rgba(74,222,128,0.15)'; color = '#4ade80'; }
  else if (status === 'failed') { bg = 'rgba(248,113,113,0.15)'; color = '#f87171'; }
  else if (['needs_review', 'qc'].includes(status)) { bg = 'rgba(250,204,21,0.15)'; color = '#facc15'; }
  else if (['generating', 'scripting', 'analyzing', 'assembling', 'queued'].includes(status)) {
    bg = 'rgba(96,165,250,0.15)'; color = '#60a5fa';
  }
  return (
    <span
      style={{
        ...EYEBROW,
        fontSize: 9,
        color,
        background: bg,
        padding: '3px 8px',
        letterSpacing: '0.18em',
      }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — silently ignore
    }
  };
  return (
    <button type="button" style={{ ...GHOST_BTN, padding: '3px 8px', fontSize: 10 }} onClick={handleCopy}>
      {copied ? <Check style={{ width: 10, height: 10 }} /> : <Copy style={{ width: 10, height: 10 }} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function MetaValue({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <span style={EYEBROW}>{label}</span>
      <p className="mt-1 text-sm font-medium">{value != null && value !== '' ? String(value) : '—'}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PropertyCommandCenter = () => {
  const { id } = useParams<{ id: string }>();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Director's notes form
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Preview link generation
  const [generatingLink, setGeneratingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBundle = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/studio/properties/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Bundle;
      setBundle(data);
      setError(null);
      // Stop polling if terminal
      if (TERMINAL_STATUSES.has(data.property.status) && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load property');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchBundle();
    pollRef.current = setInterval(fetchBundle, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchBundle]);

  const handleSaveNote = async () => {
    if (!noteBody.trim()) return;
    setSavingNote(true);
    setNoteError(null);
    try {
      const res = await fetch(`/api/admin/studio/properties/${id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteBody.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setNoteBody('');
      await fetchBundle();
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleGeneratePreviewLink = async () => {
    setGeneratingLink(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/admin/studio/properties/${id}/preview-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await fetchBundle();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to generate link');
    } finally {
      setGeneratingLink(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !bundle) {
    return (
      <div className="py-20 text-center text-sm text-destructive">
        {error ?? 'Property not found.'}
      </div>
    );
  }

  const { property, scenes, revision_notes, previews, cost } = bundle;
  const client = property.client;
  const baseUrl = window.location.origin;

  return (
    <div className="space-y-10 pb-20">
      {/* ─── Header Strip ─── */}
      <div>
        <span style={EYEBROW}>— Property Command Center</span>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h2
              style={{
                fontFamily: 'var(--le-font-sans)',
                fontSize: 'clamp(22px, 3vw, 36px)',
                fontWeight: 500,
                letterSpacing: '-0.03em',
                lineHeight: 1.05,
                color: '#fff',
                margin: 0,
              }}
            >
              {property.address}
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              {client && (
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ background: client.brand_primary_hex ?? 'rgba(255,255,255,0.3)' }}
                  />
                  <span className="text-xs text-muted-foreground">{client.name}</span>
                </div>
              )}
              <StatusPill status={property.status} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              style={ACCENT_BTN}
              onClick={handleGeneratePreviewLink}
              disabled={generatingLink}
            >
              {generatingLink ? (
                <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
              ) : (
                <Plus style={{ width: 12, height: 12 }} />
              )}
              Preview link
            </button>
            <button
              type="button"
              style={{ ...GHOST_BTN, opacity: 0.4, cursor: 'not-allowed' }}
              disabled
              title="Edit — Phase 2"
            >
              Edit
            </button>
          </div>
        </div>
      </div>

      <StudioNav />

      {/* ─── Final Preview ─── */}
      {property.status === 'complete' && (property.horizontal_video_url || property.vertical_video_url) && (
        <section>
          <span style={SECTION_HEADER}>— Final Preview</span>
          <div className="flex flex-wrap gap-4">
            {property.horizontal_video_url && (
              <div className="flex flex-col gap-2 flex-1 min-w-[260px]">
                <span style={{ ...EYEBROW, fontSize: 9 }}>Horizontal (16:9)</span>
                <video
                  src={property.horizontal_video_url}
                  controls
                  muted
                  playsInline
                  className="w-full border border-border"
                  style={{ maxHeight: 320, background: '#000' }}
                />
              </div>
            )}
            {property.vertical_video_url && (
              <div className="flex flex-col gap-2" style={{ width: 180 }}>
                <span style={{ ...EYEBROW, fontSize: 9 }}>Vertical (9:16)</span>
                <video
                  src={property.vertical_video_url}
                  controls
                  muted
                  playsInline
                  className="w-full border border-border"
                  style={{ maxHeight: 320, background: '#000' }}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─── Scene Strip ─── */}
      <section>
        <span style={SECTION_HEADER}>— Scenes ({scenes.length})</span>
        <SceneStrip scenes={scenes} propertyId={property.id} onSwapped={fetchBundle} />
      </section>

      {/* ─── Director's Notes ─── */}
      <section>
        <span style={SECTION_HEADER}>— Director's Notes</span>

        {/* Note list */}
        {revision_notes.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 mb-4">No notes yet.</p>
        ) : (
          <div className="mb-5 space-y-2">
            {revision_notes.map((note) => (
              <div
                key={note.id}
                className="border border-border bg-background/50 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span
                    style={{
                      ...EYEBROW,
                      fontSize: 9,
                      color: note.source === 'client_preview' ? '#facc15' : 'rgba(255,255,255,0.45)',
                      background: note.source === 'client_preview' ? 'rgba(250,204,21,0.12)' : 'transparent',
                      padding: note.source === 'client_preview' ? '2px 6px' : 0,
                    }}
                  >
                    {note.source === 'client_preview' ? 'Client Preview' : 'Operator'}
                  </span>
                  <span style={{ ...EYEBROW, fontSize: 9 }}>
                    {getRelativeTime(note.created_at)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{note.body}</p>
              </div>
            ))}
          </div>
        )}

        {/* Add note */}
        <div className="space-y-2">
          <textarea
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            placeholder="Add a director's note…"
            rows={3}
            className="flex min-h-[80px] w-full border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:border-accent focus-visible:outline-none"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              style={ACCENT_BTN}
              onClick={handleSaveNote}
              disabled={savingNote || !noteBody.trim()}
            >
              {savingNote ? (
                <Loader2 style={{ width: 11, height: 11, animation: 'spin 1s linear infinite' }} />
              ) : null}
              Save note
            </button>
            {noteError && (
              <span className="text-xs text-destructive">{noteError}</span>
            )}
          </div>
        </div>
      </section>

      {/* ─── Preview Links ─── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <span style={SECTION_HEADER}>— Preview Links</span>
        </div>

        {linkError && (
          <p className="mb-3 text-xs text-destructive">{linkError}</p>
        )}

        {previews.length === 0 ? (
          <p className="text-xs text-muted-foreground/60">No preview links yet.</p>
        ) : (
          <div className="space-y-2">
            {previews.map((pv) => {
              const url = `${baseUrl}/preview/${pv.token}`;
              return (
                <div
                  key={pv.token}
                  className="flex flex-wrap items-center gap-3 border border-border bg-background/50 px-4 py-3"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-xs text-accent hover:underline"
                    >
                      {url}
                    </a>
                    <ExternalLink style={{ width: 10, height: 10, flexShrink: 0, color: 'rgba(255,255,255,0.3)' }} />
                  </div>
                  <CopyButton text={url} />
                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground/60">
                    <span>Viewed: {pv.viewed_count}</span>
                    <span>
                      Expires: {pv.expires_at ? getRelativeTime(pv.expires_at) : 'never'}
                    </span>
                    {pv.last_viewed_at && (
                      <span>Last: {getRelativeTime(pv.last_viewed_at)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Brand Kit Summary ─── */}
      <section>
        <span style={SECTION_HEADER}>— Brand Kit</span>
        {!property.client_id ? (
          <p className="text-xs text-muted-foreground/60">No client linked.</p>
        ) : !client ? (
          <p className="text-xs text-muted-foreground/60">Loading client…</p>
        ) : !client.brand_logo_url ? (
          <div className="flex items-start gap-3 border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
            <AlertTriangle style={{ width: 14, height: 14, color: '#facc15', flexShrink: 0, marginTop: 1 }} />
            <div>
              <p className="text-xs font-medium text-yellow-300 mb-1">
                Brand kit incomplete — final video will not be branded
              </p>
              <Link
                to={`/dashboard/studio/clients/${property.client_id}`}
                className="text-[11px] text-yellow-400 underline underline-offset-4 hover:text-yellow-300"
              >
                Complete brand kit
              </Link>
            </div>
          </div>
        ) : (
          <div className="border border-border bg-background/50 px-4 py-4 flex flex-wrap gap-6 items-start">
            {/* Logo */}
            <div className="flex flex-col gap-1">
              <span style={EYEBROW}>Logo</span>
              <img
                src={client.brand_logo_url}
                alt={`${client.name} logo`}
                className="h-10 w-auto object-contain"
              />
            </div>

            {/* Color swatches */}
            <div className="flex flex-col gap-1">
              <span style={EYEBROW}>Colors</span>
              <div className="flex gap-2">
                {client.brand_primary_hex && (
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className="h-7 w-10 border border-border"
                      style={{ background: client.brand_primary_hex }}
                      title={client.brand_primary_hex}
                    />
                    <span style={{ ...EYEBROW, fontSize: 8 }}>{client.brand_primary_hex}</span>
                  </div>
                )}
                {client.brand_secondary_hex && (
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className="h-7 w-10 border border-border"
                      style={{ background: client.brand_secondary_hex }}
                      title={client.brand_secondary_hex}
                    />
                    <span style={{ ...EYEBROW, fontSize: 8 }}>{client.brand_secondary_hex}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Agent info */}
            {(client.agent_name || client.agent_headshot_url) && (
              <div className="flex flex-col gap-1">
                <span style={EYEBROW}>Agent</span>
                <div className="flex items-center gap-2">
                  {client.agent_headshot_url && (
                    <img
                      src={client.agent_headshot_url}
                      alt={client.agent_name ?? 'Agent'}
                      className="h-8 w-8 rounded-full object-cover border border-border"
                    />
                  )}
                  {client.agent_name && (
                    <span className="text-sm">{client.agent_name}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ─── Cost Panel ─── */}
      <section>
        <span style={SECTION_HEADER}>— Cost</span>
        <div className="border border-border bg-background/50 px-4 py-4">
          <div className="flex items-baseline gap-3 mb-4">
            <span className="tabular text-2xl font-medium">{formatCents(cost.total_cents)}</span>
            <span style={EYEBROW}>total</span>
          </div>
          {Object.keys(cost.by_provider).length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left pb-2" style={EYEBROW}>Provider</th>
                  <th className="text-right pb-2" style={EYEBROW}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(cost.by_provider)
                  .sort(([, a], [, b]) => b - a)
                  .map(([provider, cents]) => (
                    <tr key={provider} className="border-b border-border/40">
                      <td className="py-2 text-sm capitalize">{provider}</td>
                      <td className="py-2 text-right tabular text-sm">{formatCents(cents)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {Object.keys(cost.by_provider).length === 0 && (
            <p className="text-xs text-muted-foreground/60">No cost events yet.</p>
          )}
        </div>
      </section>

      {/* ─── Metadata Panel ─── */}
      <section>
        <span style={SECTION_HEADER}>— Metadata</span>
        <div className="border border-border bg-background/50 px-4 py-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <MetaValue label="Bedrooms" value={property.bedrooms} />
            <MetaValue label="Bathrooms" value={property.bathrooms} />
            <MetaValue
              label="Sq Ft"
              value={property.square_footage != null ? property.square_footage.toLocaleString() : null}
            />
            <MetaValue
              label="Price"
              value={property.price != null ? `$${property.price.toLocaleString()}` : null}
            />
          </div>
          <p className="mt-4 text-[10px] text-muted-foreground/40">
            Edit-in-place available in Phase 2.
          </p>
        </div>
      </section>
    </div>
  );
};

export default PropertyCommandCenter;
