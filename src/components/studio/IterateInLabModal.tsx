import { useState, useEffect, type CSSProperties } from 'react';
import { X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
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

const EYEBROW: CSSProperties = {
  fontFamily: 'var(--le-font-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)',
};

const GHOST_BTN: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 12px',
  fontSize: 11,
  fontWeight: 500,
  background: 'transparent',
  color: '#fff',
  border: '1px solid rgba(220,230,255,0.18)',
  borderRadius: 2,
  cursor: 'pointer',
  fontFamily: 'var(--le-font-sans)',
};

const ACCENT_BTN: CSSProperties = {
  ...GHOST_BTN,
  background: 'var(--le-accent)',
  color: 'var(--le-accent-fg)',
  border: 'none',
};

function formatRoomType(rt: string | null): string {
  if (!rt) return 'Unknown';
  return rt.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function RatingDots({ rating }: { rating: number | null }) {
  if (rating == null) return <span style={{ ...EYEBROW, fontSize: 9 }}>—</span>;
  return (
    <span style={{ fontFamily: 'var(--le-font-mono)', fontSize: 11, color: rating >= 4 ? '#4ade80' : rating >= 3 ? '#facc15' : '#f87171' }}>
      {rating}/5
    </span>
  );
}

export function IterateInLabModal({ scene, propertyId, onClose, onSwapped }: IterateInLabModalProps) {
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
        const data = await res.json() as { iterations: IterationRow[] };
        if (!cancelled) setIterations(data.iterations ?? []);
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : 'Failed to load iterations');
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
      // Brief visual confirmation, then propagate
      setTimeout(() => onSwapped(), 800);
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : 'Swap failed');
    } finally {
      setSwappingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative flex flex-col border border-border bg-background"
        style={{ width: '90vw', maxWidth: 720, maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <span style={EYEBROW}>— Iterate in Lab</span>
            <p className="mt-1 text-sm font-medium">
              Scene #{scene.scene_number} — {formatRoomType(scene.room_type)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : fetchError ? (
            <div className="py-10 text-center text-sm text-destructive">{fetchError}</div>
          ) : iterations.length === 0 ? (
            <div className="border border-dashed border-border py-10 text-center">
              <p className="text-xs text-muted-foreground/60">
                No Lab iterations found for {formatRoomType(scene.room_type)}.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {iterations.map((iter) => {
                const isSwapping = swappingId === iter.id;
                const isSuccess = swapSuccess === iter.id;
                return (
                  <div
                    key={iter.id}
                    className="border border-border bg-background/50 flex flex-col"
                    style={{ opacity: swappingId && swappingId !== iter.id ? 0.5 : 1 }}
                  >
                    {/* Clip thumbnail */}
                    <div className="relative aspect-video bg-secondary overflow-hidden">
                      {iter.clip_url ? (
                        <video
                          src={iter.clip_url}
                          muted
                          loop
                          autoPlay
                          playsInline
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <span style={{ ...EYEBROW, fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
                            No clip
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Meta */}
                    <div className="p-2.5 flex flex-col gap-2 flex-1 justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <RatingDots rating={iter.rating} />
                          <span style={{ ...EYEBROW, fontSize: 9 }}>
                            {iter.provider ?? '—'}
                          </span>
                        </div>
                        <p
                          className="text-[10px] text-muted-foreground/60 leading-snug line-clamp-2"
                          title={iter.prompt ?? ''}
                        >
                          {iter.prompt ?? 'No prompt'}
                        </p>
                        <p style={{ ...EYEBROW, fontSize: 9 }}>
                          {getRelativeTime(iter.created_at)}
                        </p>
                      </div>

                      <button
                        type="button"
                        style={isSuccess ? { ...ACCENT_BTN, fontSize: 10, padding: '4px 10px' } : { ...GHOST_BTN, fontSize: 10, padding: '4px 10px', width: '100%', justifyContent: 'center' }}
                        onClick={() => handleSwap(iter)}
                        disabled={!!swappingId || !!swapSuccess}
                      >
                        {isSwapping ? (
                          <><Loader2 style={{ width: 10, height: 10, animation: 'spin 1s linear infinite' }} /> Swapping…</>
                        ) : isSuccess ? (
                          <><CheckCircle style={{ width: 10, height: 10 }} /> Swapped</>
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
            <div className="mt-3 flex items-center gap-2 border border-destructive/40 bg-destructive/10 px-3 py-2">
              <AlertCircle style={{ width: 12, height: 12, color: 'var(--destructive)' }} />
              <p className="text-xs text-destructive">{swapError}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
