/**
 * DeliveryMusic — Music step UI for the operator delivery pipeline.
 *
 * Layout:
 *  1. Fetches GET /api/admin/studio/music-options?video_type={run.video_type}
 *     → renders up to 3 radio cards (name + <audio controls> preview + mood chip).
 *  2. Selecting a card POSTs set_music {music_track_id, source:'library'}.
 *  3. "Generate new" POSTs generate_music, appends the returned track, auto-selects
 *     it via set_music {source:'generated'}.
 *
 * The shared DeliveryNextButton (in PropertyCommandCenter) advances music → assembling.
 * Skip is allowed — assembly can proceed without an explicit music selection.
 */

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { authedFetch } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MusicTrack {
  id: string;
  name: string;
  file_url: string;
  mood_tag: string;
  source: string;
}

interface MusicOptionsResponse {
  mood: string;
  tracks: MusicTrack[];
}

interface GenerateMusicResponse {
  track: MusicTrack;
}

interface DeliveryMusicProps {
  runId: string;
  videoType: string;
  /** Pre-loaded from bundle.delivery_run */
  musicTrackId: string | null;
  onChanged: () => void;
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
    } catch {
      // Silently fail — selection remains unchanged, operator can retry
    } finally {
      setSelecting(false);
    }
  };

  const handleGenerateNew = async () => {
    setGenerating(true);
    setGenerateError(null);
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
      const newTrack = d.track;
      // Append to track list
      setTracks((prev) => {
        if (prev.some((t) => t.id === newTrack.id)) return prev;
        return [...prev, newTrack];
      });
      // Auto-select the generated track
      await handleSelectTrack(newTrack.id, 'generated');
      onChanged();
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
        Operator · Step
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
              borderRadius: 4,
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
          <Loader2 size={14} className="studio-spinner" /> Loading tracks…
        </div>
      ) : loadError ? (
        <span className="studio-error-strip" style={{ padding: '4px 10px', fontSize: 12 }}>
          {loadError}
        </span>
      ) : tracks.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--le-muted)', margin: 0 }}>
          No library tracks for this mood yet — use "Generate new" below.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tracks.map((track) => {
            const isSelected = track.id === selectedId;
            return (
              <div
                key={track.id}
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: `1.5px solid ${isSelected ? 'var(--le-ink)' : 'var(--le-line)'}`,
                  background: isSelected ? 'rgba(11,11,16,0.04)' : 'var(--le-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  transition: 'border-color 120ms, background 120ms',
                }}
              >
                {/* Track name + select button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--le-ink)', flex: 1 }}>
                    {track.name}
                  </span>
                  {track.source === 'elevenlabs_music' && (
                    <span
                      className="studio-status-pill"
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        background: 'rgba(11,11,16,0.05)',
                        color: 'var(--le-muted)',
                        borderRadius: 4,
                      }}
                    >
                      AI generated
                    </span>
                  )}
                  {!isSelected && (
                    <button
                      type="button"
                      className="studio-btn-ghost"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      disabled={selecting || generating}
                      onClick={() => handleSelectTrack(track.id, 'library')}
                    >
                      Select
                    </button>
                  )}
                  {isSelected && (
                    <span style={{ fontSize: 12, color: 'var(--le-good, #166534)', fontWeight: 600 }}>
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
              </div>
            );
          })}
        </div>
      )}

      {/* Generate new section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="studio-cta-primary"
            style={{ fontSize: 12, padding: '6px 14px' }}
            disabled={generating || selecting}
            onClick={handleGenerateNew}
          >
            {generating && <Loader2 size={12} className="studio-spinner" />}
            Generate new
          </button>
          <span style={{ fontSize: 12, color: 'var(--le-muted)', fontStyle: 'italic' }}>
            Creates a fresh AI track for this mood and adds it to the library
          </span>
        </div>
        {generateError && (
          <span className="studio-error-strip" style={{ padding: '4px 10px', fontSize: 12 }}>
            {generateError} — pick a library track or skip this step.
          </span>
        )}
      </div>
    </div>
  );
}
