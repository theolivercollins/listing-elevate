/**
 * CheckpointA — Checkpoint A clip review panel.
 *
 * Shows each scene's winner clip in scene_order order.
 * Drag via react-dnd (HTML5Backend) or ▲/▼ buttons to reorder.
 * "Save order" POSTs reorder action when local order differs from saved.
 * Variant badges show A/B, winner source, and degraded status.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Loader2, ChevronUp, ChevronDown, Save } from 'lucide-react';
import { authedFetch } from '@/lib/api';
import type { SceneVariantRow } from '../../../../lib/types/operator-studio';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckpointAProps {
  runId: string;
  onChanged: () => void;
}

interface DeliveryBundle {
  run: {
    id: string;
    scene_order: string[] | null;
  };
  variants: SceneVariantRow[];
}

interface ClipCard {
  sceneId: string;
  winnerVariant: 'A' | 'B' | null;
  clipUrl: string | null;
  winnerSource: 'gemini' | 'operator' | 'default' | null;
  degraded: boolean;
}

const DRAG_TYPE = 'delivery-clip';

// ─── Drag-and-drop card ───────────────────────────────────────────────────────

interface DragItem {
  id: string;
  index: number;
}

interface ClipCardProps {
  card: ClipCard;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onHover: (dragIndex: number, hoverIndex: number) => void;
}

function VariantBadge({ source, variant, degraded }: { source: ClipCard['winnerSource']; variant: 'A' | 'B' | null; degraded: boolean }) {
  const label = variant ?? '?';
  const sourceLabel =
    source === 'gemini' ? 'Gemini pick' :
    source === 'operator' ? 'Operator pick' :
    'Default (unjudged)';

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: 4,
          background: variant === 'A' ? 'var(--le-ink)' : 'var(--le-primary, #3b6fd4)',
          color: '#fff',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10.5,
          padding: '2px 6px',
          borderRadius: 4,
          background: 'var(--le-surface-2, rgba(0,0,0,.06))',
          color: 'var(--le-muted)',
        }}
      >
        {sourceLabel}
      </span>
      {degraded && (
        <span
          style={{
            fontSize: 10.5,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'var(--le-warn-bg, rgba(255,160,0,.12))',
            color: 'var(--le-warn, #b97800)',
            fontWeight: 500,
          }}
        >
          degraded
        </span>
      )}
    </div>
  );
}

function DraggableCard({ card, index, total, onMoveUp, onMoveDown, onHover }: ClipCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>({
    type: DRAG_TYPE,
    item: () => ({ id: card.sceneId, index }),
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  const [, drop] = useDrop<DragItem, void, void>({
    accept: DRAG_TYPE,
    hover(item) {
      if (item.index === index) return;
      onHover(item.index, index);
      item.index = index;
    },
  });

  drag(drop(ref));

  return (
    <div
      ref={ref}
      style={{
        flex: '0 0 auto',
        width: 200,
        background: 'var(--le-surface)',
        border: '1px solid var(--le-line)',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 150ms',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Video / placeholder */}
      <div style={{ width: 200, height: 112, background: 'var(--le-surface-2, #f0f0f0)', flexShrink: 0, position: 'relative' }}>
        {card.clipUrl ? (
          <video
            src={card.clipUrl}
            muted
            loop
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--le-muted-2)',
              fontSize: 11.5,
            }}
          >
            No clip
          </div>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <VariantBadge source={card.winnerSource} variant={card.winnerVariant} degraded={card.degraded} />

        {/* ▲/▼ controls */}
        <div style={{ display: 'flex', gap: 4, marginTop: 'auto' }}>
          <button
            type="button"
            aria-label="Move scene up"
            className="studio-btn-ghost"
            style={{ fontSize: 11, padding: '3px 7px', flex: 1 }}
            disabled={index === 0}
            onClick={onMoveUp}
          >
            <ChevronUp size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Move scene down"
            className="studio-btn-ghost"
            style={{ fontSize: 11, padding: '3px 7px', flex: 1 }}
            disabled={index === total - 1}
            onClick={onMoveDown}
          >
            <ChevronDown size={12} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function CheckpointAInner({ runId, onChanged }: CheckpointAProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedOrder, setSavedOrder] = useState<string[]>([]);
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [variantsMap, setVariantsMap] = useState<Map<string, ClipCard>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const bundle = (await res.json()) as DeliveryBundle;
      const order = bundle.run.scene_order ?? [];
      setSavedOrder(order);
      setLocalOrder(order);

      // Build card map: winner variant per scene
      const map = new Map<string, ClipCard>();
      for (const v of bundle.variants) {
        if (!v.winner) continue;
        const existing = map.get(v.scene_id);
        if (!existing) {
          map.set(v.scene_id, {
            sceneId: v.scene_id,
            winnerVariant: v.variant,
            clipUrl: v.clip_url,
            winnerSource: v.winner_source,
            degraded: v.degraded,
          });
        }
      }
      // For scenes not yet judged (no winner variant yet), fall back to any available clip
      for (const v of bundle.variants) {
        if (map.has(v.scene_id)) continue;
        if (v.clip_url) {
          map.set(v.scene_id, {
            sceneId: v.scene_id,
            winnerVariant: v.variant,
            clipUrl: v.clip_url,
            winnerSource: v.winner_source,
            degraded: v.degraded,
          });
        }
      }
      setVariantsMap(map);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clips');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { void load(); }, [load]);

  const moveCard = useCallback((fromIndex: number, toIndex: number) => {
    setLocalOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const moveUp = useCallback((index: number) => moveCard(index, index - 1), [moveCard]);
  const moveDown = useCallback((index: number) => moveCard(index, index + 1), [moveCard]);

  const isDirty = localOrder.join(',') !== savedOrder.join(',');

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reorder', scene_order: localOrder }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setSavedOrder(localOrder);
      onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="studio-card" style={{ padding: 20, display: 'flex', justifyContent: 'center' }}>
        <Loader2 size={18} className="studio-spinner" style={{ color: 'var(--le-muted)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="studio-error-strip" style={{ padding: '10px 14px' }}>
        {error}
      </div>
    );
  }

  const cards = localOrder
    .map((id) => variantsMap.get(id) ?? { sceneId: id, winnerVariant: null, clipUrl: null, winnerSource: null, degraded: false })
    .filter(Boolean) as ClipCard[];

  return (
    <div className="studio-card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--le-ink)' }}>
          Clip order — drag or use arrows to reorder
        </span>
        {isDirty && (
          <button
            type="button"
            className="studio-cta-primary"
            style={{ fontSize: 12, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? <Loader2 size={12} className="studio-spinner" /> : <Save size={12} strokeWidth={2} />}
            Save order
          </button>
        )}
      </div>

      {saveError && (
        <div className="studio-error-strip" style={{ padding: '6px 10px', fontSize: 12 }}>
          {saveError}
        </div>
      )}

      {cards.length === 0 ? (
        <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--le-muted)' }}>
          No scenes in order yet — pipeline generating clips.
        </div>
      ) : (
        <div
          className="studio-hscroll"
          style={{ display: 'flex', gap: 12, paddingBottom: 4, overflowX: 'auto' }}
        >
          {cards.map((card, i) => (
            <DraggableCard
              key={card.sceneId}
              card={card}
              index={i}
              total={cards.length}
              onMoveUp={() => moveUp(i)}
              onMoveDown={() => moveDown(i)}
              onHover={moveCard}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Wrap with DndProvider so it's self-contained.
export function CheckpointA(props: CheckpointAProps) {
  return (
    <DndProvider backend={HTML5Backend}>
      <CheckpointAInner {...props} />
    </DndProvider>
  );
}
