import { useRef, useState } from 'react';
import { Loader2, UploadCloud, X } from 'lucide-react';
import {
  uploadCreativeFile,
  createUploadCreative,
  type Creative,
} from '@/lib/share-api';

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB cap (client-side, per spec)

/**
 * UploadDropzone — modal with drag/drop + file picker. Uploads the chosen file
 * to the private creatives bucket (with coarse progress), then creates the
 * creative row and fires `onCreated`.
 */
export function UploadDropzone({
  onCreated,
  onClose,
}: {
  onCreated: (creative: Creative) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('File is larger than 500 MB. Please pick a smaller file.');
      return;
    }
    if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
      setError('Only video and image files are supported.');
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const meta = await uploadCreativeFile(file, setProgress);
      const created = await createUploadCreative(meta);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div
      className="studio-modal-overlay"
      onClick={busy ? undefined : onClose}
      role="presentation"
    >
      <div
        className="studio-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Upload a creative"
      >
        <div className="share-drawer-head" style={{ position: 'static', borderBottom: 'none' }}>
          <h2>Upload a creative</h2>
          <button
            type="button"
            className="share-drawer-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className={`studio-dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !busy && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '40px 24px',
            cursor: busy ? 'default' : 'pointer',
            textAlign: 'center',
          }}
        >
          {busy ? (
            <>
              <Loader2 size={22} className="studio-spinner" style={{ color: 'var(--le-muted)' }} />
              <div style={{ width: '100%', maxWidth: 280 }}>
                <div className="share-progress">
                  <span style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <p style={{ marginTop: 8, fontSize: 12, color: 'var(--le-muted)' }}>
                  Uploading… {Math.round(progress * 100)}%
                </p>
              </div>
            </>
          ) : (
            <>
              <UploadCloud size={26} strokeWidth={1.5} style={{ color: 'var(--le-muted)' }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--le-ink)' }}>
                Drop a video or image here
              </div>
              <div style={{ fontSize: 12, color: 'var(--le-muted)' }}>
                or click to browse · up to 500 MB
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="video/*,image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
        </div>

        {error && (
          <div className="studio-error-strip" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
