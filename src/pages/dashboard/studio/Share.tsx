import { useCallback, useEffect, useState } from 'react';
import { Film, Loader2, Upload } from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { StudioShell } from '@/components/studio/StudioShell';
import { ShareLibrary } from '@/components/studio/share/ShareLibrary';
import { UploadDropzone } from '@/components/studio/share/UploadDropzone';
import { RenderPicker } from '@/components/studio/share/RenderPicker';
import { CreativeSettingsPanel } from '@/components/studio/share/CreativeSettingsPanel';
import {
  listCreatives,
  patchCreative,
  deleteCreative,
  type Creative,
  type CreativePatch,
} from '@/lib/share-api';
import '@/styles/share-studio.css';

/**
 * StudioShare — the Operator Studio "Share" tab. Lists shareable creatives,
 * lets the operator upload new ones or pull rendered property videos, and opens
 * a Vimeo-style settings drawer per creative for privacy / embed / download /
 * sharing configuration.
 */
const StudioShare = () => {
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [renderOpen, setRenderOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await listCreatives();
      setCreatives(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load creatives.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = creatives.find((c) => c.id === selectedId) ?? null;

  const handleCreated = useCallback(
    async (created: Creative) => {
      setUploadOpen(false);
      setRenderOpen(false);
      // Optimistically prepend, then reconcile from the server.
      setCreatives((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
      await refresh();
    },
    [refresh],
  );

  const handlePatch = useCallback(
    async (id: string, patch: CreativePatch) => {
      const updated = await patchCreative(id, patch);
      setCreatives((prev) => prev.map((c) => (c.id === id ? updated : c)));
    },
    [],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteCreative(id);
      setCreatives((prev) => prev.filter((c) => c.id !== id));
      setSelectedId(null);
    },
    [],
  );

  return (
    <StudioShell>
      <div className="studio-page-heading">
        <div>
          <span className="studio-page-eyebrow">Operator Studio</span>
          <h1 className="studio-page-h1">Share</h1>
          <p className="studio-page-sub">
            Upload creatives or pull rendered property videos, then share them with a
            presentation link or embed.
          </p>
        </div>
        <div className="studio-page-actions">
          <button type="button" className="studio-btn-ghost" onClick={() => setRenderOpen(true)}>
            <Film size={13} strokeWidth={2} />
            Add from renders
          </button>
          <button type="button" className="studio-cta-primary" onClick={() => setUploadOpen(true)}>
            <Upload size={13} strokeWidth={2} />
            Upload
          </button>
        </div>
      </div>

      <StudioNav />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
          <Loader2 size={20} className="studio-spinner" style={{ color: 'var(--le-muted)' }} />
        </div>
      ) : error ? (
        <div className="studio-error-strip">{error}</div>
      ) : (
        <div style={{ marginTop: 22 }}>
          <ShareLibrary
            creatives={creatives}
            onSelect={(c) => setSelectedId(c.id)}
            onUploadClick={() => setUploadOpen(true)}
          />
        </div>
      )}

      {uploadOpen && (
        <UploadDropzone onCreated={handleCreated} onClose={() => setUploadOpen(false)} />
      )}
      {renderOpen && (
        <RenderPicker onCreated={handleCreated} onClose={() => setRenderOpen(false)} />
      )}
      {selected && (
        <CreativeSettingsPanel
          creative={selected}
          onPatch={handlePatch}
          onDelete={handleDelete}
          onClose={() => setSelectedId(null)}
        />
      )}
    </StudioShell>
  );
};

export default StudioShare;
