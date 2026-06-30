import { useState } from 'react';
import type { JSX } from 'react';
import { Loader2, FolderOpen, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authedFetch } from '@/lib/api';

// ─── Public types ─────────────────────────────────────────────────────────────

export type DrivePullResult = {
  address: string;
  metadata: {
    price: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    sqft: number | null;
  };
  photos: { path: string; url: string }[];
};

// ─── Internal types ───────────────────────────────────────────────────────────

type DriveFolder = {
  id: string;
  name: string;
  photoCount: number | null;
};

type PullApiResponse = DrivePullResult & {
  photoCount: number;
  mlsError?: string;
};

type BrowseState =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'loaded'; folders: DriveFolder[] }
  | { type: 'error'; message: string };

type PullState =
  | { type: 'idle' }
  | { type: 'pulling'; folderId: string }
  | { type: 'success'; photoCount: number; mlsError?: string }
  | { type: 'error'; folderId: string; message: string };

// ─── Component ────────────────────────────────────────────────────────────────

export function DrivePullPanel({ onPulled }: { onPulled: (result: DrivePullResult) => void }): JSX.Element {
  const [browse, setBrowse] = useState<BrowseState>({ type: 'idle' });
  const [pull, setPull] = useState<PullState>({ type: 'idle' });

  async function handleBrowse() {
    setBrowse({ type: 'loading' });
    setPull({ type: 'idle' });
    try {
      const res = await authedFetch('/api/admin/studio/drive/folders');
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status}: ${text || res.statusText}`);
      }
      const data = (await res.json()) as { folders: DriveFolder[] };
      setBrowse({ type: 'loaded', folders: data.folders ?? [] });
    } catch (err) {
      setBrowse({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load folders',
      });
    }
  }

  async function handlePull(folder: DriveFolder) {
    if (pull.type === 'pulling') return;
    setPull({ type: 'pulling', folderId: folder.id });
    try {
      const res = await authedFetch('/api/admin/studio/drive/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: folder.id, folderName: folder.name }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status}: ${text || res.statusText}`);
      }
      const data = (await res.json()) as PullApiResponse;
      setPull({ type: 'success', photoCount: data.photoCount, mlsError: data.mlsError });
      onPulled({ address: data.address, metadata: data.metadata, photos: data.photos });
    } catch (err) {
      setPull({
        type: 'error',
        folderId: folder.id,
        message: err instanceof Error ? err.message : 'Failed to pull folder',
      });
    }
  }

  const isPulling = pull.type === 'pulling';
  const folders = browse.type === 'loaded' ? browse.folders : [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle
          className="text-base font-semibold"
          style={{ color: 'var(--le-ink)', fontSize: 14 }}
        >
          Pull from Google Drive
        </CardTitle>
        <CardDescription style={{ color: 'var(--le-muted)', fontSize: 12.5 }}>
          Brian&apos;s 2026 listing photos
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Browse button */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleBrowse()}
          disabled={browse.type === 'loading' || isPulling}
          aria-label="Browse Google Drive folders"
        >
          {browse.type === 'loading' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <FolderOpen size={13} strokeWidth={1.8} />
          )}
          {browse.type === 'loading' ? 'Loading…' : 'Browse folders'}
        </Button>

        {/* Browse error */}
        {browse.type === 'error' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle
              size={13}
              aria-hidden="true"
              style={{ color: 'var(--le-bad, #b42318)', flexShrink: 0 }}
            />
            <span style={{ fontSize: 12.5, color: 'var(--le-bad, #b42318)' }}>
              {browse.message}
            </span>
            <button
              type="button"
              className="studio-btn-ghost studio-btn-sm"
              onClick={() => void handleBrowse()}
              aria-label="Retry loading folders"
            >
              <RefreshCw size={11} strokeWidth={1.8} aria-hidden="true" />
              Retry
            </button>
          </div>
        )}

        {/* Folder list */}
        {browse.type === 'loaded' && (
          <>
            {folders.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--le-muted)', margin: 0 }}>
                No folders found.
              </p>
            ) : (
              <ul
                role="list"
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                {folders.map((folder) => {
                  const isThisRowPulling = isPulling && pull.type === 'pulling' && pull.folderId === folder.id;
                  const isThisRowError = pull.type === 'error' && pull.folderId === folder.id;
                  return (
                    <li key={folder.id}>
                      <button
                        type="button"
                        className="studio-btn-ghost"
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          padding: '6px 10px',
                          opacity: isPulling && !isThisRowPulling ? 0.5 : 1,
                          cursor: isPulling ? 'not-allowed' : 'pointer',
                          borderRadius: 6,
                        }}
                        onClick={() => void handlePull(folder)}
                        disabled={isPulling}
                        aria-label={`Pull folder ${folder.name}`}
                        aria-busy={isThisRowPulling}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: 'var(--le-ink)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {folder.name}
                        </span>
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            flexShrink: 0,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 500,
                              color: 'var(--le-muted)',
                              background: 'rgba(11,11,16,0.05)',
                              borderRadius: 999,
                              padding: '1px 7px',
                            }}
                          >
                            {folder.photoCount != null ? `${folder.photoCount} photos` : '—'}
                          </span>
                          {isThisRowPulling && (
                            <Loader2
                              size={13}
                              className="animate-spin"
                              aria-hidden="true"
                              style={{ color: 'var(--le-muted)' }}
                            />
                          )}
                        </span>
                      </button>

                      {isThisRowError && (
                        <p
                          role="alert"
                          style={{
                            fontSize: 12,
                            color: 'var(--le-bad, #b42318)',
                            margin: '2px 10px 0',
                          }}
                        >
                          {pull.message}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {/* Pull success */}
        {pull.type === 'success' && (
          <div
            role="status"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <CheckCircle
              size={13}
              aria-hidden="true"
              style={{ color: 'var(--le-good, #027a48)', flexShrink: 0 }}
            />
            <span style={{ fontSize: 12.5, color: 'var(--le-good, #027a48)' }}>
              Pulled {pull.photoCount} photos{' '}
              {pull.mlsError
                ? '· Redfin enrichment unavailable'
                : '· enriched from Redfin'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
