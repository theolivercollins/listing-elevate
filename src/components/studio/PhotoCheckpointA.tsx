import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Loader2, RefreshCw } from 'lucide-react';
import { authedFetch } from '@/lib/api';
import { photoThumb } from '@/lib/image-url';

type PhotoCandidate = {
  id: string;
  file_url: string;
  file_name: string | null;
  selected: boolean | null;
  room_type: string | null;
  aesthetic_score: number | null;
  quality_score: number | null;
  analysis_provider: string | null;
  discard_reason: string | null;
  analysis_json: Record<string, unknown> | null;
};

type PhotoSelectionBundle = {
  photo_selection: {
    selected_photo_ids: string[];
    photos: PhotoCandidate[];
  } | null;
};

interface PhotoCheckpointAProps {
  runId: string;
  onChanged: () => void;
}

function roomLabel(room: string | null): string {
  return room ? room.replace(/_/g, ' ') : 'unknown';
}

function scoreLabel(score: number | null): string {
  return typeof score === 'number' ? score.toFixed(1) : 'n/a';
}

const ACCEPT_CATEGORIES = [
  { value: 'hero_exterior', label: 'Hero exterior' },
  { value: 'primary_room', label: 'Primary room' },
  { value: 'feature_room', label: 'Feature room' },
  { value: 'strong_motion_potential', label: 'Strong motion' },
  { value: 'necessary_coverage', label: 'Coverage' },
  { value: 'other', label: 'Other' },
] as const;

const REJECT_CATEGORIES = [
  { value: 'low_value_room', label: 'Low-value room' },
  { value: 'duplicate_or_redundant', label: 'Duplicate' },
  { value: 'weak_video_potential', label: 'Weak motion' },
  { value: 'poor_quality', label: 'Poor quality' },
  { value: 'bad_composition', label: 'Bad composition' },
  { value: 'not_representative', label: 'Not representative' },
  { value: 'other', label: 'Other' },
] as const;

// The replacement pool can hold every candidate photo for a property (up to
// ~300). Rendering them all at once mounts hundreds of <img> tags on load.
// Reveal them in batches instead — client-side windowing over the already
// -fetched `photos` array, no extra network calls.
const PHOTO_POOL_PAGE_SIZE = 40;

function defaultAcceptedCategory(room: string | null): string {
  if (room === 'exterior_front' || room === 'exterior_back' || room === 'aerial') return 'hero_exterior';
  if (room === 'kitchen' || room === 'living_room' || room === 'master_bedroom' || room === 'bathroom') return 'primary_room';
  if (room === 'pool' || room === 'deck' || room === 'office' || room === 'media_room' || room === 'gym') return 'feature_room';
  return 'necessary_coverage';
}

