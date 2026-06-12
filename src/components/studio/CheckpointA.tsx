/**
 * CheckpointA — Checkpoint A clip review panel.
 *
 * - Drag via react-dnd (HTML5Backend) or ▲/▼ buttons to reorder scenes.
 * - "Save order" POSTs reorder action when local order differs from saved.
 * - Per-card "Flip A↔B" swaps the winner between variants.
 * - Per-card "Regenerate" dropdown re-submits A or B to the provider.
 * - While any variant is in flight (null clip_url, non-null task id), polls every 10s.
 * - Variant badges: A/B label, winner source ("Gemini pick"/"Operator pick"/"Default (unjudged)"),
 *   and a "degraded" chip when the pair's loser row has degraded=true.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Loader2, ChevronUp, ChevronDown, Save, RefreshCw, ArrowLeftRight, ChevronDown as CaretDown } from 'lucide-react';
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
  /** Scene ids with end_photo_id set (paired start+end-frame scenes). These
   *  unlock the regenerate model picker (Kling 3 Pro / Seedance 2.0 pair). */
  paired_scene_ids?: string[];
}

/** Regenerate model choices for PAIRED scenes only. Order matters: first is
 *  the default (mirrors RULE DQ.3 — paired scenes default to Kling 3 Pro). */
const PAIRED_REGEN_MODELS = [
  { key: 'kling-v3-pro', label: 'Kling 3 Pro' },
  { key: 'seedance-pair', label: 'Seedance 2.0 (pair)' },
] as const;
type PairedRegenModelKey = (typeof PAIRED_REGEN_MODELS)[number]['key'];

/** The display-state we track per scene card. */
interface ClipCard {
  sceneId: string;
  winnerVariant: 'A' | 'B' | null;
  clipUrl: string | null;
  winnerSource: 'gemini' | 'operator' | 'default' | null;
  degraded: boolean;
  /** True when any variant for this scene is still rendering (provider_task_id set, clip_url null). */
  inFlight: boolean;
}

const DRAG_TYPE = 'delivery-clip';
const POLL_INTERVAL_MS = 10_000;

// ─── Variant badge ────────────────────────────────────────────────────────────

