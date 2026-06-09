import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { authedFetch } from "@/lib/api";
import {
  Loader2,
  Copy,
  Check,
  Plus,
  AlertTriangle,
  ExternalLink,
  ArrowLeft,
} from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { StudioShell } from '@/components/studio/StudioShell';
import { SceneStrip } from '@/components/studio/SceneStrip';
import { DeliveryStepper, DeliveryNextButton } from '@/components/studio/DeliveryStepper';
import { CheckpointA } from '@/components/studio/CheckpointA';
import { CheckpointB, DeliveredCard } from '@/components/studio/CheckpointB';
import { DeliveryDetails } from '@/components/studio/DeliveryDetails';
import { DeliveryVoiceover } from '@/components/studio/DeliveryVoiceover';
import { DeliveryMusic } from '@/components/studio/DeliveryMusic';
import { isDeliveryStage } from '../../../../lib/delivery/state';
import { getRelativeTime, formatCents } from '@/lib/types';
import type {
  ClientRow,
  RevisionNoteRow,
  PropertyPreviewRow,
  ListingDetails,
} from '../../../../lib/types/operator-studio';

// ─── Local types ───────────────────────────────────────────────────────────────

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
  delivery: { total_cents: number; by_stage: Record<string, number> } | null;
}

interface DeliveryRunSummary {
  id: string;
  stage: string;
  error: string | null;
  listing_details: ListingDetails;
  scene_order: string[] | null;
  voiceover_script: string | null;
  voiceover_voice_id: string | null;
  voiceover_audio_url: string | null;
  music_track_id: string | null;
  video_type: string;
}

interface Bundle {
  property: PropertyRow;
  scenes: SceneRow[];
  revision_notes: RevisionNoteRow[];
  previews: PropertyPreviewRow[];
  cost: CostBundle;
  delivery_run: DeliveryRunSummary | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['complete', 'failed']);

// ─── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    complete:     { label: 'Delivered', cls: 'complete' },
    queued:       { label: 'Queued', cls: 'queued' },
    needs_review: { label: 'Review', cls: 'needs_review' },
    failed:       { label: 'Failed', cls: 'failed' },
    generating:   { label: 'Generating', cls: 'generating' },
    analyzing:    { label: 'Analyzing', cls: 'analyzing' },
    scripting:    { label: 'Scripting', cls: 'scripting' },
    qc:           { label: 'QC', cls: 'qc' },
    assembling:   { label: 'Assembling', cls: 'assembling' },
    ingesting:    { label: 'Ingesting', cls: 'ingesting' },
  };
  const s = map[status] ?? { label: status, cls: 'queued' };
  return (
    <span className={`studio-status-pill ${s.cls}`}>
      <span className="studio-status-dot" />
      {s.label}
    </span>
  );
}

