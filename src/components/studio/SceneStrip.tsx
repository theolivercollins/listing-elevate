import { useState, type CSSProperties } from 'react';
import { FlaskConical } from 'lucide-react';
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
  gap: 5,
  padding: '4px 10px',
  fontSize: 10,
  fontWeight: 500,
  background: 'transparent',
  color: '#fff',
  border: '1px solid rgba(220,230,255,0.18)',
  borderRadius: 2,
  cursor: 'pointer',
  fontFamily: 'var(--le-font-sans)',
  whiteSpace: 'nowrap',
};

function formatRoomType(rt: string | null): string {
  if (!rt) return 'Unknown';
  return rt.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SceneStrip({ scenes, propertyId, onSwapped }: SceneStripProps) {
  const [activeScene, setActiveScene] = useState<SceneRow | null>(null);

  if (scenes.length === 0) {
    return (
      <div className="border border-dashed border-border py-10 text-center">
        <p className="text-xs text-muted-foreground/60">No scenes yet — pipeline in progress.</p>
      </div>
    );
  }

  return (
    <>
      <div
        className="flex gap-3 overflow-x-auto pb-2"
        style={{ scrollbarWidth: 'thin' }}
      >
        {scenes.map((scene) => (
          <div
            key={scene.id}
            className="flex-none w-[160px] border border-border bg-background/50"
          >
            {/* Thumbnail */}
            <div className="relative aspect-video bg-secondary overflow-hidden">
              {scene.clip_url ? (
                <video
                  src={scene.clip_url}
                  muted
                  loop
                  autoPlay
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span style={{ ...EYEBROW, fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>
                    No clip
                  </span>
                </div>
              )}
              {/* Scene number badge */}
              <span
                className="absolute top-1 left-1 px-1.5 py-0.5"
                style={{
                  background: 'rgba(0,0,0,0.65)',
                  fontFamily: 'var(--le-font-mono)',
                  fontSize: 9,
                  color: 'rgba(255,255,255,0.7)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                #{scene.scene_number}
              </span>
            </div>

            {/* Footer */}
            <div className="p-2 space-y-2">
              <p
                className="truncate leading-snug"
                style={{ fontFamily: 'var(--le-font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.55)' }}
              >
                {formatRoomType(scene.room_type)}
              </p>
              <button
                type="button"
                style={GHOST_BTN}
                onClick={() => setActiveScene(scene)}
              >
                <FlaskConical style={{ width: 10, height: 10 }} />
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