function VariantBadge({
  source,
  variant,
  degraded,
}: {
  source: ClipCard['winnerSource'];
  variant: 'A' | 'B' | null;
  degraded: boolean;
}) {
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

// ─── Regenerate dropdown ──────────────────────────────────────────────────────

function RegenerateMenu({
  onSelect,
  busy,
  paired,
}: {
  onSelect: (variant: 'A' | 'B', model?: PairedRegenModelKey) => void;
  busy: boolean;
  /** Paired scenes (end photo set) get a model choice; others keep the plain menu. */
  paired: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<PairedRegenModelKey>('kling-v3-pro');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="studio-btn-ghost"
        style={{ fontSize: 10.5, padding: '3px 7px', display: 'flex', alignItems: 'center', gap: 3 }}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        aria-label="Regenerate variant"
      >
        {busy ? <Loader2 size={10} className="studio-spinner" /> : <RefreshCw size={10} strokeWidth={2} />}
        Regen
        <CaretDown size={9} strokeWidth={2} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 2,
            background: 'var(--le-surface)',
            border: '1px solid var(--le-line)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,.12)',
            zIndex: 20,
            minWidth: paired ? 168 : 80,
          }}
        >
          {paired && (
            /* Paired scene: pick the render model. Default mirrors DQ.3
               (Kling 3 Pro); Seedance 2.0 pair mode is the opt-in. */
            <div style={{ padding: '7px 8px 5px', borderBottom: '1px solid var(--le-line)' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--le-muted)', marginBottom: 4 }}>
                Model
              </div>
              <div style={{ display: 'flex', gap: 3 }}>
                {PAIRED_REGEN_MODELS.map((m) => {
                  const active = model === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      aria-pressed={active}
                      style={{
                        flex: 1,
                        padding: '4px 6px',
                        fontSize: 10.5,
                        fontWeight: active ? 600 : 400,
                        borderRadius: 5,
                        border: active ? '1px solid var(--le-ink)' : '1px solid var(--le-line)',
                        background: active ? 'var(--le-ink)' : 'var(--le-surface)',
                        color: active ? '#fff' : 'var(--le-muted)',
                        cursor: 'pointer',
                      }}
                      onClick={() => setModel(m.key)}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(['A', 'B'] as const).map((v) => (
            <button
              key={v}
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '7px 12px',
                textAlign: 'left',
                fontSize: 11.5,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--le-ink)',
              }}
              onClick={() => { setOpen(false); onSelect(v, paired ? model : undefined); }}
            >
              Variant {v}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Drag-and-drop card ───────────────────────────────────────────────────────

interface DragItem {
  id: string;
  index: number;
}

interface DraggableCardProps {
  card: ClipCard;
  index: number;
  total: number;
  /** True when the scene has an end photo (paired) — unlocks the regenerate model picker. */
  paired: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onHover: (dragIndex: number, hoverIndex: number) => void;
  onFlip: () => void;
  onRegenerate: (variant: 'A' | 'B', model?: PairedRegenModelKey) => void;
  flipping: boolean;
  regenerating: boolean;
}

function DraggableCard({
  card, index, total, paired, onMoveUp, onMoveDown, onHover, onFlip, onRegenerate, flipping, regenerating,
}: DraggableCardProps) {
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
        {card.inFlight && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,.45)', zIndex: 2,
            gap: 6, color: '#fff', fontSize: 11.5, fontWeight: 500,
          }}>
            <Loader2 size={14} className="studio-spinner" />
            rendering…
          </div>
        )}
        {card.clipUrl ? (
          <video
            src={card.clipUrl}
            muted
            loop
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--le-muted-2)', fontSize: 11.5,
          }}>
            {card.inFlight ? '' : 'No clip'}
          </div>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: '8px 10px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <VariantBadge source={card.winnerSource} variant={card.winnerVariant} degraded={card.degraded} />

        {/* Action row */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            type="button"
            aria-label="Flip A/B winner"
            className="studio-btn-ghost"
            style={{ fontSize: 10.5, padding: '3px 7px', display: 'flex', alignItems: 'center', gap: 3 }}
            disabled={flipping || card.inFlight}
            onClick={onFlip}
          >
            {flipping ? <Loader2 size={10} className="studio-spinner" /> : <ArrowLeftRight size={10} strokeWidth={2} />}
            Flip A↔B
          </button>
          <RegenerateMenu onSelect={onRegenerate} busy={regenerating || card.inFlight} paired={paired} />
        </div>

        {/* ▲/▼ reorder controls */}
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

// ─── Helper: build card map from variants ────────────────────────────────────

function buildCardMap(variants: SceneVariantRow[]): Map<string, ClipCard> {
  // Collect per-scene info in one pass
  const map = new Map<string, ClipCard>();

  for (const v of variants) {
    const existing = map.get(v.scene_id);
    const isInFlight = Boolean(v.provider_task_id && !v.clip_url && !v.error);

    if (v.winner) {
      // Winner row wins display
      map.set(v.scene_id, {
        sceneId: v.scene_id,
        winnerVariant: v.variant,
        clipUrl: v.clip_url,
        winnerSource: v.winner_source,
        degraded: v.degraded,
        inFlight: isInFlight || (existing?.inFlight ?? false),
      });
    } else if (!existing) {
      // No winner seen yet — show the first available clip
      map.set(v.scene_id, {
        sceneId: v.scene_id,
        winnerVariant: v.clip_url ? v.variant : null,
        clipUrl: v.clip_url,
        winnerSource: v.winner_source,
        degraded: v.degraded,
        inFlight: isInFlight,
      });
    } else {
      // Merge inFlight flag
      if (isInFlight) {
        map.set(v.scene_id, { ...existing, inFlight: true });
      }
    }
  }

  return map;
}

// ─── Main inner component ─────────────────────────────────────────────────────

function CheckpointAInner({ runId, onChanged }: CheckpointAProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedOrder, setSavedOrder] = useState<string[]>([]);
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [variantsMap, setVariantsMap] = useState<Map<string, ClipCard>>(new Map());
  const [pairedSceneIds, setPairedSceneIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Per-scene action state (keyed by sceneId)
  const [flipping, setFlipping] = useState<Set<string>>(new Set());
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<{ sceneId: string; msg: string } | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      setLocalOrder((prev) => {
        // Keep local drag order if only variants changed
        if (prev.length === order.length && prev.every((id, i) => id === order[i])) return prev;
        return order;
      });
      setVariantsMap(buildCardMap(bundle.variants));
      setPairedSceneIds(new Set(bundle.paired_scene_ids ?? []));
      setError(null);

      // Manage in-flight polling
      const anyInFlight = bundle.variants.some((v) => v.provider_task_id && !v.clip_url && !v.error);
      if (anyInFlight && !pollRef.current) {
        pollRef.current = setInterval(() => { void load(); }, POLL_INTERVAL_MS);
      } else if (!anyInFlight && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clips');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const moveCard = useCallback((fromIndex: number, toIndex: number) => {
    setLocalOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const moveUp = useCallback((i: number) => moveCard(i, i - 1), [moveCard]);
  const moveDown = useCallback((i: number) => moveCard(i, i + 1), [moveCard]);
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

  const handleFlip = async (sceneId: string) => {
    setFlipping((s) => new Set(s).add(sceneId));
    setActionError(null);
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'flip_winner', scene_id: sceneId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await load();
      onChanged();
    } catch (err) {
      setActionError({ sceneId, msg: err instanceof Error ? err.message : 'Flip failed' });
    } finally {
      setFlipping((s) => { const n = new Set(s); n.delete(sceneId); return n; });
    }
  };

  const handleRegenerate = async (sceneId: string, variant: 'A' | 'B', model?: PairedRegenModelKey) => {
    setRegenerating((s) => new Set(s).add(sceneId));
    setActionError(null);
    try {
      const res = await authedFetch(`/api/admin/studio/delivery/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // model only travels for paired scenes (the menu omits it otherwise).
        body: JSON.stringify({ action: 'regenerate', scene_id: sceneId, variant, ...(model ? { model } : {}) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await load(); // will start poll if now in-flight
      onChanged();
    } catch (err) {
      setActionError({ sceneId, msg: err instanceof Error ? err.message : 'Regenerate failed' });
    } finally {
      setRegenerating((s) => { const n = new Set(s); n.delete(sceneId); return n; });
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
    .map((id) => variantsMap.get(id) ?? {
      sceneId: id, winnerVariant: null, clipUrl: null, winnerSource: null, degraded: false, inFlight: false,
    })
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

      {actionError && (
        <div className="studio-error-strip" style={{ padding: '6px 10px', fontSize: 12 }}>
          {actionError.msg}
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
              paired={pairedSceneIds.has(card.sceneId)}
              onMoveUp={() => moveUp(i)}
              onMoveDown={() => moveDown(i)}
              onHover={moveCard}
              onFlip={() => void handleFlip(card.sceneId)}
              onRegenerate={(v, model) => void handleRegenerate(card.sceneId, v, model)}
              flipping={flipping.has(card.sceneId)}
              regenerating={regenerating.has(card.sceneId)}
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
