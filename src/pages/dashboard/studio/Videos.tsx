import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, ChevronDown, ChevronLeft, ChevronRight, Play, Check, Film,
  MoreHorizontal, FolderInput, Archive, ArchiveRestore, Trash2, Plus,
  Pencil, FolderX, ArrowUp, ArrowDown, Upload, Link2,
} from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { StudioShell } from '@/components/studio/StudioShell';
import { UploadDropzone } from '@/components/studio/share/UploadDropzone';
import { getRelativeTime } from '@/lib/types';
import { authedFetch } from '@/lib/api';
import { photoThumb } from '@/lib/image-url';
import {
  fetchFolders, createFolder, renameFolder, reorderFolder, deleteFolder,
  videoLibraryAction, type VideoFolder,
} from '@/lib/studio/library-api';
import type { Creative } from '@/lib/share-api';
import '@/styles/share-studio.css';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

// ─── Types (mirror GET /api/admin/studio/videos item shape, including uploads) ───

interface VideoItem {
  id: string;
  title?: string;
  description?: string | null;
  address: string | null;
  videos: { horizontal: string | null; vertical: string | null };
  approved_at: string | null;
  created_at: string;
  client: { id: string; name: string } | null;
  hero_photo_url: string | null;
  link_count: number;
  total_views: number;
  // Library-management fields (spec §1 — present once migration 086 lands; the
  // list endpoint returns null/absent pre-migration, hence the optional shape).
  folder_id?: string | null;
  archived_at?: string | null;
  library_source?: 'property' | 'upload';
  share_token?: string;
  shareUrl?: string;
  embedUrl?: string;
  manageUrl?: string;
}

interface VideosResponse {
  items: VideoItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface ClientOption {
  id: string;
  name: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Split an address into a street line and a locality line for the two-tier card
 * label. We split on the first comma: everything before is the street, the rest is
 * city/region. Falls back gracefully when there's no comma or no address at all.
 */
function splitAddress(address: string | null): { street: string; locality: string } {
  if (!address) return { street: 'Untitled property', locality: '' };
  const idx = address.indexOf(',');
  if (idx === -1) return { street: address.trim(), locality: '' };
  return {
    street: address.slice(0, idx).trim(),
    locality: address.slice(idx + 1).trim(),
  };
}

function manageUrlForCreative(id: string): string {
  return `/dashboard/studio/video/share?creative=${id}`;
}

function videoItemFromCreative(creative: Creative): VideoItem {
  return {
    id: creative.id,
    title: creative.title,
    description: creative.description,
    address: creative.title,
    videos: { horizontal: creative.public_url ?? creative.previewUrl, vertical: null },
    approved_at: null,
    created_at: creative.created_at,
    client: null,
    hero_photo_url: creative.thumbnail_url,
    link_count: 1,
    total_views: creative.view_count ?? 0,
    folder_id: null,
    archived_at: null,
    library_source: 'upload',
    share_token: creative.share_token,
    shareUrl: creative.shareUrl,
    embedUrl: creative.embedUrl,
    manageUrl: manageUrlForCreative(creative.id),
  };
}

// ─── Card ⋯ menu ────────────────────────────────────────────────────────────────
//
// A minimal accessible dropdown (Escape closes, click-outside closes, focusable
// trigger) matching the studio design language — the surface already ships the
// shadcn dropdown-menu but the library grid uses the hand-tuned le-video-* /
// studio-* token vocabulary, so we compose a small menu in that idiom rather than
// blending a second design language onto a showcase surface.

interface CardMenuProps {
  archived: boolean;
  folders: VideoFolder[];
  currentFolderId: string | null | undefined;
  foldersAvailable: boolean;
  onMove: (folderId: string | null) => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
}

function CardMenu({
  archived, folders, currentFolderId, foldersAvailable,
  onMove, onArchiveToggle, onDelete,
}: CardMenuProps) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setSubmenu(false);
  }

