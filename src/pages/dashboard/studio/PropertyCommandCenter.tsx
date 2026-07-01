import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { authedFetch } from "@/lib/api";
import { photoThumb, bunnyPosterUrl } from '@/lib/image-url';
import {
  Loader2,
  Copy,
  Check,
  Plus,
  AlertTriangle,
  ExternalLink,
  ArrowLeft,
  Download,
  Share2,
} from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { StudioShell } from '@/components/studio/StudioShell';
import { AutopilotBadge } from '@/components/studio/AutopilotBadge';
import { AutopilotPanel } from '@/components/studio/AutopilotPanel';
import { SceneStrip } from '@/components/studio/SceneStrip';
import { DeliveryStepper, DeliveryNextButton, DeliveryStageControls, ResumeGenerationControls } from '@/components/studio/DeliveryStepper';
import { PhotoCheckpointA } from '@/components/studio/PhotoCheckpointA';
import { CheckpointA } from '@/components/studio/CheckpointA';
import { CheckpointB, DeliveredCard } from '@/components/studio/CheckpointB';
import { FinalVideoPlayer } from '@/components/studio/FinalVideoPlayer';
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
import ShareDialog, { type ShareLinks, type ToggleField } from './ShareDialog';

// ─── Local types ───────────────────────────────────────────────────────────────

