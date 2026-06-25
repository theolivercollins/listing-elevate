/**
 * AutopilotPanel — command-center section for autopilot-enabled delivery runs.
 *
 * Renders:
 *  - Pause / Take over button  (when autoRun && !paused)
 *  - Resume autopilot button   (when paused)
 *  - Paused banner with reason (when pausedReason is set)
 *  - Decision log: timeline of ml_events where payload.source === 'auto'
 *
 * The component fetches ml_events from the delivery GET endpoint on mount.
 * If the endpoint doesn't yet return ml_events the log shows gracefully empty.
 *
 * Action dispatch is delegated back to the parent via onAction so the parent's
 * deliveryAction helper (which already re-syncs the bundle) is reused —
 * no duplicate fetch logic here.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertTriangle, Pause, Play } from 'lucide-react';
import { authedFetch } from '@/lib/api';
import { getRelativeTime } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MlEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface DeliveryBundleWithEvents {
  ml_events?: MlEvent[];
}

export interface AutopilotPanelProps {
  runId: string;
  autoRun: boolean;
  pausedReason: string | null;
  autoPausedAt: string | null;
  /** Parent's deliveryAction helper — handles POST + re-fetch. */
  onAction: (body: Record<string, unknown>) => Promise<void>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AutopilotPanel({
  runId,
  autoRun,
  pausedReason,
  autoPausedAt,
  onAction,
}: AutopilotPanelProps) {
  const [events, setEvents] = useState<MlEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  const [pausePending, setPausePending] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [resumePending, setResumePending] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const isPaused = Boolean(pausedReason);

  // ── Fetch decision-log events ──────────────────────────────────────────────

  const loadEvents = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`);
      if (!res.ok) return;
      const data = (await res.json()) as DeliveryBundleWithEvents;
      const autoEvents = (data.ml_events ?? []).filter(
        (e) => (e.payload as { source?: string }).source === 'auto',
      );
      setEvents(autoEvents);
    } catch {
      // Non-critical: log stays empty if the endpoint doesn't yet return ml_events.
    } finally {
      setLoadingEvents(false);
    }
  }, [runId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  // ── Action handlers ────────────────────────────────────────────────────────

  const handlePause = async () => {
    setPausePending(true);
    setPauseError(null);
    try {
      await onAction({ action: 'set_auto_run', enabled: false });
    } catch (err) {
      setPauseError(err instanceof Error ? err.message : 'Pause failed');
    } finally {
      setPausePending(false);
    }
  };

  const handleResume = async () => {
    setResumePending(true);
    setResumeError(null);
    try {
      await onAction({ action: 'resume_autopilot' });
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Resume failed');
    } finally {
      setResumePending(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="studio-card"
      style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {/* Header + action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--le-ink)' }}>
          Autopilot
        </span>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isPaused ? (
            <button
              type="button"
              className="studio-cta-primary"
              style={{ fontSize: 12, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
              disabled={resumePending}
              onClick={() => void handleResume()}
              data-testid="autopilot-resume-btn"
            >
              {resumePending ? (
                <Loader2 size={12} className="studio-spinner" />
              ) : (
                <Play size={12} strokeWidth={2} />
              )}
              Resume autopilot
            </button>
          ) : autoRun ? (
            <button
              type="button"
              className="studio-btn-ghost"
              style={{ fontSize: 12, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
              disabled={pausePending}
              onClick={() => void handlePause()}
              data-testid="autopilot-pause-btn"
            >
              {pausePending ? (
                <Loader2 size={12} className="studio-spinner" />
              ) : (
                <Pause size={12} strokeWidth={2} />
              )}
              Take over / Pause
            </button>
          ) : null}
        </div>
      </div>

      {/* Action error strips */}
      {pauseError && (
        <div className="studio-error-strip" style={{ padding: '6px 10px', fontSize: 12 }}>
          {pauseError}
        </div>
      )}
      {resumeError && (
        <div className="studio-error-strip" style={{ padding: '6px 10px', fontSize: 12 }}>
          {resumeError}
        </div>
      )}

      {/* Paused banner — prompts operator to finish this gate manually */}
      {isPaused && (
        <div className="studio-warn-strip">
          <AlertTriangle size={14} strokeWidth={1.6} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 13 }}>
              Autopilot paused
              {autoPausedAt && (
                <span
                  style={{
                    fontWeight: 400,
                    fontSize: 12,
                    color: 'var(--le-warn)',
                    marginLeft: 8,
                  }}
                >
                  {getRelativeTime(autoPausedAt)}
                </span>
              )}
            </p>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
              {pausedReason}
            </p>
          </div>
        </div>
      )}

      {/* Decision log */}
      <div>
        <span
          style={{
            display: 'block',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'var(--le-muted)',
            marginBottom: 8,
          }}
        >
          Decision log
        </span>

        {loadingEvents ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12.5,
              color: 'var(--le-muted-2)',
            }}
          >
            <Loader2 size={12} className="studio-spinner" />
            Loading…
          </div>
        ) : events.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--le-muted-2)', margin: 0 }}>
            No autopilot decisions yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {events.map((ev, idx) => {
              const pl = ev.payload as {
                gate?: string;
                choice?: string;
                confidence?: number;
                reason?: string;
              };
              const isLast = idx === events.length - 1;

              return (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    paddingBottom: isLast ? 0 : 12,
                    position: 'relative',
                  }}
                >
                  {/* Vertical timeline connector */}
                  {!isLast && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 5,
                        top: 14,
                        bottom: 0,
                        width: 1,
                        background: 'var(--le-line)',
                      }}
                    />
                  )}

                  {/* Dot */}
                  <div style={{ flexShrink: 0, marginTop: 3 }}>
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        border: '1.5px solid var(--le-line)',
                        background: 'var(--le-surface)',
                        position: 'relative',
                        zIndex: 1,
                      }}
                    />
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        marginBottom: pl.reason ? 4 : 0,
                      }}
                    >
                      {pl.gate && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '1px 7px',
                            borderRadius: 'var(--le-r-sm)',
                            background: 'rgba(0,0,0,0.06)',
                            color: 'var(--le-ink)',
                          }}
                        >
                          {pl.gate}
                        </span>
                      )}
                      {pl.choice && (
                        <span
                          style={{
                            fontSize: 12,
                            color: 'var(--le-ink-2)',
                            fontWeight: 500,
                          }}
                        >
                          {pl.choice}
                        </span>
                      )}
                      {pl.confidence !== undefined && (
                        <span
                          style={{
                            fontSize: 11,
                            fontVariantNumeric: 'tabular-nums',
                            color:
                              pl.confidence >= 0.8
                                ? 'var(--le-good)'
                                : pl.confidence >= 0.5
                                  ? 'var(--le-warn)'
                                  : 'var(--le-bad)',
                          }}
                        >
                          {Math.round(pl.confidence * 100)}% confidence
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--le-muted-2)',
                          marginLeft: 'auto',
                          flexShrink: 0,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {getRelativeTime(ev.created_at)}
                      </span>
                    </div>

                    {pl.reason && (
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: 'var(--le-muted)',
                          lineHeight: 1.45,
                        }}
                      >
                        {pl.reason}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
