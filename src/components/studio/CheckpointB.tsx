/**
 * CheckpointB — final video preview + operator ratings + delivered transition.
 *
 * Shows the assembled horizontal_video_url from the property (populated by
 * runAssembleStage before advancing to checkpoint_b).
 *
 * Four 1-5 star rows: Overall / Music / Voiceover / Script.
 * Optional comment textarea.
 * "Mark delivered" POSTs submit_ratings once all four are rated.
 * On success the stepper advances to Delivered.
 */

import { useState } from 'react';
import { Star, Loader2, Download } from 'lucide-react';
import { authedFetch } from '@/lib/api';
import HlsPlayer from '@/components/preview/HlsPlayer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckpointBProps {
  runId: string;
  /** Property id — used to build the download endpoint URL. */
  propertyId: string;
  /**
   * Progressive mp4 URL — from property.horizontal_video_url (or the vertical
   * fallback). Always the safe, directly-fetchable fallback source; also the
   * source the Download button relies on. Present for every completed render,
   * including legacy mp4-only rows.
   */
  videoUrl: string | null;
  /**
   * Bunny adaptive HLS playlist URL — from property.horizontal_hls_url (or the
   * vertical fallback). Preferred over videoUrl when present; omit / pass null
   * for legacy mp4-only rows so playback degrades to the mp4.
   */
  hlsUrl?: string | null;
  /**
   * Poster/thumbnail URL — from property.horizontal_poster_url (or vertical),
   * or a hero-photo fallback composed by the caller. When null the player shows
   * no poster (blank until the first frame decodes).
   */
  posterUrl?: string | null;
  onDelivered: () => void;
}

type RatingKey = 'overall' | 'music' | 'voiceover' | 'script';

const RATING_ROWS: { key: RatingKey; label: string }[] = [
  { key: 'overall', label: 'Overall' },
  { key: 'music', label: 'Music' },
  { key: 'voiceover', label: 'Voiceover' },
  { key: 'script', label: 'Script' },
];

// ─── StarRow ──────────────────────────────────────────────────────────────────

function StarRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number; // 0 = unrated
  onChange: (v: number) => void;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          width: 72,
          fontSize: 12.5,
          fontWeight: 500,
          color: 'var(--le-ink-2)',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', gap: 3 }}>
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = star <= (hover || value);
          return (
            <button
              key={star}
              type="button"
              aria-label={`${label} ${star} star${star !== 1 ? 's' : ''}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 2,
                lineHeight: 0,
                color: filled ? 'var(--le-accent)' : 'var(--le-line)',
                transition: 'color 100ms',
              }}
              onClick={() => onChange(star)}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(0)}
            >
              <Star
                size={18}
                strokeWidth={1.5}
                fill={filled ? 'currentColor' : 'none'}
              />
            </button>
          );
        })}
      </div>
      {value > 0 && (
        <span style={{ fontSize: 11, color: 'var(--le-muted)', marginLeft: 2 }}>
          {value}/5
        </span>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CheckpointB({ runId, propertyId, videoUrl, hlsUrl, posterUrl, onDelivered }: CheckpointBProps) {
  // Prefer Bunny's adaptive HLS playlist when present; fall back to the
  // progressive mp4 for legacy rows. HlsPlayer routes .m3u8 through hls.js
  // (or native HLS on Safari) and plays a plain mp4 directly.
  const playbackSrc = hlsUrl ?? videoUrl;
  const [ratings, setRatings] = useState<Record<RatingKey, number>>({
    overall: 0, music: 0, voiceover: 0, script: 0,
  });
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadPreparing, setDownloadPreparing] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const allRated = RATING_ROWS.every(({ key }) => ratings[key] > 0);

  const handleDownload = async () => {
    setDownloadPreparing(true);
    setDownloadError(null);
    try {
      const res = await authedFetch(
        `/api/admin/studio/properties/${propertyId}/download?format=horizontal`,
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
      const disposition = res.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      a.download = match?.[1] ?? 'video-horizontal.mp4';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Download failed';
      console.error('Download failed:', msg);
      setDownloadError(msg);
    } finally {
      setDownloadPreparing(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_ratings',
          ...ratings,
          comment,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      onDelivered();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="studio-card" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--le-muted)',
          }}
        >
          Checkpoint B
        </span>
        <h3
          style={{
            margin: '4px 0 0',
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--le-ink)',
          }}
        >
          Final video review
        </h3>
      </div>

      {/* Video player — HLS (adaptive) + a real poster frame when available,
          gracefully falling back to the progressive mp4 + blank poster for
          legacy mp4-only rows. HlsPlayer owns the leak-free hls.js lifecycle. */}
      {playbackSrc ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <HlsPlayer
            src={playbackSrc}
            poster={posterUrl ?? undefined}
            preload="metadata"
            playsInline
            style={{ width: '100%', maxHeight: 400, borderRadius: 'var(--le-r-sm)', background: '#000' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
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
              disabled={downloadPreparing}
            >
              {downloadPreparing ? (
                <Loader2 size={11} className="studio-spinner" />
              ) : (
                <Download size={11} strokeWidth={1.6} />
              )}
              {downloadPreparing ? 'Preparing…' : 'Download'}
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            height: 160,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--le-surface-2, rgba(0,0,0,.04))',
            borderRadius: "var(--le-r-sm)",
            fontSize: 12.5,
            color: 'var(--le-muted)',
          }}
        >
          Video processing — refresh in a moment.
        </div>
      )}

      {/* Ratings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--le-ink-2)' }}>
          Rate this delivery
        </span>
        {RATING_ROWS.map(({ key, label }) => (
          <StarRow
            key={key}
            label={label}
            value={ratings[key]}
            onChange={(v) => setRatings((r) => ({ ...r, [key]: v }))}
          />
        ))}
      </div>

      {/* Comment */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label
          htmlFor={`checkpoint-b-comment-${runId}`}
          style={{ fontSize: 12, fontWeight: 500, color: 'var(--le-ink-2)' }}
        >
          Feedback (optional)
        </label>
        <textarea
          id={`checkpoint-b-comment-${runId}`}
          className="studio-textarea"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Pacing, voice tone, clip quality…"
          rows={3}
        />
        <span style={{ fontSize: 11, color: 'var(--le-muted)' }}>
          Automatically parsed into structured tags for ML training.
        </span>
      </div>

      {/* Submit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
        <button
          type="button"
          className="studio-cta-primary"
          style={{ fontSize: 13, padding: '9px 20px', display: 'flex', alignItems: 'center', gap: 6 }}
          disabled={!allRated || submitting}
          onClick={() => void handleSubmit()}
        >
          {submitting && <Loader2 size={13} className="studio-spinner" />}
          Mark delivered
        </button>
        {!allRated && !submitting && (
          <span style={{ fontSize: 11.5, color: 'var(--le-muted)' }}>
            Rate all four categories to continue.
          </span>
        )}
        {error && (
          <span className="studio-error-strip" style={{ padding: '4px 10px', fontSize: 12 }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── DeliveredCard ────────────────────────────────────────────────────────────

/** Summary card shown once the run reaches 'delivered'. */
export function DeliveredCard() {
  return (
    <div
      className="studio-card"
      style={{
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: 'var(--le-surface)',
        borderLeft: '3px solid var(--le-good, #2a9d5c)',
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--le-good-bg, rgba(42,157,92,.10))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 16,
        }}
      >
        ✓
      </span>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--le-ink)' }}>
          Delivered
        </div>
        <div style={{ fontSize: 12, color: 'var(--le-muted)', marginTop: 2 }}>
          Ratings and feedback have been saved. Pipeline complete.
        </div>
      </div>
    </div>
  );
}
