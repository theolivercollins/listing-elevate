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
import { Star, Loader2 } from 'lucide-react';
import { authedFetch } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckpointBProps {
  runId: string;
  /** Assembled horizontal video URL — from property.horizontal_video_url */
  videoUrl: string | null;
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
                color: filled ? 'var(--le-primary, #3b6fd4)' : 'var(--le-line)',
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

export function CheckpointB({ runId, videoUrl, onDelivered }: CheckpointBProps) {
  const [ratings, setRatings] = useState<Record<RatingKey, number>>({
    overall: 0, music: 0, voiceover: 0, script: 0,
  });
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allRated = RATING_ROWS.every(({ key }) => ratings[key] > 0);

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

      {/* Video player */}
      {videoUrl ? (
        <video
          src={videoUrl}
          controls
          playsInline
          className="studio-video"
          style={{ width: '100%', maxHeight: 400, borderRadius: 8, background: '#000' }}
        />
      ) : (
        <div
          style={{
            height: 160,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--le-surface-2, rgba(0,0,0,.04))',
            borderRadius: 8,
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
