import { useState } from 'react';
import { FlaskConical, Image } from 'lucide-react';
import { IterateInLabModal } from './IterateInLabModal';

interface SceneRow {
  id: string;
  scene_number: number;
  room_type: string | null;
  clip_url: string | null;
  status: string;
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

/**
 * SceneStrip — horizontal-scroll strip of scene thumbnails.
 * Each card: 200×120 (16:9) with clip or placeholder, room_type label,
 * and "Iterate in Lab" ghost button.
 * Must be inside a .studio-scope wrapper.
 */
export function SceneStrip({ scenes, propertyId, onSwapped }: SceneStripProps) {
  const [activeScene, setActiveScene] = useState<SceneRow | null>(null);

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
            {/* 16:9 thumbnail area */}
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

            {/* Footer */}
            <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
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
              <button
                type="button"
                className="studio-btn-ghost studio-btn-sm"
                onClick={() => setActiveScene(scene)}
              >
                <FlaskConical size={11} strokeWidth={1.6} />
                Iterate in Lab
              </button>
            </div>
          </div>
        ))}
      </div>

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