function defaultRejectedCategory(room: string | null): string {
  if (room === 'laundry' || room === 'mudroom' || room === 'closet' || room === 'garage') return 'low_value_room';
  return 'bad_composition';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function selectionReason(photo: PhotoCandidate): string | null {
  const verdict = isRecord(photo.analysis_json?.selection_verdict)
    ? photo.analysis_json.selection_verdict
    : null;
  if (typeof verdict?.reason === 'string' && verdict.reason.trim()) return verdict.reason;
  return photo.discard_reason;
}

export function PhotoCheckpointA({ runId, onChanged }: PhotoCheckpointAProps) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [rejectedReasons, setRejectedReasons] = useState<Record<string, string>>({});
  const [acceptedCategories, setAcceptedCategories] = useState<Record<string, string>>({});
  const [rejectedCategories, setRejectedCategories] = useState<Record<string, string>>({});
  const [poolVisibleCount, setPoolVisibleCount] = useState(PHOTO_POOL_PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const bundle = (await res.json()) as PhotoSelectionBundle;
      const selection = bundle.photo_selection;
      if (!selection) throw new Error('Photo selection is not available for this run.');
      const loadedPhotoById = new Map(selection.photos.map((p) => [p.id, p]));
      setPhotos(selection.photos);
      setSelectedIds(selection.selected_photo_ids);
      setRejectedReasons({});
      setAcceptedCategories(Object.fromEntries(
        selection.selected_photo_ids.map((id) => [
          id,
          defaultAcceptedCategory(loadedPhotoById.get(id)?.room_type ?? null),
        ]),
      ));
      setRejectedCategories({});
      setReplacingId(null);
      setPoolVisibleCount(PHOTO_POOL_PAGE_SIZE);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const photoById = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const selectedPhotos = selectedIds.map((id) => photoById.get(id)).filter(Boolean) as PhotoCandidate[];
  const availablePhotos = photos.filter((p) => !selectedIds.includes(p.id));
  const visiblePoolPhotos = availablePhotos.slice(0, poolVisibleCount);
  const remainingPoolCount = availablePhotos.length - visiblePoolPhotos.length;
  const removedSelectedPhotos = photos.filter((p) => p.selected && !selectedIds.includes(p.id));
  const hasRequiredRejectionReasons = removedSelectedPhotos.every((p) => (
    Boolean(rejectedReasons[p.id]?.trim()) && Boolean(rejectedCategories[p.id] ?? defaultRejectedCategory(p.room_type))
  ));
  const canApprove = selectedIds.length > 0 && hasRequiredRejectionReasons;

  const move = (index: number, direction: -1 | 1) => {
    setSelectedIds((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const replaceWith = (newPhotoId: string) => {
    if (!replacingId) return;
    setSelectedIds((prev) => prev.map((id) => (id === replacingId ? newPhotoId : id)));
    const replacement = photoById.get(newPhotoId);
    const removed = photoById.get(replacingId);
    setAcceptedCategories((prev) => ({
      ...prev,
      [newPhotoId]: prev[newPhotoId] ?? defaultAcceptedCategory(replacement?.room_type ?? null),
    }));
    setRejectedReasons((prev) => ({
      ...prev,
      [replacingId]: prev[replacingId] ?? '',
    }));
    setRejectedCategories((prev) => ({
      ...prev,
      [replacingId]: prev[replacingId] ?? defaultRejectedCategory(removed?.room_type ?? null),
    }));
    setReplacingId(null);
  };

  const approve = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const rejected = removedSelectedPhotos.map((p) => ({
        photo_id: p.id,
        category: rejectedCategories[p.id] ?? defaultRejectedCategory(p.room_type),
        reason: rejectedReasons[p.id]?.trim() ?? '',
      }));
      const accepted = selectedIds.map((id) => {
        const photo = photoById.get(id);
        return {
          photo_id: id,
          category: acceptedCategories[id] ?? defaultAcceptedCategory(photo?.room_type ?? null),
          note: null,
        };
      });
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve_photo_selection',
          photo_order: selectedIds,
          accepted,
          rejected,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve photos');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="studio-card" style={{ padding: 20, display: 'flex', justifyContent: 'center' }}>
        <Loader2 size={18} className="studio-spinner" style={{ color: 'var(--le-muted)' }} />
      </div>
    );
  }

  return (
    <div className="studio-card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--le-ink)' }}>
            Checkpoint A — selected photos
          </div>
          <div style={{ fontSize: 12, color: 'var(--le-muted)', marginTop: 2 }}>
            {selectedIds.length} photos queued for the director
          </div>
        </div>
        <button
          type="button"
          className="studio-cta-primary"
          style={{ fontSize: 12.5, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
          disabled={submitting || !canApprove}
          onClick={() => void approve()}
        >
          {submitting ? <Loader2 size={13} className="studio-spinner" /> : <Check size={13} strokeWidth={2} />}
          Approve photos
        </button>
      </div>

      {error && (
        <div className="studio-error-strip" style={{ padding: '8px 10px', fontSize: 12 }}>
          {error}
        </div>
      )}

      {selectedPhotos.length === 0 ? (
        <div style={{ padding: '16px 0', fontSize: 12.5, color: 'var(--le-muted)' }}>
          No selected photos available.
        </div>
      ) : (
        <div className="studio-hscroll" style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
          {selectedPhotos.map((photo, index) => {
            const replacing = replacingId === photo.id;
            return (
              <div
                key={photo.id}
                style={{
                  flex: '0 0 184px',
                  border: replacing ? '1.5px solid var(--le-primary, #3b6fd4)' : '1px solid var(--le-line)',
                  borderRadius: 'var(--le-r-sm)',
                  background: 'var(--le-surface)',
                  overflow: 'hidden',
                }}
              >
                <img
                  src={photoThumb(photo.file_url)}
                  alt={roomLabel(photo.room_type)}
                  loading="lazy"
                  decoding="async"
                  style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', background: 'var(--le-surface-2)' }}
                />
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--le-ink)', textTransform: 'capitalize' }}>
                      {index + 1}. {roomLabel(photo.room_type)}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--le-muted)' }}>
                      {scoreLabel(photo.aesthetic_score)}
                    </span>
                  </div>
                  {selectionReason(photo) && (
                    <div style={{ fontSize: 10.5, lineHeight: 1.35, color: 'var(--le-muted)' }}>
                      {selectionReason(photo)}
                    </div>
                  )}
                  <label style={{ display: 'grid', gap: 4, fontSize: 10.5, color: 'var(--le-muted)' }}>
                    Keep reason
                    <select
                      aria-label={`Accept reason for ${roomLabel(photo.room_type)}`}
                      value={acceptedCategories[photo.id] ?? defaultAcceptedCategory(photo.room_type)}
                      onChange={(e) => setAcceptedCategories((prev) => ({ ...prev, [photo.id]: e.target.value }))}
                      style={{
                        width: '100%',
                        border: '1px solid var(--le-line)',
                        borderRadius: 'var(--le-r-sm)',
                        padding: '5px 7px',
                        fontSize: 11,
                        color: 'var(--le-ink)',
                        background: 'var(--le-surface)',
                      }}
                    >
                      {ACCEPT_CATEGORIES.map((category) => (
                        <option key={category.value} value={category.value}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button type="button" aria-label={`Move ${roomLabel(photo.room_type)} up`} className="studio-btn-ghost" style={{ padding: '4px 7px' }} disabled={index === 0} onClick={() => move(index, -1)}>
                      <ArrowUp size={12} />
                    </button>
                    <button type="button" aria-label={`Move ${roomLabel(photo.room_type)} down`} className="studio-btn-ghost" style={{ padding: '4px 7px' }} disabled={index === selectedPhotos.length - 1} onClick={() => move(index, 1)}>
                      <ArrowDown size={12} />
                    </button>
                    <button type="button" className="studio-btn-ghost" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => setReplacingId(replacing ? null : photo.id)}>
                      Replace
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {removedSelectedPhotos.length > 0 && (
        <div style={{ borderTop: '1px solid var(--le-line)', paddingTop: 12, display: 'grid', gap: 8 }}>
          {removedSelectedPhotos.map((photo) => (
            <div key={photo.id} style={{ display: 'grid', gap: 7 }}>
              <div style={{ fontSize: 11.5, color: 'var(--le-muted)', textTransform: 'capitalize' }}>
                Removed {roomLabel(photo.room_type)}
              </div>
              <label style={{ display: 'grid', gap: 5, fontSize: 11, color: 'var(--le-muted)' }}>
                Reject category
                <select
                  aria-label={`Reject reason for ${roomLabel(photo.room_type)}`}
                  value={rejectedCategories[photo.id] ?? defaultRejectedCategory(photo.room_type)}
                  onChange={(e) => setRejectedCategories((prev) => ({ ...prev, [photo.id]: e.target.value }))}
                  style={{
                    border: '1px solid var(--le-line)',
                    borderRadius: 'var(--le-r-sm)',
                    padding: '7px 9px',
                    fontSize: 12,
                    color: 'var(--le-ink)',
                    background: 'var(--le-surface)',
                  }}
                >
                  {REJECT_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 5, fontSize: 11, color: 'var(--le-muted)' }}>
                Reject note
                <input
                  value={rejectedReasons[photo.id] ?? ''}
                  onChange={(e) => setRejectedReasons((prev) => ({ ...prev, [photo.id]: e.target.value }))}
                  placeholder="Why this photo should not be picked"
                  style={{
                    border: '1px solid var(--le-line)',
                    borderRadius: 'var(--le-r-sm)',
                    padding: '8px 10px',
                    fontSize: 12.5,
                    color: 'var(--le-ink)',
                    background: 'var(--le-surface)',
                  }}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--le-line)', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <RefreshCw size={13} strokeWidth={2} style={{ color: replacingId ? 'var(--le-primary, #3b6fd4)' : 'var(--le-muted)' }} />
          <span style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--le-ink)' }}>
            Replacement pool
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(136px, 1fr))', gap: 10 }}>
          {visiblePoolPhotos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              disabled={!replacingId}
              onClick={() => replaceWith(photo.id)}
              style={{
                padding: 0,
                textAlign: 'left',
                border: '1px solid var(--le-line)',
                borderRadius: 'var(--le-r-sm)',
                overflow: 'hidden',
                background: 'var(--le-surface)',
                opacity: replacingId ? 1 : 0.72,
                cursor: replacingId ? 'pointer' : 'default',
              }}
            >
              <img
                src={photoThumb(photo.file_url)}
                alt={roomLabel(photo.room_type)}
                loading="lazy"
                decoding="async"
                style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
              />
              <span style={{ display: 'block', padding: '7px 8px', fontSize: 11.5, color: 'var(--le-ink)', textTransform: 'capitalize' }}>
                {roomLabel(photo.room_type)} · {scoreLabel(photo.aesthetic_score)}
              </span>
              {selectionReason(photo) && (
                <span style={{ display: 'block', padding: '0 8px 8px', fontSize: 10.5, lineHeight: 1.35, color: 'var(--le-muted)' }}>
                  {selectionReason(photo)}
                </span>
              )}
            </button>
          ))}
        </div>
        {remainingPoolCount > 0 && (
          <button
            type="button"
            className="studio-btn-ghost"
            style={{ marginTop: 10, width: '100%', justifyContent: 'center', fontSize: 12 }}
            onClick={() => setPoolVisibleCount((prev) => prev + PHOTO_POOL_PAGE_SIZE)}
          >
            Show more photos ({remainingPoolCount} remaining)
          </button>
        )}
      </div>
    </div>
  );
}
