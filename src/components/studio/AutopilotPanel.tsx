/**
 * AutopilotPanel — command-center section for autopilot delivery runs.
 *
 * Two modes:
 *  - autoRun=false: compact "Enable autopilot" affordance (POSTs set_auto_run {enabled:true})
 *  - autoRun=true:  full panel — Pause/Take-over + Resume + decision log
 *
 * Decision log maps the ACTUAL ml_events payload keys written by auto-run.ts:
 *   checkpoint_a → confidence + margins
 *   details      → confidence + fields_present
 *   voiceover    → voice_id + tone_pick
 *   music        → mood + music_track_id
 *   checkpoint_b → score (confidence alias)
 *   auto_pause   → reason
 *
 * Action dispatch is delegated to the parent via onAction so deliveryAction
 * (which already re-syncs the bundle) is reused — no duplicate fetch logic here.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertTriangle, Pause, Play, Zap } from 'lucide-react';
import { authedFetch } from '@/lib/api';
import { getRelativeTime } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MlEventPayload {
  source?: string;
  gate?: string;
  confidence?: number;
  // checkpoint_a
  margins?: Array<{ sceneId: string; margin: number }>;
  // details
  fields_present?: string[];
  // voiceover
  voice_id?: string;
  tone_pick?: string;
  // music
  mood?: string;
  music_track_id?: string;
  // checkpoint_b
  score?: number;
  confident_scenes?: number;
  degraded_scenes?: number;
  // auto_pause events (from pauseForHuman)
  reason?: string;
}

interface MlEvent {
  id: string;
  event_type: string;
  payload: MlEventPayload;
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

// ─── Per-gate event description ────────────────────────────────────────────────

/**
 * Produces a short human-readable summary for each gate's ml_event payload.
 * Reads the actual keys written by auto-run.ts resolvers, not fictional keys.
 */
function describeEvent(pl: MlEventPayload, eventType: string): string {
  // Pause events always surface their reason (auto_pause type, or payloads with reason + no gate)
  if (eventType === 'auto_pause' || (!pl.gate && pl.reason)) {
    return pl.reason ?? 'Paused — waiting for human review';
  }

  switch (pl.gate) {
    case 'checkpoint_a': {
      const margin =
        typeof pl.confidence === 'number' ? pl.confidence.toFixed(2) : '—';
      return `Checkpoint A — confident (avg margin ${margin})`;
    }
    case 'details':
      return 'Details — all fields present';
    case 'voiceover': {
      const voice = pl.voice_id ?? '—';
      const tone = pl.tone_pick ? ` (${pl.tone_pick})` : '';
      return `Voiceover — picked voice ${voice}${tone}`;
    }
    case 'music': {
      const mood = pl.mood ?? '—';
      const track = pl.music_track_id ?? '—';
      return `Music — mood ${mood}, track ${track}`;
    }
    case 'checkpoint_b': {
      const score =
        typeof pl.score === 'number'
          ? pl.score.toFixed(2)
          : typeof pl.confidence === 'number'
            ? pl.confidence.toFixed(2)
            : '—';
      return `Checkpoint B — quality ${score}`;
    }
    default:
      return pl.gate ? `${pl.gate} — advanced` : 'Autopilot advanced';
  }
}

// ─── Pause-reason → actionable guidance ────────────────────────────────────────

/**
 * Maps a `paused_reason` string to one actionable next-step sentence for the
 * founder. Two recognized shapes today (both written by lib/delivery/auto-run.ts):
 *   - resolveCheckpointA: "generation incomplete: N of M scenes have no clip (scenes ...)"
 *   - resolveCheckpointB: "Final video scored X (needs Y): ..." (and its sibling
 *     run-error / empty-run variants, which also read as quality/delivery issues)
 *
 * Anything else — including legacy `paused_reason` values already sitting in
 * prod rows from before this format existed (e.g. old "quality below threshold:
 * X < Y" or "low judge margin on scene ...") — falls through to the generic
 * Checkpoint B guidance. This function never throws on unrecognized input; it
 * only ever does a case-insensitive substring match.
 */
export function getPauseGuidance(reason: string | null | undefined): string {
  if (!reason) return '';
  if (/generation incomplete/i.test(reason)) {
    return 'Generate or fix the missing scenes, then resume autopilot.';
  }
  return 'Review the video at Checkpoint B, then resume or take over.';
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

  const [enablePending, setEnablePending] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
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
        (e) => (e.payload as MlEventPayload).source === 'auto',
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

  const handleEnable = async () => {
    setEnablePending(true);
    setEnableError(null);
    try {
      await onAction({ action: 'set_auto_run', enabled: true });
    } catch (err) {
      setEnableError(err instanceof Error ? err.message : 'Enable failed');
    } finally {
      setEnablePending(false);
    }
  };

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

  // ── Compact enable affordance (autopilot is off) ───────────────────────────

  if (!autoRun) {
    return (
      <div
        className="studio-card"
        style={{
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={13} strokeWidth={1.8} style={{ color: 'var(--le-muted)' }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--le-ink)' }}>
            Autopilot
          </span>
          <span style={{ fontSize: 12, color: 'var(--le-muted-2)', fontWeight: 400 }}>
            — off
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {enableError && (
            <span
              className="studio-error-strip"
              style={{ padding: '3px 8px', fontSize: 11.5 }}
            >
              {enableError}
            </span>
          )}
          <button
            type="button"
            className="studio-cta-primary"
            style={{
              fontSize: 12,
              padding: '6px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            disabled={enablePending}
            onClick={() => void handleEnable()}
            data-testid="autopilot-enable-btn"
          >
            {enablePending ? (
              <Loader2 size={12} className="studio-spinner" />
            ) : (
              <Zap size={12} strokeWidth={2} />
            )}
            Enable autopilot
          </button>
        </div>
      </div>
    );
  }

  // ── Full panel (autopilot is on) ───────────────────────────────────────────

  return (
    <div
      className="studio-card"
      style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {/* Header + action buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--le-ink)' }}>
          Autopilot
        </span>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isPaused ? (
            <button
              type="button"
              className="studio-cta-primary"
              style={{
                fontSize: 12,
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
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
          ) : (
            <button
              type="button"
              className="studio-btn-ghost"
              style={{
                fontSize: 12,
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
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
          )}
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

      {/* Paused banner */}
      {isPaused && (
        <div className="studio-warn-strip">
          <AlertTriangle size={14} strokeWidth={1.6} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 13 }}>
              Autopilot paused — needs your review
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
            {pausedReason && (
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  fontWeight: 600,
                }}
              >
                {getPauseGuidance(pausedReason)}
              </p>
            )}
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
              const pl = ev.payload as MlEventPayload;
              const isLast = idx === events.length - 1;
              const summary = describeEvent(pl, ev.event_type);

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

                    <p
                      style={{
                        margin: '2px 0 0',
                        fontSize: 12,
                        color: 'var(--le-muted)',
                        lineHeight: 1.45,
                      }}
                    >
                      {summary}
                    </p>
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
