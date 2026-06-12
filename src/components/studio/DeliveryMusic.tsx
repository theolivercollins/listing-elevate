/**
 * DeliveryMusic — Music step UI for the operator delivery pipeline.
 *
 * Layout:
 *  1. Fetches GET /api/admin/studio/music-options?video_type={run.video_type}
 *     → renders up to 3 radio cards (name + <audio controls> preview + mood chip).
 *  2. Selecting a card POSTs set_music {music_track_id, source:'library'}.
 *  3. "Generate 4 variations" POSTs generate_music, which now returns an array
 *     of TrackOption[] (up to 4). The cards are appended as a visually grouped
 *     block labelled by genre. No auto-selection.
 *  4. Every track card has ThumbsUp/ThumbsDown feedback controls.
 *     Verdict is optimistic; a comment input reveals after any verdict.
 *     Down-voting an AI-generated track adds a "Won't be reused" note.
 *
 * The shared DeliveryNextButton (in PropertyCommandCenter) advances music → assembling.
 * Skip is allowed — assembly can proceed without an explicit music selection.
 */

import { useState, useEffect, useRef } from 'react';
import { Loader2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { authedFetch } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type TrackGenre = 'acoustic' | 'orchestral' | 'ambient' | 'modern' | null;

interface TrackOption {
  id: string;
  name: string;
  file_url: string;
  mood_tag: string;
  source: string;
  genre: TrackGenre;
}

// Backwards compat: library tracks from GET music-options don't carry genre
interface MusicTrack extends TrackOption {}

interface MusicOptionsResponse {
  mood: string;
  tracks: MusicTrack[];
}

interface GenerateMusicResponse {
  tracks: TrackOption[];
  failures: number;
  fallback?: boolean;
  warning?: string;
}

interface DeliveryMusicProps {
  runId: string;
  videoType: string;
  /** Pre-loaded from bundle.delivery_run */
  musicTrackId: string | null;
  onChanged: () => void;
}

// ─── Per-card feedback state ──────────────────────────────────────────────────

interface CardFeedback {
  verdict?: 'up' | 'down';
  comment: string;
  status: 'idle' | 'saving' | 'error';
  errorMsg?: string;
}

function genreLabel(genre: TrackGenre): string {
  if (!genre) return 'Library';
  return genre.charAt(0).toUpperCase() + genre.slice(1);
}

// ─── TrackCard sub-component ──────────────────────────────────────────────────

interface TrackCardProps {
  track: TrackOption;
  isSelected: boolean;
  disabled: boolean;
  feedback: CardFeedback;
  onSelect: (trackId: string, source: 'library' | 'generated') => void;
  onVote: (trackId: string, verdict: 'up' | 'down') => void;
  onComment: (trackId: string, comment: string) => void;
}

function TrackCard({ track, isSelected, disabled, feedback, onSelect, onVote, onComment }: TrackCardProps) {
  const commentRef = useRef<HTMLInputElement>(null);
  const isAiGenerated = track.source === 'elevenlabs_music';
  const showWontReuse = isAiGenerated && feedback.verdict === 'down';

  const handleVote = (verdict: 'up' | 'down') => {
    // Toggle off if clicking the already-active verdict
    if (feedback.verdict === verdict) return;
    onVote(track.id, verdict);
  };

  const handleCommentSubmit = () => {
    const val = commentRef.current?.value ?? feedback.comment;
    if (val !== feedback.comment) {
      onComment(track.id, val);
    }
  };

  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCommentSubmit();
    }
  };

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 'var(--le-radius-sm)',
        border: `1.5px solid ${isSelected ? 'var(--le-ink)' : 'var(--le-line)'}`,
        background: isSelected ? 'rgba(11,11,16,0.04)' : 'var(--le-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color 120ms, background 120ms',
      }}
    >
      {/* Track name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--le-ink)', flex: 1, minWidth: 0 }}>
          {track.name}
        </span>

        {isAiGenerated && (
          <span
            className="studio-status-pill"
            style={{
              fontSize: 10,
              padding: '2px 6px',
              background: 'rgba(11,11,16,0.05)',
              color: 'var(--le-muted)',
              borderRadius: 'var(--le-radius-sm)',
            }}
          >
            AI generated
          </span>
        )}

        {!isSelected ? (
          <button
            type="button"
            className="studio-btn-ghost studio-btn-sm"
            disabled={disabled}
            onClick={() => onSelect(track.id, isAiGenerated ? 'generated' : 'library')}
          >
            Select
          </button>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--le-good)', fontWeight: 600 }}>
            Selected
          </span>
        )}
      </div>

      {/* Audio preview */}
      <audio
        controls
        src={track.file_url}
        style={{ width: '100%', maxWidth: 480 }}
        preload="none"
      />

      {/* Feedback controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* ThumbsUp */}
        <button
          type="button"
          aria-label="Helpful — thumbs up"
          aria-pressed={feedback.verdict === 'up'}
          disabled={feedback.status === 'saving'}
          onClick={() => handleVote('up')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 'var(--le-radius-pill)',
            border: `1px solid ${feedback.verdict === 'up' ? 'var(--le-good)' : 'var(--le-line)'}`,
            background: feedback.verdict === 'up' ? 'rgba(47,138,85,0.10)' : 'transparent',
            color: feedback.verdict === 'up' ? 'var(--le-good)' : 'var(--le-muted)',
            cursor: feedback.status === 'saving' ? 'not-allowed' : 'pointer',
            fontSize: 11,
            fontWeight: 500,
            transition: 'border-color 120ms, background 120ms, color 120ms',
            outline: 'none',
          }}
          onFocus={(e) => { e.currentTarget.style.outline = '2px solid var(--le-accent)'; e.currentTarget.style.outlineOffset = '2px'; }}
          onBlur={(e) => { e.currentTarget.style.outline = 'none'; }}
          onMouseEnter={(e) => {
            if (feedback.verdict !== 'up') {
              e.currentTarget.style.borderColor = 'var(--le-good)';
              e.currentTarget.style.color = 'var(--le-good)';
            }
          }}
          onMouseLeave={(e) => {
            if (feedback.verdict !== 'up') {
              e.currentTarget.style.borderColor = 'var(--le-line)';
              e.currentTarget.style.color = 'var(--le-muted)';
            }
          }}
        >
          <ThumbsUp
            size={12}
            fill={feedback.verdict === 'up' ? 'currentColor' : 'none'}
          />
          <span>Good</span>
        </button>

        {/* ThumbsDown */}
        <button
          type="button"
          aria-label="Not helpful — thumbs down"
          aria-pressed={feedback.verdict === 'down'}
          disabled={feedback.status === 'saving'}
          onClick={() => handleVote('down')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 'var(--le-radius-pill)',
            border: `1px solid ${feedback.verdict === 'down' ? 'var(--le-bad)' : 'var(--le-line)'}`,
            background: feedback.verdict === 'down' ? 'rgba(196,74,74,0.10)' : 'transparent',
            color: feedback.verdict === 'down' ? 'var(--le-bad)' : 'var(--le-muted)',
            cursor: feedback.status === 'saving' ? 'not-allowed' : 'pointer',
            fontSize: 11,
            fontWeight: 500,
            transition: 'border-color 120ms, background 120ms, color 120ms',
            outline: 'none',
          }}
          onFocus={(e) => { e.currentTarget.style.outline = '2px solid var(--le-accent)'; e.currentTarget.style.outlineOffset = '2px'; }}
          onBlur={(e) => { e.currentTarget.style.outline = 'none'; }}
          onMouseEnter={(e) => {
            if (feedback.verdict !== 'down') {
              e.currentTarget.style.borderColor = 'var(--le-bad)';
              e.currentTarget.style.color = 'var(--le-bad)';
            }
          }}
          onMouseLeave={(e) => {
            if (feedback.verdict !== 'down') {
              e.currentTarget.style.borderColor = 'var(--le-line)';
              e.currentTarget.style.color = 'var(--le-muted)';
            }
          }}
        >
          <ThumbsDown
            size={12}
            fill={feedback.verdict === 'down' ? 'currentColor' : 'none'}
          />
          <span>Poor</span>
        </button>

        {/* Saving indicator */}
        {feedback.status === 'saving' && (
          <Loader2 size={11} className="studio-spinner" style={{ color: 'var(--le-muted)' }} />
        )}

        {/* "Won't be reused" notice for down-voted AI tracks */}
        {showWontReuse && (
          <span style={{ fontSize: 11, color: 'var(--le-muted)', fontStyle: 'italic' }}>
            Won&rsquo;t be reused
          </span>
        )}

        {/* Inline error */}
        {feedback.status === 'error' && feedback.errorMsg && (
          <span style={{ fontSize: 11, color: 'var(--le-bad)' }}>
            {feedback.errorMsg}
          </span>
        )}
      </div>

      {/* Comment input — shown only after a verdict is set */}
      {feedback.verdict && (
        <input
          ref={commentRef}
          type="text"
          className="studio-input"
          style={{ fontSize: 12, padding: '6px 10px' }}
          placeholder="Optional: what worked / what didn't?"
          defaultValue={feedback.comment}
          onKeyDown={handleCommentKeyDown}
          onBlur={handleCommentSubmit}
          aria-label="Feedback comment"
        />
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeliveryMusic({
  runId,
  videoType,
  musicTrackId,
  onChanged,
}: DeliveryMusicProps) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [mood, setMood] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(musicTrackId);
  const [selecting, setSelecting] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generationWarning, setGenerationWarning] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<{ trackName: string; warning: string } | null>(null);

  // Generated track groups: array of arrays (one group per "Generate 4 variations" call)
  const [generatedGroups, setGeneratedGroups] = useState<TrackOption[][]>([]);

  // Per-card feedback state keyed by track id
  const [feedbackMap, setFeedbackMap] = useState<Record<string, CardFeedback>>({});

  // Load library tracks for the run's video_type
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    authedFetch(`/api/admin/studio/music-options?video_type=${encodeURIComponent(videoType)}`)
      .then((r) => r.json())
      .then((d: MusicOptionsResponse) => {
        if (cancelled) return;
        setTracks(d.tracks ?? []);
        setMood(d.mood ?? null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load tracks');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [videoType]);

  // Sync selectedId when parent re-syncs bundle
  useEffect(() => { setSelectedId(musicTrackId); }, [musicTrackId]);

  // ─── Feedback helpers ────────────────────────────────────────────────────────

  const getFeedback = (trackId: string): CardFeedback =>
    feedbackMap[trackId] ?? { comment: '', status: 'idle' };

  const patchFeedback = (trackId: string, patch: Partial<CardFeedback>) => {
    setFeedbackMap((prev) => ({
      ...prev,
      [trackId]: { ...getFeedback(trackId), ...patch },
    }));
  };

  const postMusicFeedback = async (
    trackId: string,
    verdict: 'up' | 'down',
    comment?: string,
  ) => {
    patchFeedback(trackId, { verdict, status: 'saving', errorMsg: undefined });
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'music_feedback',
          track_id: trackId,
          verdict,
          ...(comment !== undefined ? { comment } : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      patchFeedback(trackId, { status: 'idle' });
    } catch (err) {
      // Revert optimistic verdict on failure
      patchFeedback(trackId, {
        verdict: undefined,
        status: 'error',
        errorMsg: err instanceof Error ? err.message : 'Feedback failed',
      });
    }
  };

  const handleVote = (trackId: string, verdict: 'up' | 'down') => {
    const existing = getFeedback(trackId);
    postMusicFeedback(trackId, verdict, existing.comment || undefined);
  };

  const handleComment = (trackId: string, comment: string) => {
    const existing = getFeedback(trackId);
    if (!existing.verdict) return; // no verdict yet — nothing to upsert
    patchFeedback(trackId, { comment });
    postMusicFeedback(trackId, existing.verdict, comment);
  };

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectTrack = async (trackId: string, source: 'library' | 'generated') => {
    if (trackId === selectedId) return;
    setSelecting(true);
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_music', music_track_id: trackId, source }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setSelectedId(trackId);
      onChanged();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Track selection failed');
    } finally {
      setSelecting(false);
    }
  };

  const handleGenerateNew = async () => {
    setGenerating(true);
    setGenerateError(null);
    setGenerationWarning(null);
    setFallbackNotice(null);
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_music' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const d = await res.json() as GenerateMusicResponse;

      // Append the new batch as its own group (preserving order of multiple calls)
      if (d.tracks && d.tracks.length > 0) {
        setGeneratedGroups((prev) => [...prev, d.tracks]);
      }

      if (d.fallback) {
        // Server fell back — at least one track is a library fallback
        const firstName = d.tracks[0]?.name ?? 'library track';
        setFallbackNotice({ trackName: firstName, warning: d.warning ?? '' });
      } else if (d.failures > 0) {
        // Partial generation — some tracks failed
        setGenerationWarning(
          d.warning
            ? d.warning
            : `${d.failures} variation${d.failures > 1 ? 's' : ''} could not be generated.`,
        );
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Music generation failed');
    } finally {
      setGenerating(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="studio-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Eyebrow */}
      <span
        style={{
          display: 'block',
          fontSize: 11.5,
          fontWeight: 500,
          color: 'var(--le-muted)',
          marginBottom: -16,
        }}
      >
        Operator &middot; Step
      </span>

      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            color: 'var(--le-ink)',
          }}
        >
          Music
        </h3>
        {mood && (
          <span
            className="studio-status-pill"
            style={{
              fontSize: 11,
              padding: '3px 8px',
              background: 'rgba(42,111,219,0.08)',
              color: 'var(--le-accent)',
              borderRadius: 'var(--le-radius-sm)',
              textTransform: 'capitalize',
            }}
          >
            {mood}
          </span>
        )}
      </div>

      {/* Library tracks */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--le-muted)', fontSize: 13 }}>
          <Loader2 size={14} className="studio-spinner" /> Loading tracks&hellip;
        </div>
      ) : loadError ? (
        <span className="studio-error-strip" style={{ padding: '4px 10px', fontSize: 12 }}>
          {loadError}
        </span>
      ) : tracks.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--le-muted)', margin: 0 }}>
          No library tracks for this mood yet &mdash; use &ldquo;Generate 4 variations&rdquo; below.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tracks.map((track) => (
            <TrackCard
              key={track.id}
              track={track}
              isSelected={track.id === selectedId}
              disabled={selecting || generating}
              feedback={getFeedback(track.id)}
              onSelect={handleSelectTrack}
              onVote={handleVote}
              onComment={handleComment}
            />
          ))}
        </div>
      )}

      {/* Generated variation groups */}
      {generatedGroups.map((group, groupIdx) => (
        <div key={groupIdx} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Group header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              paddingBottom: 4,
              borderBottom: '1px solid var(--le-line)',
            }}
          >
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: 'var(--le-muted)',
                letterSpacing: '0.01em',
                textTransform: 'uppercase',
              }}
            >
              Generated variations
            </span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--le-muted-2)',
                fontWeight: 400,
              }}
            >
              {group.length} track{group.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Genre sub-groups within this generation batch */}
          {(() => {
            // Collect unique genres in order of first appearance
            const genreOrder: TrackGenre[] = [];
            for (const t of group) {
              if (!genreOrder.includes(t.genre)) genreOrder.push(t.genre);
            }
            return genreOrder.map((genre) => {
              const genreTracks = group.filter((t) => t.genre === genre);
              return (
                <div key={String(genre)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Genre label */}
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--le-muted)',
                      paddingLeft: 2,
                    }}
                  >
                    {genreLabel(genre)}
                  </span>
                  {genreTracks.map((track) => (
                    <TrackCard
                      key={track.id}
                      track={track}
                      isSelected={track.id === selectedId}
                      disabled={selecting || generating}
                      feedback={getFeedback(track.id)}
                      onSelect={handleSelectTrack}
                      onVote={handleVote}
                      onComment={handleComment}
                    />
                  ))}
                </div>
              );
            });
          })()}
        </div>
      ))}

      {/* Generate section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="studio-cta-primary"
            style={{ fontSize: 12, padding: '6px 14px' }}
            disabled={generating || selecting}
            onClick={handleGenerateNew}
          >
            {generating && <Loader2 size={12} className="studio-spinner" />}
            Generate 4 variations
          </button>
          <span style={{ fontSize: 12, color: 'var(--le-muted)', fontStyle: 'italic' }}>
            Creates AI tracks for this mood &mdash; pick the best fit
          </span>
        </div>

        {/* Fallback notice (server fully fell back to library) */}
        {fallbackNotice && (
          <div
            className="studio-warn-strip"
            role="status"
            style={{ padding: '6px 10px', fontSize: 12 }}
          >
            <span style={{ color: 'var(--le-warn)', fontWeight: 500 }}>
              Music generation unavailable &mdash; library track &ldquo;{fallbackNotice.trackName}&rdquo; was used instead.
            </span>
            {fallbackNotice.warning && (
              <span style={{ color: 'var(--le-warn)', marginLeft: 6 }}>
                ({fallbackNotice.warning})
              </span>
            )}
          </div>
        )}

        {/* Partial-failures warning (some tracks generated, some didn't) */}
        {generationWarning && !fallbackNotice && (
          <div
            className="studio-warn-strip"
            role="status"
            style={{ padding: '6px 10px', fontSize: 12 }}
          >
            <span style={{ color: 'var(--le-warn)' }}>{generationWarning}</span>
          </div>
        )}

        {/* Hard generation error */}
        {generateError && (
          <span className="studio-error-strip" style={{ padding: '4px 10px', fontSize: 12 }}>
            {generateError} &mdash; pick a library track or skip this step.
          </span>
        )}
      </div>
    </div>
  );
}
