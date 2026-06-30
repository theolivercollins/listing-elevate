import { useState } from 'react';
import { FlaskConical, Loader2, AlertTriangle } from 'lucide-react';
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

type DegradedTone = 'queued' | 'generating' | 'needs_review' | 'failed';

interface DegradedSceneMeta {
  label: string;
  /** matches a .studio-status-pill modifier class defined in studio-design.css */
  pillClass: DegradedTone;
  icon: 'loader' | 'alert';
}

/**
 * Maps a clip-less scene's `status` (lib/types.ts SceneStatus) to a visible
 * tile treatment, so a degraded/failed scene reads as "needs attention"
 * instead of "missing". Reuses the existing studio-status-pill tone classes.
 */
function getDegradedSceneMeta(status: string): DegradedSceneMeta {
  switch (status) {
    case 'pending':
      return { label: 'Queued', pillClass: 'queued', icon: 'loader' };
    case 'generating':
    case 'retry_1':
    case 'retry_2':
      return { label: 'Generating…', pillClass: 'generating', icon: 'loader' };
    case 'qc_pass':
      return { label: 'Processing', pillClass: 'generating', icon: 'loader' };
    case 'qc_soft_reject':
    case 'qc_hard_reject':
    case 'needs_review':
      return { label: 'Needs review', pillClass: 'needs_review', icon: 'alert' };
    case 'failed':
      return { label: 'Generation failed', pillClass: 'failed', icon: 'alert' };
    default:
      return { label: 'No clip', pillClass: 'queued', icon: 'alert' };
  }
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
                (() => {
                  const meta = getDegradedSceneMeta(scene.status);
                  return (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        height: '100%',
                        color: 'var(--le-muted-2)',
                      }}
                    >
                      {meta.icon === 'loader' ? (
                        <Loader2 size={18} strokeWidth={1.6} className="studio-spinner" />
                      ) : (
                        <AlertTriangle size={18} strokeWidth={1.6} />
                      )}
                      <span
                        className={`studio-status-pill ${meta.pillClass}`}
                        style={{
                          position: 'absolute',
                          bottom: 6,
                          left: 6,
                          right: 6,
                          justifyContent: 'center',
                          fontSize: 10,
                          padding: '3px 6px',
                        }}
                      >
                        {meta.label}
                      </span>
                    </div>
                  );
                })()
              )}
              {/* Scene number badge */}
              <span
                style={{
                  position: 'absolute',
                  top: 6,
                  left: 6,
                  background: 'rgba(11,11,16,0.65)',
                  backdropFilter: 'blur(4px)',
                  borderRadius: "var(--le-r-sm)",
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
