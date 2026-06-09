import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  listRenders,
  createRenderCreative,
  type RenderOption,
  type Creative,
} from '@/lib/share-api';

/**
 * RenderPicker — modal listing properties that have rendered videos. The
 * operator picks a property + orientation (only orientations that actually have
 * a URL are shown) to create a `source='render'` creative referencing the
 * existing public video URL.
 */
export function RenderPicker({
  onCreated,
  onClose,
}: {
  onCreated: (creative: Creative) => void;
  onClose: () => void;
}) {
  const [renders, setRenders] = useState<RenderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listRenders()
      .then((rows) => {
        if (!cancelled) setRenders(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load renders.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(r: RenderOption, orientation: 'horizontal' | 'vertical') {
    const key = `${r.id}:${orientation}`;
    setCreatingKey(key);
    setError(null);
    try {
      const created = await createRenderCreative({
        property_id: r.id,
        orientation,
        title: r.address,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add render.');
      setCreatingKey(null);
    }
  }

  return (
    <div className="studio-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="studio-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add from renders"
      >
        <div className="share-drawer-head" style={{ position: 'static', borderBottom: 'none' }}>
          <h2>Add from renders</h2>
          <button type="button" className="share-drawer-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
            <Loader2 size={20} className="studio-spinner" style={{ color: 'var(--le-muted)' }} />
          </div>
        ) : error ? (
          <div className="studio-error-strip">{error}</div>
        ) : renders.length === 0 ? (
          <p style={{ padding: '24px 4px', fontSize: 13, color: 'var(--le-muted)', textAlign: 'center' }}>
            No rendered property videos available yet.
          </p>
        ) : (
          <div className="share-render-list">
            {renders.map((r) => (
              <div key={r.id} className="share-render-row">
                <span className="addr">{r.address}</span>
                <div className="share-render-orients">
                  {r.horizontal_video_url && (
                    <button
                      type="button"
                      className="studio-btn-ghost"
                      disabled={creatingKey !== null}
                      onClick={() => pick(r, 'horizontal')}
                    >
                      {creatingKey === `${r.id}:horizontal` ? (
                        <Loader2 size={12} className="studio-spinner" />
                      ) : (
                        'Horizontal'
                      )}
                    </button>
                  )}
                  {r.vertical_video_url && (
                    <button
                      type="button"
                      className="studio-btn-ghost"
                      disabled={creatingKey !== null}
                      onClick={() => pick(r, 'vertical')}
                    >
                      {creatingKey === `${r.id}:vertical` ? (
                        <Loader2 size={12} className="studio-spinner" />
                      ) : (
                        'Vertical'
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