interface PropertyRow {
  id: string;
  address: string;
  status: string;
  horizontal_video_url: string | null;
  vertical_video_url: string | null;
  // Bunny adaptive HLS playlist + real-frame poster per orientation
  // (migration 102). Nullable: absent on legacy/pre-migration rows, in which
  // case players fall back to the progressive *_video_url + a derived poster.
  horizontal_hls_url: string | null;
  horizontal_poster_url: string | null;
  vertical_hls_url: string | null;
  vertical_poster_url: string | null;
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

interface ProviderCostDetail {
  cost_cents: number;
  event_count: number;
  rerender_count: number;
  rerender_cents: number;
}

interface CostBundle {
  total_cents: number;
  by_provider: Record<string, number>;
  // Optional: older cached bundles / tests may omit this additive field.
  by_provider_detail?: Record<string, ProviderCostDetail>;
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
  /** Autopilot is active when true. Set at intake; toggled via set_auto_run action. */
  auto_run: boolean;
  /** Non-null when autopilot has paused waiting for human input. Cleared by resume_autopilot. */
  paused_reason: string | null;
  /** ISO timestamp of when autopilot last paused this run. */
  auto_paused_at: string | null;
}

/** Single-video-per-orientation descriptor built server-side from a Bunny-
 *  hosted URL (see api/admin/studio/properties/[id].ts buildFinalVideo). Null
 *  when the persisted URL isn't Bunny-hosted (provider-URL fallback row) —
 *  callers fall back to the raw mp4/HLS player in that case. */
interface FinalVideoEntry {
  embed_url: string | null;
  mp4_url: string;
  hls_url: string | null;
}

interface FinalVideoBundle {
  horizontal: FinalVideoEntry | null;
  vertical: FinalVideoEntry | null;
}

interface Bundle {
  property: PropertyRow;
  scenes: SceneRow[];
  revision_notes: RevisionNoteRow[];
  previews: PropertyPreviewRow[];
  cost: CostBundle;
  delivery_run: DeliveryRunSummary | null;
  final_video: FinalVideoBundle;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['complete', 'failed']);

// ─── Poll cadence ──────────────────────────────────────────────────────────────
//
// The 5s tick is only worth its cost while the pipeline is actively doing
// automated work the operator wants to watch progress on. Once a run parks at
// an operator gate (needs_review, or a delivery-run checkpoint/details/photo
// gate) nothing changes server-side until the operator acts — and every
// action handler in this file already calls fetchBundle() directly, so a
// slow background tick there is just a stale-data safety net, not the
// primary refresh path.

const FAST_POLL_MS = 5_000;
const SLOW_POLL_MS = 30_000;

// delivery_run.stage values (see lib/delivery/state.ts DELIVERY_STAGES) where
// the server is actively scraping/rendering/judging/etc. The remaining
// stages — intake, photo_selection, checkpoint_a, details, checkpoint_b,
// delivered — are pre-flight or operator gates, so they get the slow tick.
const ACTIVE_DELIVERY_STAGES = new Set<string>([
  'scraping', 'generating', 'judging', 'assembling', 'voiceover', 'music',
]);

// property.status values (see StatusPill's map below) for the legacy/fully-
// autonomous pipeline, used only when there's no delivery_run — the
// equivalent "server is working" bucket for that vocabulary. needs_review is
// deliberately excluded: it's the autonomous-pipeline's operator gate.
const ACTIVE_PROPERTY_STATUSES = new Set<string>([
  'queued', 'analyzing', 'scripting', 'generating', 'qc', 'assembling', 'ingesting',
]);

/** True while `data` represents active, unattended pipeline work (fast poll). */
function isActiveStage(data: Bundle): boolean {
  const stage = data.delivery_run?.stage;
  if (stage) return ACTIVE_DELIVERY_STAGES.has(stage);
  return ACTIVE_PROPERTY_STATUSES.has(data.property.status);
}

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
      className="studio-btn-ghost studio-btn-sm"
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

// ─── Download button ───────────────────────────────────────────────────────────

/**
 * Downloads the video via a fetch→blob→objectURL→programmatic-click flow so the
 * Authorization header is carried. An <a download> anchor would be cross-origin
 * and wouldn't send the auth header, so we proxy through the server endpoint.
 */
function DownloadButton({ propertyId, format }: { propertyId: string; format: 'horizontal' | 'vertical' }) {
  const [preparing, setPreparing] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownload = async () => {
    setPreparing(true);
    setDownloadError(null);
    try {
      const res = await authedFetch(
        `/api/admin/studio/properties/${propertyId}/download?format=${format}`,
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        const msg = (d as { error?: string }).error ?? `HTTP ${res.status}`;
        console.error('Download failed:', msg);
        setDownloadError(msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Use the server-provided filename from Content-Disposition if available,
      // otherwise fall back to a generic name.
      const disposition = res.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      a.download = match?.[1] ?? `video-${format}.mp4`;
      a.click();
      // Revoke after a tick to allow the browser to begin the download
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Download failed';
      console.error('Download failed:', msg);
      setDownloadError(msg);
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {downloadError && (
        <span
          className="studio-error-strip"
          style={{ padding: '3px 8px', fontSize: 11.5 }}
        >
          {downloadError}
        </span>
      )}
      <button
        type="button"
        className="studio-btn-ghost studio-btn-sm"
        onClick={() => void handleDownload()}
        disabled={preparing}
      >
        {preparing ? (
          <Loader2 size={11} className="studio-spinner" />
        ) : (
          <Download size={11} strokeWidth={1.6} />
        )}
        {preparing ? 'Preparing…' : 'Download'}
      </button>
    </div>
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
      <span className="studio-section-eyebrow">{eyebrow}</span>
      <h3 className="studio-section-h3">{title}</h3>
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

  const [shareOpen, setShareOpen] = useState(false);
  const [shareLinks, setShareLinks] = useState<ShareLinks>({ client: null, public: null });

  const [advancePending, setAdvancePending] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [stagePending, setStagePending] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [resumePending, setResumePending] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestBundleRef = useRef<Bundle | null>(null);

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
      latestBundleRef.current = data;
      if (TERMINAL_STATUSES.has(data.property.status) && pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load property');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Smart poll scheduler — replaces a fixed 5s setInterval that ran forever on
  // any non-terminal status (including long operator-review gates like
  // needs_review/checkpoint_*), doing a full setBundle() re-render of the
  // whole page every 5s while an operator sat there for minutes.
  //
  //   - Paused entirely while the tab is hidden; resumes with one immediate
  //     fetch (+ the correct cadence for whatever it finds) as soon as the
  //     tab is shown again.
  //   - 5s cadence while the pipeline is actively working (see
  //     isActiveStage: scraping/generating/judging/assembling/voiceover/music,
  //     or the legacy autonomous-pipeline equivalents).
  //   - 30s cadence at long-dwell operator gates (needs_review, or a
  //     delivery-run checkpoint/details/photo-selection/intake/delivered
  //     stage) — the existing action handlers throughout this file already
  //     refetch immediately when the operator does something, so this tick
  //     is only a stale-data safety net there.
  //   - Stops entirely once the property reaches a terminal status.
  useEffect(() => {
    let cancelled = false;
    // Monotonic token for THIS scheduler's one live chain. Every (re)start —
    // initial mount, or a tab-show — bumps `generation` and captures it; any
    // older chain still awaiting a fetch sees its captured token != the live
    // one and bails (no reschedule, no post-unmount fetch/setState). Combined
    // with clearTimer() before every setTimeout, this guarantees exactly ONE
    // self-rescheduling timer, even when a visibilitychange fires while a
    // fetchBundle() is still in flight (which previously spawned a second,
    // untracked chain that compounded the poll rate and outlived unmount).
    let generation = 0;

    const clearTimer = () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };

    const scheduleNext = (gen: number) => {
      if (cancelled || gen !== generation) return;
      const data = latestBundleRef.current;
      if (data && TERMINAL_STATUSES.has(data.property.status)) return;
      if (document.hidden) return; // resumed by the visibilitychange listener below
      const delay = !data || isActiveStage(data) ? FAST_POLL_MS : SLOW_POLL_MS;
      clearTimer(); // never stack a second handle onto pollTimeoutRef
      pollTimeoutRef.current = setTimeout(() => void runCycle(gen), delay);
    };

    const runCycle = async (gen: number) => {
      if (cancelled || gen !== generation) return;
      await fetchBundle();
      // The fetch may have straddled an unmount or a tab-show that started a
      // newer chain — re-check before doing anything that touches state/timers.
      if (cancelled || gen !== generation) return;
      scheduleNext(gen);
    };

    const start = () => {
      clearTimer();
      generation += 1;
      void runCycle(generation);
    };

    start();

    const handleVisibility = () => {
      clearTimer();
      if (document.hidden) return; // paused — nothing runs until shown again
      // Tab just became visible: supersede any in-flight chain (start() bumps
      // the generation) and run one fresh cycle immediately so the operator
      // never looks at data that went stale while backgrounded.
      start();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimer();
    };
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

  const fetchShareLinks = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/admin/studio/properties/${id}/preview-links`);
      if (!res.ok) return;
      const data = (await res.json()) as ShareLinks;
      setShareLinks(data);
    } catch {
      // non-critical: fail silently; dialog will show "create" state
    }
  }, [id]);

  const handleOpenShare = async () => {
    await fetchShareLinks();
    setShareOpen(true);
  };

  const handleCreateLink = async (kind: 'client' | 'public') => {
    const res = await authedFetch(`/api/admin/studio/properties/${id}/preview-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    // Fetch the new link token from the server (create genuinely needs it).
    // Do NOT call fetchBundle() — that flips the command-center loading state
    // and remounts the whole page (spec §4b flash fix).
    await fetchShareLinks();
  };

  const handleToggle = async (pvId: string, field: ToggleField, value: boolean) => {
    // Optimistic update: find which kind owns this link id, capture prior value,
    // apply the update immediately in local state, fire PATCH in background,
    // and roll back on failure — never refetch (spec §4b flash fix).
    const kind = shareLinks.client?.id === pvId ? 'client' : 'public';
    const prior = shareLinks[kind];
    if (prior) {
      setShareLinks((prev) => ({
        ...prev,
        [kind]: { ...prior, [field]: value },
      }));
    }
    try {
      const res = await authedFetch(`/api/admin/studio/properties/${id}/preview-links/${pvId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      // Roll back the optimistic update on failure
      if (prior) {
        setShareLinks((prev) => ({ ...prev, [kind]: prior }));
      }
      throw err;
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
      // Prefer the human-readable `message` (e.g. the 502 generation-resume
      // detail, or the friendly 409 resume-in-progress copy) over the raw
      // `error` code so the inline strip reads sensibly, not "generation_
      // resume_failed" / "resume_already_in_progress".
      const dd = d as { error?: string; message?: string };
      throw new Error(dd.message ?? dd.error ?? `${res.status}`);
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
  // The Checkpoint B card (above, in the delivery stepper) already renders
  // the single video player for the run while it's under review — the
  // Output card must not render a second player for the same video (the
  // founder's "video shows up twice" complaint). Once the run leaves
  // checkpoint_b (delivered) or there's no active run, Output owns playback.
  const isReviewingAtCheckpointB = bundle.delivery_run?.stage === 'checkpoint_b';

  return (
    <StudioShell>
      {/* ─── Page heading ─── */}
      <div className="studio-page-heading">
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Link to="/dashboard/studio" className="studio-btn-ghost studio-btn-sm">
              <ArrowLeft size={11} strokeWidth={1.8} />
              Queue
            </Link>
            {client && (
              <>
                <span style={{ fontSize: 11.5, color: 'var(--le-muted-2)' }}>/</span>
                <Link
                  to={`/dashboard/studio/video/clients/${property.client_id}`}
                  className="studio-btn-ghost studio-btn-sm"
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
              maxWidth: '100%',
            }}
          >
            {property.address}
          </h1>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusPill status={property.status} />
            {bundle.delivery_run?.auto_run && (
              <AutopilotBadge paused={Boolean(bundle.delivery_run.paused_reason)} />
            )}
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
          {id && (
            <Link
              to={`/dashboard/studio/videos/${id}`}
              className="studio-btn-ghost studio-btn-sm"
              data-testid="open-video-hub"
            >
              Open video hub →
            </Link>
          )}
          <button
            type="button"
            className="studio-cta-primary"
            onClick={() => void handleOpenShare()}
          >
            <Share2 size={13} strokeWidth={1.8} />
            Share
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
          {/* ─── Checkpoint A: photo selection before paid generation ─── */}
          {bundle.delivery_run.stage === 'photo_selection' && (
            <PhotoCheckpointA runId={bundle.delivery_run.id} onChanged={fetchBundle} />
          )}
          {/* ─── Generating: prominent, idempotent Resume affordance (recovers a
               run stalled with all scenes needs_review + no clip, e.g. Atlas 402) ─── */}
          {bundle.delivery_run.stage === 'generating' && (
            <ResumeGenerationControls
              pending={resumePending}
              error={resumeError}
              onResume={async () => {
                setResumePending(true);
                setResumeError(null);
                try {
                  await deliveryAction({ action: 'rerun' });
                } catch (err) {
                  // fetchBundle already re-synced inside deliveryAction; surface error to operator
                  setResumeError(err instanceof Error ? err.message : 'Resume failed');
                } finally {
                  setResumePending(false);
                }
              }}
            />
          )}
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
              propertyId={property.id}
              // Prefer 16:9 for review, but fall back to 9:16 so a
              // vertical-only order (selected_orientation='vertical', no
              // horizontal_video_url) still shows a video at checkpoint B.
              videoUrl={property.horizontal_video_url ?? property.vertical_video_url}
              // HLS + poster matched to whichever orientation is shown above.
              // Poster falls back to a Bunny-derived frame (and null on legacy
              // rows) so the review gate never shows a blank box while loading.
              hlsUrl={property.horizontal_video_url ? property.horizontal_hls_url : property.vertical_hls_url}
              // Bunny iframe embed matched to whichever orientation is shown
              // above — null for provider-URL fallback rows (falls back to
              // the raw HlsPlayer inside CheckpointB).
              embedUrl={
                property.horizontal_video_url
                  ? bundle.final_video.horizontal?.embed_url ?? null
                  : bundle.final_video.vertical?.embed_url ?? null
              }
              posterUrl={
                (property.horizontal_video_url ? property.horizontal_poster_url : property.vertical_poster_url)
                ?? bunnyPosterUrl(property.horizontal_video_url ?? property.vertical_video_url)
              }
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
          <DeliveryStageControls
            stage={bundle.delivery_run.stage}
            pending={stagePending}
            error={stageError}
            onBack={async () => {
              setStagePending(true);
              setStageError(null);
              try {
                await deliveryAction({ action: 'back' });
              } catch (err) {
                setStageError(err instanceof Error ? err.message : 'Back failed');
              } finally {
                setStagePending(false);
              }
            }}
            onRerun={async () => {
              setStagePending(true);
              setStageError(null);
              try {
                await deliveryAction({ action: 'rerun' });
              } catch (err) {
                setStageError(err instanceof Error ? err.message : 'Rerun failed');
              } finally {
                setStagePending(false);
              }
            }}
          />
        </div>
      )}

      {/* ─── Autopilot panel (visible whenever a delivery_run exists, any stage).
           Renders a compact "Enable autopilot" affordance when auto_run=false,
           and the full panel + decision log when auto_run=true. ─── */}
      {bundle.delivery_run && (
        <AutopilotPanel
          runId={bundle.delivery_run.id}
          autoRun={bundle.delivery_run.auto_run}
          pausedReason={bundle.delivery_run.paused_reason}
          autoPausedAt={bundle.delivery_run.auto_paused_at}
          onAction={deliveryAction}
        />
      )}

      {/* ─── Section stack ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Final video ── */}
        <SectionCard eyebrow="Output" title="Final video">
          {property.status === 'complete' && (property.horizontal_video_url || property.vertical_video_url) ? (
            <div className="le-flexcol-lg" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {property.horizontal_video_url && (
                <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--le-muted)' }}>
                      Horizontal (16:9)
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <a
                        href={property.horizontal_video_url}
                        target="_blank"
                        rel="noreferrer"
                        className="studio-btn-ghost studio-btn-sm"
                      >
                        <ExternalLink size={11} strokeWidth={1.6} />
                        Open
                      </a>
                      <DownloadButton propertyId={property.id} format="horizontal" />
                    </div>
                  </div>
                  {isReviewingAtCheckpointB ? (
                    <div className="studio-kanban-empty" style={{ padding: '20px 16px', textAlign: 'center' }}>
                      <p style={{ fontSize: 12, color: 'var(--le-muted)' }}>
                        Playing above at Checkpoint B.
                      </p>
                    </div>
                  ) : (
                    <FinalVideoPlayer
                      embedUrl={bundle.final_video.horizontal?.embed_url ?? null}
                      mp4Url={property.horizontal_video_url}
                      hlsUrl={property.horizontal_hls_url}
                      posterUrl={property.horizontal_poster_url ?? bunnyPosterUrl(property.horizontal_video_url)}
                      title={`${property.address} — horizontal video`}
                      style={{ maxHeight: 320 }}
                    />
                  )}
                </div>
              )}
              {property.vertical_video_url && (
                <div style={{ flex: '0 0 180px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--le-muted)' }}>
                      Vertical (9:16)
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <a
                        href={property.vertical_video_url}
                        target="_blank"
                        rel="noreferrer"
                        className="studio-btn-ghost studio-btn-sm"
                      >
                        <ExternalLink size={11} strokeWidth={1.6} />
                        Open
                      </a>
                      <DownloadButton propertyId={property.id} format="vertical" />
                    </div>
                  </div>
                  {isReviewingAtCheckpointB ? (
                    <div className="studio-kanban-empty" style={{ padding: '20px 16px', textAlign: 'center' }}>
                      <p style={{ fontSize: 12, color: 'var(--le-muted)' }}>
                        Playing above at Checkpoint B.
                      </p>
                    </div>
                  ) : (
                    <FinalVideoPlayer
                      embedUrl={bundle.final_video.vertical?.embed_url ?? null}
                      mp4Url={property.vertical_video_url}
                      hlsUrl={property.vertical_hls_url}
                      posterUrl={property.vertical_poster_url ?? bunnyPosterUrl(property.vertical_video_url)}
                      title={`${property.address} — vertical video`}
                      aspect="9:16"
                      style={{ maxHeight: 320 }}
                    />
                  )}
                </div>
              )}
            </div>
          ) : property.status === 'complete' && scenes.some((s) => s.clip_url) ? (
            <div
              className="studio-kanban-empty"
              style={{ padding: 32, textAlign: 'center' }}
            >
              <p style={{ fontSize: 13.5, color: 'var(--le-muted)' }}>
                Stitched video unavailable (assembly failed) —{' '}
                <strong style={{ color: 'var(--le-ink)' }}>individual clips ready below.</strong>
              </p>
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
                  className="studio-card-flat"
                  style={{ padding: '12px 14px' }}
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
                        borderRadius: 999,
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
                    className="studio-card-flat"
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
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
            onClick={() => void handleOpenShare()}
          >
            <Share2 size={13} strokeWidth={1.8} />
            Manage share links
          </button>
        </SectionCard>

        {/* ── Brand kit summary ── */}
        <SectionCard eyebrow="Client" title="Brand kit">
          <p style={{ fontSize: 12.5, color: 'var(--le-muted-2)', marginBottom: 16 }}>
            The client's branding applied to this video — logo, colors, and agent card pulled from
            their client profile.
          </p>
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
                  src={photoThumb(client.brand_logo_url)}
                  alt={`${client.name} logo`}
                  loading="lazy"
                  decoding="async"
                  style={{ height: 40, maxWidth: 120, objectFit: 'contain' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--le-muted)' }}>Colors</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {client.brand_primary_hex ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span
                        style={{
                          width: 40,
                          height: 28,
                          borderRadius: "var(--le-r-sm)",
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
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span
                        style={{
                          width: 40,
                          height: 28,
                          borderRadius: "var(--le-r-sm)",
                          background: 'var(--le-line-2)',
                          border: '1px dashed var(--le-line)',
                          display: 'block',
                        }}
                      />
                      <span style={{ fontSize: 10, color: 'var(--le-muted-2)' }}>Not set</span>
                    </div>
                  )}
                  {client.brand_secondary_hex ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span
                        style={{
                          width: 40,
                          height: 28,
                          borderRadius: "var(--le-r-sm)",
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
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span
                        style={{
                          width: 40,
                          height: 28,
                          borderRadius: "var(--le-r-sm)",
                          background: 'var(--le-line-2)',
                          border: '1px dashed var(--le-line)',
                          display: 'block',
                        }}
                      />
                      <span style={{ fontSize: 10, color: 'var(--le-muted-2)' }}>Not set</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--le-muted)' }}>Agent</span>
                {client.agent_name || client.agent_headshot_url ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {client.agent_headshot_url && (
                      <img
                        src={photoThumb(client.agent_headshot_url)}
                        alt={client.agent_name ?? 'Agent'}
                        loading="lazy"
                        decoding="async"
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
                ) : (
                  <span style={{ fontSize: 12.5, color: 'var(--le-muted-2)' }}>Not set</span>
                )}
              </div>
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
                  .map(([provider, cents]) => {
                    const detail = cost.by_provider_detail?.[provider];
                    return (
                      <tr key={provider} style={{ borderBottom: '1px solid var(--le-line-2)' }}>
                        <td style={{ padding: '10px 0' }}>
                          <div
                            style={{
                              fontSize: 13,
                              color: 'var(--le-ink-2)',
                              textTransform: 'capitalize',
                            }}
                          >
                            {provider}
                          </div>
                          {detail && (
                            <div style={{ fontSize: 11, color: 'var(--le-muted-2)', marginTop: 2 }}>
                              {detail.event_count} {detail.event_count === 1 ? 'event' : 'events'}
                              {detail.rerender_count > 0 && (
                                <>
                                  {' — includes '}
                                  {detail.rerender_count}
                                  {' discarded QC re-render'}
                                  {detail.rerender_count === 1 ? '' : 's'}
                                  {' (-'}
                                  {formatCents(detail.rerender_cents)}
                                  {' of this total)'}
                                </>
                              )}
                            </div>
                          )}
                        </td>
                        <td
                          style={{
                            padding: '10px 0',
                            textAlign: 'right',
                            fontSize: 13,
                            color: 'var(--le-ink)',
                            fontVariantNumeric: 'tabular-nums',
                            verticalAlign: 'top',
                          }}
                        >
                          {formatCents(cents)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: 'var(--le-muted-2)' }}>No cost events yet.</p>
          )}

          {Object.keys(cost.by_provider).length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--le-muted-2)', marginTop: 10 }}>
              Every provider call is logged, including $0 events.
            </p>
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

      {shareOpen && (
        <ShareDialog
          propertyId={id ?? ''}
          baseUrl={baseUrl}
          links={shareLinks}
          onCreateLink={handleCreateLink}
          onToggle={handleToggle}
          onClose={() => setShareOpen(false)}
        />
      )}
    </StudioShell>
  );
};

export default PropertyCommandCenter;