  return (
    <div className="le-video-menu" ref={ref}>
      <button
        type="button"
        className="le-video-menu-trigger"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>

      {open && (
        <div className="le-video-menu-pop" role="menu" onClick={(e) => e.preventDefault()}>
          {foldersAvailable && (
            <div
              className="le-video-menu-sub"
              onMouseEnter={() => setSubmenu(true)}
              onMouseLeave={() => setSubmenu(false)}
            >
              <button
                type="button"
                className="le-video-menu-item"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={submenu}
                onClick={() => setSubmenu((s) => !s)}
              >
                <FolderInput size={14} strokeWidth={1.8} />
                <span>Move to folder</span>
                <ChevronRight size={13} strokeWidth={1.8} style={{ marginLeft: 'auto' }} />
              </button>
              {submenu && (
                <div className="le-video-menu-pop le-video-menu-pop-nested" role="menu">
                  {folders.length === 0 && (
                    <div className="le-video-menu-note">No folders yet</div>
                  )}
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="le-video-menu-item"
                      role="menuitemradio"
                      aria-checked={currentFolderId === f.id}
                      onClick={() => { onMove(f.id); close(); }}
                    >
                      <span>{f.name}</span>
                      {currentFolderId === f.id && (
                        <Check size={13} strokeWidth={2.2} style={{ marginLeft: 'auto' }} />
                      )}
                    </button>
                  ))}
                  {currentFolderId && (
                    <>
                      <div className="le-video-menu-divider" role="separator" />
                      <button
                        type="button"
                        className="le-video-menu-item"
                        role="menuitem"
                        onClick={() => { onMove(null); close(); }}
                      >
                        <FolderX size={14} strokeWidth={1.8} />
                        <span>Remove from folder</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            className="le-video-menu-item"
            role="menuitem"
            onClick={() => { onArchiveToggle(); close(); }}
          >
            {archived ? (
              <><ArchiveRestore size={14} strokeWidth={1.8} /><span>Restore</span></>
            ) : (
              <><Archive size={14} strokeWidth={1.8} /><span>Archive</span></>
            )}
          </button>

          <div className="le-video-menu-divider" role="separator" />

          <button
            type="button"
            className="le-video-menu-item le-video-menu-item-danger"
            role="menuitem"
            onClick={() => { close(); onDelete(); }}
          >
            <Trash2 size={14} strokeWidth={1.8} />
            <span>Delete…</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function VideoCard({
  item, archivedView, folders, foldersAvailable, onMove, onArchiveToggle, onDelete,
}: {
  item: VideoItem;
  archivedView: boolean;
  folders: VideoFolder[];
  foldersAvailable: boolean;
  onMove: (folderId: string | null) => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
}) {
  const hosted = item.library_source === 'upload';
  const { street, locality } = hosted
    ? {
      street: item.title ?? item.address ?? 'Untitled hosted video',
      locality: item.description ?? 'Hosted upload',
    }
    : splitAddress(item.address);
  const hasH = !!item.videos.horizontal;
  const hasV = !!item.videos.vertical;
  const cardTo = hosted ? item.manageUrl ?? manageUrlForCreative(item.id) : `/dashboard/studio/videos/${item.id}`;

  return (
    <div className="le-video-card-wrap">
      <Link
        to={cardTo}
        className="le-video-card"
        aria-label={hosted ? `Open settings for ${street}` : item.address ?? 'Untitled property'}
      >
        {/* Poster */}
        <div className="le-video-card-poster">
          {item.hero_photo_url ? (
            <img src={photoThumb(item.hero_photo_url)} alt="" loading="lazy" decoding="async" />
          ) : (
            <div className="le-video-card-poster-empty" aria-hidden="true">
              <Film size={26} strokeWidth={1.4} />
            </div>
          )}
          {/* Hover play affordance — the showcase moment */}
          <div className="le-video-card-scrim" aria-hidden="true">
            <span className="le-video-card-play">
              <Play size={18} strokeWidth={2} fill="currentColor" />
            </span>
          </div>
          {/* Orientation badges, top-left */}
          <div className="le-video-card-badges" aria-hidden="true">
            {hosted && <span className="le-video-orient-badge le-video-hosted-badge">Hosted</span>}
            {hasH && <span className="le-video-orient-badge">16:9</span>}
            {hasV && <span className="le-video-orient-badge">9:16</span>}
          </div>
          {/* Approved badge, top-right */}
          {item.approved_at ? (
            <span className="le-video-approved-badge">
              <Check size={10} strokeWidth={2.4} />
              Approved
            </span>
          ) : hosted && item.shareUrl ? (
            <span className="le-video-approved-badge le-video-share-badge">
              <Link2 size={10} strokeWidth={2.4} />
              Share-ready
            </span>
          ) : (
            null
          )}
        </div>

        {/* Meta */}
        <div className="le-video-card-meta">
          <div className="le-video-card-title">{street}</div>
          {locality && <div className="le-video-card-locality">{locality}</div>}
          <div className="le-video-card-footer">
            <span className="le-video-card-client">{hosted ? 'Hosted upload' : item.client?.name ?? '—'}</span>
            <span className="le-video-card-stats">
              <span className="le-video-card-views" title={`${item.total_views} views`}>
                {item.total_views.toLocaleString()}
                <span className="le-video-card-views-label"> views</span>
              </span>
              <span className="le-video-card-dot" aria-hidden="true">·</span>
              <span className="le-video-card-date">{getRelativeTime(item.created_at)}</span>
            </span>
          </div>
        </div>
      </Link>

      {/* ⋯ menu — sibling of the link so clicks never trigger navigation */}
      {!hosted && (
        <CardMenu
          archived={archivedView}
          folders={folders}
          currentFolderId={item.folder_id}
          foldersAvailable={foldersAvailable}
          onMove={onMove}
          onArchiveToggle={onArchiveToggle}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

// ─── Delete-confirm dialog ────────────────────────────────────────────────────────

function DeleteDialog({
  onCancel, onConfirm, busy,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="studio-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="studio-modal le-video-delete-modal" role="dialog" aria-modal="true" aria-labelledby="le-del-title">
        <div className="le-video-delete-body">
          <span className="le-video-delete-icon" aria-hidden="true">
            <Trash2 size={20} strokeWidth={1.6} />
          </span>
          <h2 id="le-del-title" className="le-video-delete-title">Permanently delete this video?</h2>
          <p className="le-video-delete-text">
            Its share links will stop working. This can&rsquo;t be undone.
          </p>
        </div>
        <div className="le-video-delete-actions">
          <button type="button" className="studio-btn-ghost studio-btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="le-video-btn-danger studio-btn-sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Deleting…' : 'Delete video'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Folder rail ──────────────────────────────────────────────────────────────────
//
// Horizontal pill strip above the grid (DESIGN-GUIDE): All videos · folders with
// tabular-nums counts · Archived, plus ＋ New folder and inline rename / reorder /
// delete via a small per-folder edit affordance.

type RailView =
  | { kind: 'all' }
  | { kind: 'folder'; id: string }
  | { kind: 'archived' };

interface FolderRailProps {
  folders: VideoFolder[];
  foldersAvailable: boolean;
  view: RailView;
  onSelect: (v: RailView) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (id: string, dir: -1 | 1) => void;
  onDeleteFolder: (id: string) => void;
}

function FolderRail({
  folders, foldersAvailable, view, onSelect,
  onCreate, onRename, onReorder, onDeleteFolder,
}: FolderRailProps) {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const createRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (creating) createRef.current?.focus(); }, [creating]);
  useEffect(() => { if (editingId) editRef.current?.focus(); }, [editingId]);

  function submitCreate() {
    const name = draftName.trim();
    if (name) onCreate(name);
    setDraftName('');
    setCreating(false);
  }
  function submitEdit(id: string) {
    const name = editName.trim();
    if (name) onRename(id, name);
    setEditingId(null);
  }

  const confirmFolder = folders.find((f) => f.id === confirmDeleteId);

  return (
    <div className="le-video-rail" role="tablist" aria-label="Video library views">
      <button
        type="button"
        role="tab"
        aria-selected={view.kind === 'all'}
        className={`le-video-rail-pill${view.kind === 'all' ? ' is-active' : ''}`}
        onClick={() => onSelect({ kind: 'all' })}
      >
        All videos
      </button>

      {foldersAvailable && folders.map((f, i) => {
        const active = view.kind === 'folder' && view.id === f.id;
        if (editingId === f.id) {
          return (
            <span key={f.id} className="le-video-rail-edit">
              <input
                ref={editRef}
                className="studio-input le-video-rail-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitEdit(f.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onBlur={() => submitEdit(f.id)}
                aria-label={`Rename folder ${f.name}`}
              />
            </span>
          );
        }
        return (
          <span key={f.id} className={`le-video-rail-folder${active ? ' is-active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className={`le-video-rail-pill le-video-rail-pill-folder${active ? ' is-active' : ''}`}
              onClick={() => onSelect({ kind: 'folder', id: f.id })}
            >
              <span className="le-video-rail-name">{f.name}</span>
              <span className="le-video-rail-count" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {f.video_count}
              </span>
            </button>
            {active && (
              <span className="le-video-rail-tools">
                <button
                  type="button" className="le-video-rail-tool" aria-label={`Move ${f.name} earlier`}
                  disabled={i === 0} onClick={() => onReorder(f.id, -1)}
                >
                  <ArrowUp size={12} strokeWidth={2} />
                </button>
                <button
                  type="button" className="le-video-rail-tool" aria-label={`Move ${f.name} later`}
                  disabled={i === folders.length - 1} onClick={() => onReorder(f.id, 1)}
                >
                  <ArrowDown size={12} strokeWidth={2} />
                </button>
                <button
                  type="button" className="le-video-rail-tool" aria-label={`Rename ${f.name}`}
                  onClick={() => { setEditingId(f.id); setEditName(f.name); }}
                >
                  <Pencil size={12} strokeWidth={2} />
                </button>
                <button
                  type="button" className="le-video-rail-tool le-video-rail-tool-danger"
                  aria-label={`Delete folder ${f.name}`}
                  onClick={() => setConfirmDeleteId(f.id)}
                >
                  <Trash2 size={12} strokeWidth={2} />
                </button>
              </span>
            )}
          </span>
        );
      })}

      {foldersAvailable && (
        creating ? (
          <span className="le-video-rail-edit">
            <input
              ref={createRef}
              className="studio-input le-video-rail-input"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreate();
                if (e.key === 'Escape') { setDraftName(''); setCreating(false); }
              }}
              onBlur={submitCreate}
              placeholder="Folder name"
              aria-label="New folder name"
            />
          </span>
        ) : (
          <button
            type="button"
            className="le-video-rail-add"
            onClick={() => setCreating(true)}
          >
            <Plus size={13} strokeWidth={2} />
            New folder
          </button>
        )
      )}

      <span className="le-video-rail-spacer" />

      <button
        type="button"
        role="tab"
        aria-selected={view.kind === 'archived'}
        className={`le-video-rail-pill le-video-rail-archived${view.kind === 'archived' ? ' is-active' : ''}`}
        onClick={() => onSelect({ kind: 'archived' })}
      >
        <Archive size={13} strokeWidth={1.8} />
        Archived
      </button>

      {/* Folder-delete confirm — explains videos are un-filed, not deleted */}
      {confirmFolder && (
        <div
          className="studio-modal-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmDeleteId(null); }}
        >
          <div className="studio-modal le-video-delete-modal" role="dialog" aria-modal="true" aria-labelledby="le-folder-del-title">
            <div className="le-video-delete-body">
              <span className="le-video-delete-icon" aria-hidden="true">
                <FolderX size={20} strokeWidth={1.6} />
              </span>
              <h2 id="le-folder-del-title" className="le-video-delete-title">
                Delete “{confirmFolder.name}”?
              </h2>
              <p className="le-video-delete-text">
                Its videos won&rsquo;t be deleted — they&rsquo;ll just move back to <strong>All videos</strong>.
              </p>
            </div>
            <div className="le-video-delete-actions">
              <button type="button" className="studio-btn-ghost studio-btn-sm" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="le-video-btn-danger studio-btn-sm"
                onClick={() => {
                  onDeleteFolder(confirmFolder.id);
                  setConfirmDeleteId(null);
                  if (view.kind === 'folder' && view.id === confirmFolder.id) onSelect({ kind: 'all' });
                }}
              >
                Delete folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────────

function VideosSkeleton() {
  return (
    <div className="le-video-grid" data-testid="videos-skeleton" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="le-video-card le-video-card-skeleton">
          <div className="le-video-card-poster le-skeleton-shimmer" />
          <div className="le-video-card-meta">
            <div className="le-skeleton-line le-skeleton-shimmer" style={{ width: '70%' }} />
            <div className="le-skeleton-line le-skeleton-shimmer" style={{ width: '45%', marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────────

const Videos = () => {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  // Library management state (spec §3).
  const [folders, setFolders] = useState<VideoFolder[]>([]);
  const [foldersAvailable, setFoldersAvailable] = useState(false);
  const [view, setView] = useState<RailView>({ kind: 'all' });
  const [pendingDelete, setPendingDelete] = useState<VideoItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [hostedUpload, setHostedUpload] = useState<Creative | null>(null);

  const archivedView = view.kind === 'archived';

  // Load folders. A non-null response means the feature is live (migration 086
  // applied); null means pre-migration (503) — hide folder management, keep the
  // grid + Archived/All entirely functional.
  const reloadFolders = useCallback(async () => {
    const res = await fetchFolders();
    if (res === null) {
      setFoldersAvailable(false);
      setFolders([]);
    } else {
      setFoldersAvailable(true);
      setFolders(res);
    }
  }, []);

  useEffect(() => { void reloadFolders(); }, [reloadFolders]);

  // Load the client dropdown once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/admin/studio/clients');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setClients((data.clients ?? []).map((c: ClientOption) => ({ id: c.id, name: c.name })));
      } catch {
        /* dropdown is non-essential; ignore */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounce the search input → debouncedSearch.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const folderKey = view.kind === 'folder' ? view.id : '';

  // Reset to page 1 whenever a filter or rail view changes.
  useEffect(() => {
    setPage(1);
  }, [clientId, fromDate, toDate, debouncedSearch, view.kind, folderKey]);

  // Fetch the library whenever a query input changes.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (clientId) params.set('client_id', clientId);
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (view.kind === 'folder') params.set('folder', view.id);
    if (view.kind === 'archived') params.set('archived', '1');
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    const url = `/api/admin/studio/videos${qs ? `?${qs}` : ''}`;

    setLoading(true);
    (async () => {
      try {
        const res = await authedFetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data: VideosResponse = await res.json();
        if (!cancelled) {
          setItems(data.items ?? []);
          setTotal(data.total ?? 0);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load videos');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, debouncedSearch, fromDate, toDate, page, view.kind, folderKey]);

  // ─── Library actions (optimistic, with rollback on error) ────────────────────

  // Optimistically remove an item from the current view (archive/restore/delete
  // all take the card out of whatever list it's currently in). On error, restore.
  const optimisticRemove = useCallback(
    async (item: VideoItem, run: () => Promise<boolean>) => {
      setActionError(null);
      const prevItems = items;
      const prevTotal = total;
      setItems((cur) => cur.filter((i) => i.id !== item.id));
      setTotal((t) => Math.max(0, t - 1));
      const ok = await run();
      if (!ok) {
        setItems(prevItems);
        setTotal(prevTotal);
        setActionError('That action could not be completed. Please try again.');
      } else {
        void reloadFolders();
      }
    },
    [items, total, reloadFolders],
  );

  const handleMove = useCallback(
    async (item: VideoItem, folderId: string | null) => {
      setActionError(null);
      // In a folder view, moving out of that folder removes the card; otherwise
      // just patch folder_id in place.
      const leavesView = view.kind === 'folder' && folderId !== view.id;
      const prevItems = items;
      const prevTotal = total;
      if (leavesView) {
        setItems((cur) => cur.filter((i) => i.id !== item.id));
        setTotal((t) => Math.max(0, t - 1));
      } else {
        setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, folder_id: folderId } : i)));
      }
      const ok = await videoLibraryAction(item.id, 'move', folderId);
      if (!ok) {
        setItems(prevItems);
        setTotal(prevTotal);
        setActionError('Could not move the video. Please try again.');
      } else {
        void reloadFolders();
      }
    },
    [items, total, view, reloadFolders],
  );

  const handleArchiveToggle = useCallback(
    (item: VideoItem) =>
      optimisticRemove(item, () =>
        videoLibraryAction(item.id, archivedView ? 'restore' : 'archive'),
      ),
    [optimisticRemove, archivedView],
  );

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const target = pendingDelete;
    const ok = await videoLibraryAction(target.id, 'delete');
    setDeleting(false);
    setPendingDelete(null);
    if (!ok) {
      setActionError('Could not delete the video. Please try again.');
      return;
    }
    setItems((cur) => cur.filter((i) => i.id !== target.id));
    setTotal((t) => Math.max(0, t - 1));
    void reloadFolders();
  }

  // ─── Folder CRUD (reload after each; counts stay accurate) ───────────────────

  async function handleCreateFolder(name: string) {
    await createFolder(name);
    await reloadFolders();
  }
  async function handleRenameFolder(id: string, name: string) {
    setFolders((cur) => cur.map((f) => (f.id === id ? { ...f, name } : f)));
    await renameFolder(id, name);
    await reloadFolders();
  }
  async function handleReorderFolder(id: string, dir: -1 | 1) {
    const idx = folders.findIndex((f) => f.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= folders.length) return;
    const target = folders[swapIdx];
    // Optimistic swap, then persist both positions.
    setFolders((cur) => {
      const next = [...cur];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
    await Promise.all([
      reorderFolder(id, target.position),
      reorderFolder(target.id, folders[idx].position),
    ]);
    await reloadFolders();
  }
  async function handleDeleteFolder(id: string) {
    setFolders((cur) => cur.filter((f) => f.id !== id));
    await deleteFolder(id);
    await reloadFolders();
  }

  const handleUploadCreated = useCallback((creative: Creative) => {
    setUploadOpen(false);
    setHostedUpload(creative);
    if (creative.kind !== 'video') {
      setActionError('That upload finished, but only videos appear in this library.');
      return;
    }
    setActionError(null);
    setView({ kind: 'all' });
    setClientId('');
    setFromDate('');
    setToDate('');
    setSearchInput('');
    setDebouncedSearch('');
    setPage(1);
    setItems((cur) => [
      videoItemFromCreative(creative),
      ...cur.filter((item) => item.id !== creative.id),
    ]);
    setTotal((cur) => cur + (items.some((item) => item.id === creative.id) ? 0 : 1));
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(clientId || debouncedSearch || fromDate || toDate);

  return (
    <StudioShell>
      {/* ─── Page heading ─── */}
      <div className="studio-page-heading">
        <div>
          <span className="studio-page-eyebrow">Studio · videos</span>
          <h1 className="studio-page-h1">Videos</h1>
          {!loading && !error && (
            <p className="studio-page-sub" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {total} {total === 1 ? 'film' : 'films'} delivered.
            </p>
          )}
        </div>
        <div className="studio-page-actions">
          <button type="button" className="studio-cta-primary" onClick={() => setUploadOpen(true)}>
            <Upload size={14} strokeWidth={2} />
            Upload video
          </button>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={13}
              strokeWidth={1.8}
              style={{ position: 'absolute', left: 11, color: 'var(--le-muted)', pointerEvents: 'none' }}
            />
            <input
              className="studio-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search address…"
              aria-label="Search videos by address"
              style={{ paddingLeft: 30, width: 200, height: 38 }}
            />
          </div>
        </div>
      </div>

      {/* ─── StudioNav ─── */}
      <StudioNav />

      {hostedUpload && hostedUpload.kind === 'video' && (
        <section className="le-video-upload-handoff" aria-label="Uploaded video handoff">
          <div>
            <span className="studio-page-eyebrow">Upload ready</span>
            <h3>{hostedUpload.title}</h3>
            <p>Publish the owned link, copy the embed target, or tune privacy and downloads in Share.</p>
          </div>
          <div className="le-video-upload-actions">
            <a href={hostedUpload.shareUrl} className="studio-btn-ghost" target="_blank" rel="noreferrer">
              Presentation link
            </a>
            <a href={hostedUpload.embedUrl} className="studio-btn-ghost" target="_blank" rel="noreferrer">
              Embed link
            </a>
            <Link to={manageUrlForCreative(hostedUpload.id)} className="studio-cta-primary">
              Manage in Share
            </Link>
          </div>
        </section>
      )}

      {/* ─── Folder rail ─── */}
      <FolderRail
        folders={folders}
        foldersAvailable={foldersAvailable}
        view={view}
        onSelect={setView}
        onCreate={handleCreateFolder}
        onRename={handleRenameFolder}
        onReorder={handleReorderFolder}
        onDeleteFolder={handleDeleteFolder}
      />

      {actionError && (
        <div className="studio-error-strip" style={{ marginBottom: 16 }} role="alert">
          {actionError}
        </div>
      )}

      {/* ─── Filter bar ─── */}
      <div className="le-video-filters">
        <label className="le-video-filter">
          <span className="le-video-filter-label">Client</span>
          <span className="le-video-select-wrap">
            <select
              className="studio-input le-video-select"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              aria-label="Filter by client"
            >
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <ChevronDown size={14} strokeWidth={1.8} className="le-video-select-chevron" aria-hidden="true" />
          </span>
        </label>

        <label className="le-video-filter">
          <span className="le-video-filter-label">From</span>
          <input
            type="date"
            className="studio-input le-video-date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
          />
        </label>

        <label className="le-video-filter">
          <span className="le-video-filter-label">To</span>
          <input
            type="date"
            className="studio-input le-video-date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
          />
        </label>

        {hasFilters && (
          <button
            type="button"
            className="studio-btn-ghost studio-btn-sm"
            onClick={() => { setClientId(''); setFromDate(''); setToDate(''); setSearchInput(''); }}
            style={{ marginLeft: 'auto' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ─── Grid / states ─── */}
      {loading ? (
        <VideosSkeleton />
      ) : error ? (
        <div style={{ padding: '24px 0' }}>
          <div className="studio-error-strip">{error}</div>
        </div>
      ) : items.length === 0 ? (
        <div className="le-video-empty">
          <span className="le-video-empty-icon" aria-hidden="true">
            {view.kind === 'archived'
              ? <Archive size={26} strokeWidth={1.4} />
              : <Film size={28} strokeWidth={1.4} />}
          </span>
          <p className="le-video-empty-title">
            {hasFilters
              ? 'No videos match these filters.'
              : view.kind === 'archived'
                ? 'Nothing archived.'
                : view.kind === 'folder'
                  ? 'This folder is empty.'
                  : 'No videos delivered yet.'}
          </p>
          <p className="le-video-empty-sub">
            {hasFilters
              ? 'Try widening the date range or clearing the client filter.'
              : view.kind === 'archived'
                ? 'Videos you archive will rest here, ready to restore.'
                : view.kind === 'folder'
                  ? 'Use a card’s ⋯ menu → Move to folder to file videos here.'
                  : 'Delivered films will appear here as a managed library.'}
          </p>
        </div>
      ) : (
        <>
          <div className="le-video-grid">
            {items.map((item) => (
              <VideoCard
                key={item.id}
                item={item}
                archivedView={archivedView}
                folders={folders}
                foldersAvailable={foldersAvailable}
                onMove={(folderId) => handleMove(item, folderId)}
                onArchiveToggle={() => handleArchiveToggle(item)}
                onDelete={() => setPendingDelete(item)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="le-video-pagination">
              <button
                type="button"
                className="studio-btn-ghost studio-btn-sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft size={13} strokeWidth={1.8} />
                Previous
              </button>
              <span className="le-video-page-indicator" style={{ fontVariantNumeric: 'tabular-nums' }}>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="studio-btn-ghost studio-btn-sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
              >
                Next
                <ChevronRight size={13} strokeWidth={1.8} />
              </button>
            </div>
          )}
        </>
      )}

      {/* ─── Delete confirmation ─── */}
      {pendingDelete && (
        <DeleteDialog
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
      {uploadOpen && (
        <UploadDropzone
          acceptKind="video"
          onCreated={handleUploadCreated}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </StudioShell>
  );
};

export default Videos;
