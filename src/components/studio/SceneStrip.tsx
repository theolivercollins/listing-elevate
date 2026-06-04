import { useState } from 'react';
import { FlaskConical, Image, X } from 'lucide-react';
import { IterateInLabModal } from './IterateInLabModal';

interface SceneRow {
  id: string;
  scene_number: number;
  room_type: string | null;
  clip_url: string | null;
  status: string;
  prompt: string | null;
  camera_movement: string | null;
  provider: string | null;
}

interface SceneStripProps {
  scenes: SceneRow[];
  propertyId: string;
  onSwapped: () => void;
}

function formatRoomType(rt: string | null): string {
  if (!rt) return 'Unknown';
  return rt.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCameraMovement(cm: string | null): string {
  if (!cm) return '—';
  return cm.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Scene detail modal ────────────────────────────────────────────────────────

interface SceneDetailModalProps {
  scene: SceneRow;
  onClose: () => void;
}

function SceneDetailModal({ scene, onClose }: SceneDetailModalProps) {
  return (
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
          maxWidth: 600,
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
            <span className="studio-section-eyebrow" style={{ marginBottom: 4 }}>
              Scene prompt
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
            style={{ padding: '6px 8px', borderRadius: 10 }}
            aria-label="Close"
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Metadata row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '10px 16px',
              padding: '12px 14px',
              background: 'rgba(11,11,16,0.025)',
              borderRadius: 'var(--le-radius-sm)',
            }}
          >
            <div>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--le-muted)', marginBottom: 3 }}>
                Camera
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--le-ink-2)' }}>
                {formatCameraMovement(scene.camera_movement)}
              </span>
            </div>
            <div>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--le-muted)', marginBottom: 3 }}>
                Provider
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--le-ink-2)', textTransform: 'capitalize' }}>
                {scene.provider ?? '—'}
              </span>
            </div>
            <div>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--le-muted)', marginBottom: 3 }}>
                Status
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--le-ink-2)', textTransform: 'capitalize' }}>
                {scene.status}
              </span>
            </div>
          </div>

          {/* Prompt */}
          <div>
            <span
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--le-muted)',
                marginBottom: 8,
              }}
            >
              Generation prompt
            </span>
            {scene.prompt ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  color: 'var(--le-ink)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {scene.prompt}
              </p>
            ) : (
              <p
                style={{
                  margin: 0,
                  fontSize: 13.5,
                  color: 'var(--le-muted-2)',
                  fontStyle: 'italic',
                }}
              >
                No prompt recorded
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * SceneStrip — horizontal-scroll strip of scene thumbnails.
 * Each card: 200×120 (16:9) with clip or placeholder, room_type label,
 * camera movement caption, and action buttons.
 * Clicking the card thumbnail/room label opens a SceneDetailModal showing
 * the full generation prompt, camera movement, provider, and status.
 * Must be inside a .studio-scope wrapper.
 */
export function SceneStrip({ scenes, propertyId, onSwapped }: SceneStripProps) {
  const [activeScene, setActiveScene] = useState<SceneRow | null>(null);
  const [detailScene, setDetailScene] = useState<SceneRow | null>(null);

  if (scenes.length === 0) {
    return (
      <div className="studio-kanban-empty" style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ fontSize: 12.5, color: 'var(--le-muted)' }}>
          No scenes yet — pipeline in progress.
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        className="studio-hscroll"
        style={{ display: 'flex', gap: 12, paddingBottom: 4 }}
      >
        {scenes.map((scene) => (
          <div
            key={scene.id}
            style={{
              flexShrink: 0,
              width: 200,
              background: 'var(--le-surface)',
              borderRadius: 'var(--le-radius-sm)',
              boxShadow: 'var(--le-shadow-sm)',
              overflow: 'hidden',
            }}
          >
            {/* 16:9 thumbnail area — clickable to reveal prompt */}
            <button
              type="button"
              onClick={() => setDetailScene(scene)}
              style={{
                display: 'block',
                width: '100%',
                padding: 0,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              aria-label={`View prompt for scene #${scene.scene_number}`}
            >
              <div
                style={{
                  position: 'relative',
                  aspectRatio: '16/9',
                  background: 'rgba(11,11,16,0.06)',
                  overflow: 'hidden',
                }}
              >
                {scene.clip_url ? (
                  <video
                    src={scene.clip_url}
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
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      color: 'var(--le-muted-2)',
                    }}
                  >
                    <Image size={20} strokeWidth={1.4} />
                  </div>
                )}
                {/* Scene number badge */}
                <span
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    background: 'rgba(11,11,16,0.65)',
                    backdropFilter: 'blur(4px)',
                    borderRadius: 6,
                    padding: '2px 6px',
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.85)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  #{scene.scene_number}
                </span>
              </div>
            </button>

            {/* Footer */}
            <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {/* Room label — also clickable */}
              <button
                type="button"
                onClick={() => setDetailScene(scene)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  width: '100%',
                }}
              >
                <p
                  style={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: 'var(--le-ink-2)',
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatRoomType(scene.room_type)}
                </p>
                {scene.camera_movement && (
                  <p
                    style={{
                      fontSize: 10.5,
                      color: 'var(--le-muted)',
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatCameraMovement(scene.camera_movement)}
                  </p>
                )}
              </button>
              <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                <button
                  type="button"
                  className="studio-btn-ghost"
                  style={{ fontSize: 11, padding: '5px 10px', gap: 5, flex: 1, justifyContent: 'center' }}
                  onClick={() => setActiveScene(scene)}
                >
                  <FlaskConical size={11} strokeWidth={1.6} />
                  Iterate in Lab
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {detailScene && (
        <SceneDetailModal
          scene={detailScene}
          onClose={() => setDetailScene(null)}
        />
      )}

      {activeScene && (
        <IterateInLabModal
          scene={activeScene}
          propertyId={propertyId}
          onClose={() => setActiveScene(null)}
          onSwapped={() => {
            setActiveScene(null);
            onSwapped();
          }}
        />
      )}
    </>
  );
}
