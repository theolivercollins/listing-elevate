import { useState, useEffect } from 'react';
import { X, Loader2, Check, AlertCircle, Image } from 'lucide-react';
import { getRelativeTime } from '@/lib/types';

interface SceneRow {
  id: string;
  scene_number: number;
  room_type: string | null;
}

interface IterationRow {
  id: string;
  scene_id: string;
  iteration_number: number | null;
  clip_url: string | null;
  rating: number | null;
  created_at: string;
  prompt: string | null;
  provider: string | null;
  sku: string | null;
}

interface IterateInLabModalProps {
  scene: SceneRow;
  propertyId: string;
  onClose: () => void;
  onSwapped: () => void;
}

function formatRoomType(rt: string | null): string {
  if (!rt) return 'Unknown';
  return rt.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function RatingBadge({ rating }: { rating: number | null }) {
  if (rating == null) {
    return (
      <span style={{ fontSize: 11, color: 'var(--le-muted-2)', fontVariantNumeric: 'tabular-nums' }}>—</span>
    );
  }
  const color =
    rating >= 4 ? 'var(--le-good)' :
    rating >= 3 ? 'var(--le-warn)' :
    'var(--le-bad)';
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {rating}/5
    </span>
  );
}

/**
 * IterateInLabModal — glass-styled modal for swapping a scene clip
 * from a Lab iteration. Must sit inside .studio-scope wrapper.
 */
export function IterateInLabModal({
  scene,
  propertyId,
  onClose,
  onSwapped,
}: IterateInLabModalProps) {
  const [iterations, setIterations] = useState<IterationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [swappingId, setSwappingId] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapSuccess, setSwapSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const url = scene.room_type
          ? `/api/admin/studio/iterations?room_type=${encodeURIComponent(scene.room_type)}`
          : '/api/admin/studio/iterations';
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { iterations: IterationRow[] };
        if (!cancelled) setIterations(data.iterations ?? []);
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : 'Failed to load iterations');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [scene.room_type]);

  const handleSwap = async (iteration: IterationRow) => {
    if (swappingId) return;
    setSwappingId(iteration.id);
    setSwapError(null);
    setSwapSuccess(null);
    try {
      const res = await fetch(
        `/api/admin/studio/properties/${propertyId}/scenes/${scene.scene_number}/swap-clip`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ iteration_id: iteration.id }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setSwapSuccess(iteration.id);
      setTimeout(() => onSwapped(), 800);
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : 'Swap failed');
    } finally {
      setSwappingId(null);
    }
  };

  return (
    /* The overlay backdrop — no backdrop-filter on the modal itself per spec */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(11,11,16,0.55)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="studio-card"
        style={{
          width: '90vw',
          maxWidth: 720,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--le-shadow-lg)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--le-line-2)',
            flexShrink: 0,
          }}
        >
          <div>
            <span
              className="studio-section-eyebrow"
              style={{ marginBottom: 4 }}
            >
              Iterate in Lab
            </span>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: '-0.012em',
                color: 'var(--le-ink)',
              }}
            >
              Scene #{scene.scene_number} — {formatRoomType(scene.room_type)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="studio-btn-ghost"
            style={{ padding: '6px 8px', borderRadius: "var(--le-r-md)" }}
            aria-label="Close"
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
              <Loader2 size={20} className="studio-spinner" style={{ color: 'var(--le-muted)' }} />
            </div>
          ) : fetchError ? (
            <div className="studio-error-strip">{fetchError}</div>
          ) : iterations.length === 0 ? (
            <div className="studio-kanban-empty" style={{ padding: 40 }}>
              <p>No Lab iterations found for {formatRoomType(scene.room_type)}.</p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: 12,
              }}
            >
              {iterations.map((iter) => {
                const isSwapping = swappingId === iter.id;
                const isSuccess = swapSuccess === iter.id;
                const isDimmed = !!swappingId && swappingId !== iter.id;
                return (
                  <div
                    key={iter.id}
                    className="studio-card"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                      opacity: isDimmed ? 0.45 : 1,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {/* Clip thumbnail */}
                    <div
                      style={{
                        position: 'relative',
                        aspectRatio: '16/9',
                        background: 'rgba(11,11,16,0.06)',
                        overflow: 'hidden',
                      }}
                    >
                      {iter.clip_url ? (
                        <video
                          src={iter.clip_url}
                          muted
                          loop
                          autoPlay
                          playsInline
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            height: '100%',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--le-muted-2)',
                          }}
                        >
                          <Image size={18} strokeWidth={1.4} />
                        </div>
                      )}
                    </div>

                    {/* Meta */}
                    <div
                      style={{
                        padding: '10px 12px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        flex: 1,
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 6,
                          }}
                        >
                          <RatingBadge rating={iter.rating} />
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--le-muted)',
                              fontWeight: 500,
                            }}
                          >
                            {iter.provider ?? '—'}
                          </span>
                        </div>
                        {iter.prompt && (
                          <p
                            style={{
                              margin: 0,
                              fontSize: 11,
                              color: 'var(--le-muted)',
                              lineHeight: 1.4,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                            title={iter.prompt}
                          >
                            {iter.prompt}
                          </p>
                        )}
                        <span style={{ fontSize: 11, color: 'var(--le-muted-2)' }}>
                          {getRelativeTime(iter.created_at)}
                        </span>
                      </div>

                      <button
                        type="button"
                        className={(isSuccess ? 'studio-cta-primary' : 'studio-btn-ghost') + ' studio-btn-sm'}
                        style={{ width: '100%', justifyContent: 'center' }}
                        onClick={() => handleSwap(iter)}
                        disabled={!!swappingId || !!swapSuccess}
                      >
                        {isSwapping ? (
                          <>
                            <Loader2 size={11} className="studio-spinner" />
                            Swapping…
                          </>
                        ) : isSuccess ? (
                          <>
                            <Check size={11} strokeWidth={2} />
                            Swapped
                          </>
                        ) : (
                          'Use this clip'
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {swapError && (
            <div className="studio-error-strip" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={13} strokeWidth={1.6} />
              {swapError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