// ─── Copy button ───────────────────────────────────────────────────────────────

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
    <button
      type="button"
      className="studio-btn-ghost"
      style={{ fontSize: 11.5, padding: '4px 10px', gap: 5 }}
      onClick={handleCopy}
    >
      {copied ? (
        <Check size={11} strokeWidth={2} style={{ color: 'var(--le-good)' }} />
      ) : (
        <Copy size={11} strokeWidth={1.6} />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ─── Section card ──────────────────────────────────────────────────────────────

function SectionCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="studio-card" style={{ padding: 24 }}>
      <span
        style={{
          display: 'block',
          fontSize: 11.5,
          fontWeight: 500,
          color: 'var(--le-muted)',
          marginBottom: 6,
        }}
      >
        {eyebrow}
      </span>
      <h3
        style={{
          margin: '0 0 16px 0',
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          color: 'var(--le-ink)',
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

// ─── Meta value ────────────────────────────────────────────────────────────────

function MetaValue({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <div>
      <span
        style={{
          display: 'block',
          fontSize: 11.5,
          fontWeight: 500,
          color: 'var(--le-muted)',
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      <p
        style={{
          margin: 0,
          fontSize: 13.5,
          fontWeight: 500,
          color: 'var(--le-ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value != null && value !== '' ? String(value) : '—'}
      </p>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

const PropertyCommandCenter = () => {
  const { id } = useParams<{ id: string }>();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const [generatingLink, setGeneratingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [advancePending, setAdvancePending] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBundle = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/admin/studio/properties/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Bundle;
      setBundle(data);
      setError(null);
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
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchBundle]);

  const handleSaveNote = async () => {
    if (!noteBody.trim()) return;
    setSavingNote(true);
    setNoteError(null);
    try {
      const res = await authedFetch(`/api/admin/studio/properties/${id}/notes`, {
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
      const res = await authedFetch(`/api/admin/studio/properties/${id}/preview-link`, {
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

  // Generic delivery action helper — all checkpoint sections reuse this.
  const deliveryAction = useCallback(async (body: Record<string, unknown>) => {
    if (!bundle?.delivery_run) return;
    const res = await authedFetch(`/api/admin/studio/delivery/${bundle.delivery_run.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      // Re-sync the stepper before surfacing the error so the UI never shows
      // a stale stage. 409 = stage-moved conflict; other errors re-sync too
      // in case the server advanced before returning the error.
      await fetchBundle();
      throw new Error((d as { error?: string }).error ?? `${res.status}`);
    }
    await fetchBundle();
  }, [bundle, fetchBundle]);

  if (loading) {
    return (
      <StudioShell>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
          <Loader2 size={20} className="studio-spinner" style={{ color: 'var(--le-muted)' }} />
        </div>
      </StudioShell>
    );
  }

  if (error || !bundle) {
    return (
      <StudioShell>
        <div className="studio-error-strip" style={{ marginTop: 24 }}>
          {error ?? 'Property not found.'}
        </div>
      </StudioShell>
    );
  }

  const { property, scenes, revision_notes, previews, cost } = bundle;
  const client = property.client;
  const baseUrl = window.location.origin;

  return (
    <StudioShell>
      {/* ─── Page heading ─── */}
      <div className="studio-page-heading">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Link to="/dashboard/studio" className="studio-btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px', gap: 5 }}>
              <ArrowLeft size={11} strokeWidth={1.8} />
              Queue
            </Link>
            {client && (
              <>
                <span style={{ fontSize: 11.5, color: 'var(--le-muted-2)' }}>/</span>
                <Link
                  to={`/dashboard/studio/video/clients/${property.client_id}`}
                  className="studio-btn-ghost"
                  style={{ fontSize: 11.5, padding: '4px 10px', gap: 5 }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: client.brand_primary_hex ?? 'var(--le-muted-2)',
                      flexShrink: 0,
                      display: 'inline-block',
                    }}
                  />
                  {client.name}
                </Link>
              </>
            )}
          </div>
          <h1
            className="studio-page-h1"
            style={{
              fontSize: 'clamp(28px, 4vw, 48px)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '60vw',
            }}
          >
            {property.address}
          </h1>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusPill status={property.status} />
          </div>
        </div>
        <div className="studio-page-actions">
          {property.status === 'complete' && property.vertical_video_url && (
            <a
              href={property.vertical_video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="studio-btn-ghost"
            >
              <ExternalLink size={13} strokeWidth={1.6} />
              Open video
            </a>
          )}
          <button
            type="button"
            className="studio-cta-primary"
            onClick={handleGeneratePreviewLink}
            disabled={generatingLink}
          >
            {generatingLink ? (
              <Loader2 size={13} className="studio-spinner" />
            ) : (
              <Plus size={13} strokeWidth={2} />
            )}
            Generate preview link
          </button>
        </div>
      </div>

      {/* ─── StudioNav ─── */}
      <StudioNav />

      {/* ─── Delivery stepper (operator-mode only — hidden when no delivery_run) ─── */}
      {bundle.delivery_run && isDeliveryStage(bundle.delivery_run.stage) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <DeliveryStepper stage={bundle.delivery_run.stage} error={bundle.delivery_run.error} />
          {/* Shared Next button — rendered on gate stages where the operator manually advances */}
          {/* ─── Checkpoint A: clip reorder panel ─── */}
          {bundle.delivery_run.stage === 'checkpoint_a' && (
            <CheckpointA runId={bundle.delivery_run.id} onChanged={fetchBundle} />
          )}
          {/* ─── Details: listing fields form ─── */}
          {bundle.delivery_run.stage === 'details' && (
            <DeliveryDetails
              runId={bundle.delivery_run.id}
              listingDetails={bundle.delivery_run.listing_details}
              onSaved={fetchBundle}
            />
          )}
          {/* ─── Voiceover: script + voice picker + audio ─── */}
          {bundle.delivery_run.stage === 'voiceover' && (
            <DeliveryVoiceover
              runId={bundle.delivery_run.id}
              clientId={property.client_id}
              voiceoverScript={bundle.delivery_run.voiceover_script}
              voiceoverVoiceId={bundle.delivery_run.voiceover_voice_id}
              voiceoverAudioUrl={bundle.delivery_run.voiceover_audio_url}
              onChanged={fetchBundle}
            />
          )}
          {/* ─── Music: library options + generate-new ─── */}
          {bundle.delivery_run.stage === 'music' && (
            <DeliveryMusic
              runId={bundle.delivery_run.id}
              videoType={bundle.delivery_run.video_type}
              musicTrackId={bundle.delivery_run.music_track_id}
              onChanged={fetchBundle}
            />
          )}
          {/* ─── Checkpoint B: final video + ratings + delivered ─── */}
          {bundle.delivery_run.stage === 'checkpoint_b' && (
            <CheckpointB
              runId={bundle.delivery_run.id}
              videoUrl={property.horizontal_video_url}
              onDelivered={fetchBundle}
            />
          )}
          {/* ─── Delivered: summary card ─── */}
          {bundle.delivery_run.stage === 'delivered' && (
            <DeliveredCard />
          )}
          <DeliveryNextButton
            stage={bundle.delivery_run.stage}
            pending={advancePending}
            error={advanceError}
            onAdvance={async (to) => {
              setAdvancePending(true);
              setAdvanceError(null);
              try {
                // Music's Next kicks off assembly in one request: the server
                // advances music -> assembling itself, runs the render, and
                // lands on checkpoint_b. All other gates use the plain advance.
                if (to === 'assembling') {
                  await deliveryAction({ action: 'assemble' });
                } else {
                  await deliveryAction({ action: 'advance', to });
                }
              } catch (err) {
                // fetchBundle already re-synced inside deliveryAction; surface error to operator
                setAdvanceError(err instanceof Error ? err.message : 'Advance failed');
              } finally {
                setAdvancePending(false);
              }
            }}
          />
        </div>
      )}

      {/* ─── Section stack ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Final video ── */}
        <SectionCard eyebrow="Output" title="Final video">
          {property.status === 'complete' && (property.horizontal_video_url || property.vertical_video_url) ? (
            <div className="le-flexcol-lg" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {property.horizontal_video_url && (
                <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--le-muted)' }}>
                    Horizontal (16:9)
                  </span>
                  <video
                    src={property.horizontal_video_url}
                    controls
                    muted
                    playsInline
                    className="studio-video"
                    style={{ maxHeight: 320 }}
                  />
                </div>
              )}
              {property.vertical_video_url && (
                <div style={{ flex: '0 0 180px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--le-muted)' }}>
                    Vertical (9:16)
                  </span>
                  <video
                    src={property.vertical_video_url}
                    controls
                    muted
                    playsInline
                    className="studio-video"
                    style={{ maxHeight: 320 }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div
              className="studio-kanban-empty"
              style={{ padding: 32, textAlign: 'center' }}
            >
              <p style={{ fontSize: 13.5, color: 'var(--le-muted)' }}>
                Pipeline in progress — currently{' '}
                <strong style={{ color: 'var(--le-ink)' }}>{property.status}</strong>.
              </p>
            </div>
          )}
        </SectionCard>

        {/* ── Scenes ── */}
        <SectionCard eyebrow="Pipeline" title={`Scenes (${scenes.length})`}>
          <SceneStrip scenes={scenes} propertyId={property.id} onSwapped={fetchBundle} />
        </SectionCard>

        {/* ── Director's notes ── */}
        <SectionCard eyebrow="Direction" title="Director's notes">
          {revision_notes.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--le-muted-2)', marginBottom: 16 }}>
              No notes yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {revision_notes.map((note) => (
                <div
                  key={note.id}
                  style={{
                    background: 'rgba(11,11,16,0.025)',
                    borderRadius: 'var(--le-radius-sm)',
                    padding: '12px 14px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: note.source === 'client_preview' ? '2px 7px' : '0',
                        borderRadius: 99,
                        background:
                          note.source === 'client_preview'
                            ? 'rgba(182,128,44,0.10)'
                            : 'transparent',
                        color:
                          note.source === 'client_preview'
                            ? 'var(--le-warn)'
                            : 'var(--le-muted)',
                      }}
                    >
                      {note.source === 'client_preview' ? 'Client preview' : 'Operator'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--le-muted-2)' }}>
                      {getRelativeTime(note.created_at)}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      color: 'var(--le-ink-2)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {note.body}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Add note */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              className="studio-textarea"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Add a director's note…"
              rows={3}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="studio-cta-primary"
                style={{ fontSize: 12.5, padding: '8px 14px' }}
                onClick={handleSaveNote}
                disabled={savingNote || !noteBody.trim()}
              >
                {savingNote && <Loader2 size={12} className="studio-spinner" />}
                Save note
              </button>
              {noteError && (
                <span className="studio-error-strip" style={{ padding: '4px 10px', fontSize: 12 }}>
                  {noteError}
                </span>
              )}
            </div>
          </div>
        </SectionCard>

        {/* ── Preview links ── */}
        <SectionCard eyebrow="Client delivery" title="Preview links">
          {linkError && (
            <div className="studio-error-strip" style={{ marginBottom: 12 }}>{linkError}</div>
          )}

          {previews.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--le-muted-2)', marginBottom: 16 }}>
              No preview links yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {previews.map((pv) => {
                const url = `${baseUrl}/preview/${pv.token}`;
                return (
                  <div
                    key={pv.token}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      background: 'rgba(11,11,16,0.025)',
                      borderRadius: 'var(--le-radius-sm)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 12.5,
                          color: 'var(--le-accent)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                        }}
                      >
                        {url}
                      </a>
                      <ExternalLink
                        size={11}
                        strokeWidth={1.6}
                        style={{ flexShrink: 0, color: 'var(--le-muted-2)' }}
                      />
                    </div>
                    <CopyButton text={url} />
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        fontSize: 11.5,
                        color: 'var(--le-muted-2)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
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

          <button
            type="button"
            className="studio-btn-ghost"
            onClick={handleGeneratePreviewLink}
            disabled={generatingLink}
          >
            {generatingLink ? (
              <Loader2 size={12} className="studio-spinner" />
            ) : (
              <Plus size={13} strokeWidth={2} />
            )}
            Generate preview link
          </button>
        </SectionCard>

        {/* ── Brand kit summary ── */}
        <SectionCard eyebrow="Client" title="Brand kit">
          {!property.client_id ? (
            <p style={{ fontSize: 12.5, color: 'var(--le-muted-2)' }}>No client linked.</p>
          ) : !client ? (
            <p style={{ fontSize: 12.5, color: 'var(--le-muted-2)' }}>Loading client…</p>
          ) : !client.brand_logo_url ? (
            <div className="studio-warn-strip">
              <AlertTriangle size={14} strokeWidth={1.6} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: 13 }}>
                  Brand kit incomplete — final video will not be branded
                </p>
                <Link
                  to={`/dashboard/studio/video/clients/${property.client_id}`}
                  style={{
                    fontSize: 12,
                    color: 'var(--le-warn)',
                    textDecoration: 'underline',
                    textUnderlineOffset: 3,
                  }}
                >
                  Complete brand kit
                </Link>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--le-muted)' }}>Logo</span>
                <img
                  src={client.brand_logo_url}
                  alt={`${client.name} logo`}
                  style={{ height: 40, maxWidth: 120, objectFit: 'contain' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--le-muted)' }}>Colors</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {client.brand_primary_hex && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span
                        style={{
                          width: 40,
                          height: 28,
                          borderRadius: 8,
                          background: client.brand_primary_hex,
                          border: '1px solid var(--le-line)',
                          display: 'block',
                        }}
                        title={client.brand_primary_hex}
                      />
                      <span style={{ fontSize: 10, color: 'var(--le-muted-2)', fontVariantNumeric: 'tabular-nums' }}>
                        {client.brand_primary_hex}
                      </span>
                    </div>
                  )}
                  {client.brand_secondary_hex && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span
                        style={{
                          width: 40,
                          height: 28,
                          borderRadius: 8,
                          background: client.brand_secondary_hex,
                          border: '1px solid var(--le-line)',
                          display: 'block',
                        }}
                        title={client.brand_secondary_hex}
                      />
                      <span style={{ fontSize: 10, color: 'var(--le-muted-2)', fontVariantNumeric: 'tabular-nums' }}>
                        {client.brand_secondary_hex}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {(client.agent_name || client.agent_headshot_url) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--le-muted)' }}>Agent</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {client.agent_headshot_url && (
                      <img
                        src={client.agent_headshot_url}
                        alt={client.agent_name ?? 'Agent'}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: '1px solid var(--le-line)',
                        }}
                      />
                    )}
                    {client.agent_name && (
                      <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--le-ink)' }}>
                        {client.agent_name}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </SectionCard>

        {/* ── Cost panel ── */}
        <SectionCard eyebrow="Accounting" title="Cost">
          <div style={{ marginBottom: 16 }}>
            <span
              style={{
                fontSize: 32,
                fontWeight: 600,
                letterSpacing: '-0.03em',
                color: 'var(--le-ink)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatCents(cost.total_cents)}
            </span>
          </div>

          {Object.keys(cost.by_provider).length > 0 ? (
            <div className="le-table-scroll is-mid">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--le-line-2)' }}>
                  <th
                    style={{
                      textAlign: 'left',
                      paddingBottom: 8,
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: 'var(--le-muted)',
                    }}
                  >
                    Provider
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      paddingBottom: 8,
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: 'var(--le-muted)',
                    }}
                  >
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(cost.by_provider)
                  .sort(([, a], [, b]) => b - a)
                  .map(([provider, cents]) => (
                    <tr key={provider} style={{ borderBottom: '1px solid var(--le-line-2)' }}>
                      <td
                        style={{
                          padding: '10px 0',
                          fontSize: 13,
                          color: 'var(--le-ink-2)',
                          textTransform: 'capitalize',
                        }}
                      >
                        {provider}
                      </td>
                      <td
                        style={{
                          padding: '10px 0',
                          textAlign: 'right',
                          fontSize: 13,
                          color: 'var(--le-ink)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {formatCents(cents)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: 'var(--le-muted-2)' }}>No cost events yet.</p>
          )}

          {/* ── Delivery run sub-block ── */}
          {cost.delivery && (
            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid var(--le-line-2)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: 'var(--le-muted)',
                  }}
                >
                  Delivery run
                </span>
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: 'var(--le-ink)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatCents(cost.delivery.total_cents)}
                </span>
              </div>
              {Object.entries(cost.delivery.by_stage).length > 0 ? (
                <div className="le-table-scroll is-mid">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {Object.entries(cost.delivery.by_stage)
                        .sort(([, a], [, b]) => b - a)
                        .map(([stage, cents]) => (
                          <tr key={stage} style={{ borderBottom: '1px solid var(--le-line-2)' }}>
                            <td
                              style={{
                                padding: '8px 0',
                                fontSize: 12.5,
                                color: 'var(--le-ink-2)',
                              }}
                            >
                              {stage}
                            </td>
                            <td
                              style={{
                                padding: '8px 0',
                                textAlign: 'right',
                                fontSize: 12.5,
                                color: 'var(--le-ink)',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {formatCents(cents)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--le-muted-2)' }}>No delivery cost events yet.</p>
              )}
            </div>
          )}
        </SectionCard>

        {/* ── Metadata ── */}
        <SectionCard eyebrow="Listing details" title="Metadata">
          <div
            className="le-cols-2-lg le-stack-sm"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '16px 24px',
            }}
          >
            <MetaValue label="Bedrooms" value={property.bedrooms} />
            <MetaValue label="Bathrooms" value={property.bathrooms} />
            <MetaValue
              label="Sq ft"
              value={
                property.square_footage != null
                  ? property.square_footage.toLocaleString()
                  : null
              }
            />
            <MetaValue
              label="Price"
              value={
                property.price != null
                  ? `$${property.price.toLocaleString()}`
                  : null
              }
            />
          </div>
          <p style={{ marginTop: 12, fontSize: 11.5, color: 'var(--le-muted-2)' }}>
            Edit-in-place available in Phase 2.
          </p>
        </SectionCard>
      </div>
    </StudioShell>
  );
};

export default PropertyCommandCenter;
