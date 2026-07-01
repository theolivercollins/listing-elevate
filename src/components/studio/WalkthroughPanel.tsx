/**
 * WalkthroughPanel — opt-in "Walkthrough (beta)" section for the Operator
 * Studio command center. Fully additive: lets an operator generate a single
 * continuous AI walkthrough video for a property, watch its status, and
 * preview the result. Does not touch the existing delivery pipeline.
 *
 * - "Generate walkthrough" POSTs /api/admin/studio/walkthrough/:propertyId.
 *   `skipped` (writes disabled on non-prod) surfaces the server's `reason`.
 *   `processing` starts polling.
 * - Polls GET .../walkthrough/:propertyId every ~8s while status is
 *   'processing'; the render takes ~8 minutes so this can run a while.
 *   Interval is cleared on unmount and on any terminal status.
 * - On mount, fetches status once so a mid-render refresh still shows
 *   progress (or the finished video) instead of resetting to idle.
 * - 'complete' renders an inline <video controls> + download link.
 * - 'failed' shows the error and re-enables the button to retry.
 */

import { useEffect, useState } from 'react';
import { Loader2, Download, Sparkles } from 'lucide-react';
import { submitWalkthrough, getWalkthroughStatus } from '@/lib/api';

const POLL_INTERVAL_MS = 8_000;

export interface WalkthroughPanelProps {
  propertyId: string;
}

type WalkthroughStatus = 'idle' | 'processing' | 'complete' | 'failed';

function formatElapsed(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function StatusPill({ status }: { status: WalkthroughStatus }) {
  const map: Record<WalkthroughStatus, { label: string; cls: string }> = {
    idle: { label: 'Not started', cls: 'queued' },
    processing: { label: 'Generating…', cls: 'generating' },
    complete: { label: 'Complete', cls: 'complete' },
    failed: { label: 'Failed', cls: 'failed' },
  };
  const s = map[status];
  return (
    <span className={`studio-status-pill ${s.cls}`}>
      <span className="studio-status-dot" />
      {s.label}
    </span>
  );
}

export function WalkthroughPanel({ propertyId }: WalkthroughPanelProps) {
  const [status, setStatus] = useState<WalkthroughStatus>('idle');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [skippedReason, setSkippedReason] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Restore state on mount — a refresh mid-render should show progress
  // (or the finished video) instead of resetting to idle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getWalkthroughStatus(propertyId);
        if (cancelled) return;
        setStatus(res.status);
        setVideoUrl(res.videoUrl ?? null);
        setJobError(res.error ?? null);
      } catch {
        // No prior job / transient fetch failure — stay idle silently, the
        // operator can still press Generate.
      }
    })();
    return () => { cancelled = true; };
  }, [propertyId]);

  // Poll while processing; clears on unmount and on any terminal status.
  useEffect(() => {
    if (status !== 'processing') return;
    const startedAt = Date.now();
    setElapsedSec(0);
    const tick = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    const poll = setInterval(async () => {
      try {
        const res = await getWalkthroughStatus(propertyId);
        setStatus(res.status);
        setVideoUrl(res.videoUrl ?? null);
        setJobError(res.error ?? null);
      } catch {
        // Transient network error — keep polling, don't flip to failed.
      }
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [status, propertyId]);

  const handleGenerate = async () => {
    setSubmitting(true);
    setSubmitError(null);
    setSkippedReason(null);
    setJobError(null);
    try {
      const res = await submitWalkthrough(propertyId);
      if (res.status === 'skipped') {
        setSkippedReason(res.reason ?? 'Walkthrough generation is disabled in this environment.');
      } else {
        setStatus('processing');
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to start walkthrough generation');
    } finally {
      setSubmitting(false);
    }
  };

  const buttonDisabled = submitting || status === 'processing';
  const buttonLabel = submitting
    ? 'Starting…'
    : status === 'processing'
    ? 'Generating…'
    : status === 'failed'
    ? 'Retry'
    : status === 'complete'
    ? 'Regenerate walkthrough'
    : 'Generate walkthrough';

  return (
    <div className="studio-card" style={{ padding: 24 }}>
      <span className="studio-section-eyebrow">Beta</span>
      <h3 className="studio-section-h3">Walkthrough (beta)</h3>
      <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--le-muted)', lineHeight: 1.5 }}>
        Generate a single continuous AI walkthrough from this listing&rsquo;s photos — experimental.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="studio-cta-primary"
          disabled={buttonDisabled}
          onClick={() => void handleGenerate()}
        >
          {(submitting || status === 'processing') ? (
            <Loader2 size={13} className="studio-spinner" />
          ) : (
            <Sparkles size={13} strokeWidth={1.8} />
          )}
          {buttonLabel}
        </button>
        {status !== 'idle' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusPill status={status} />
            {status === 'processing' && (
              <span
                className="studio-tabnum"
                style={{ fontSize: 12, color: 'var(--le-muted-2)' }}
              >
                {formatElapsed(elapsedSec)}
              </span>
            )}
          </div>
        )}
      </div>

      {skippedReason && (
        <div className="studio-warn-strip" style={{ marginTop: 14 }}>
          {skippedReason}
        </div>
      )}

      {submitError && (
        <div className="studio-error-strip" style={{ marginTop: 14 }}>
          {submitError}
        </div>
      )}

      {status === 'failed' && jobError && (
        <div className="studio-error-strip" style={{ marginTop: 14 }}>
          {jobError}
        </div>
      )}

      {status === 'complete' && videoUrl && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480 }}>
          <video src={videoUrl} controls className="studio-video" />
          <a
            href={videoUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="studio-btn-ghost studio-btn-sm"
            style={{ alignSelf: 'flex-start' }}
          >
            <Download size={11} strokeWidth={1.6} />
            Download
          </a>
        </div>
      )}
    </div>
  );
}
