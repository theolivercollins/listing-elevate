import { useState } from 'react';
import { Copy, Check, Plus, Loader2, Pencil, Ban, RotateCcw, Clock } from 'lucide-react';
import { getRelativeTime } from '@/lib/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export type PreviewLinkRow = {
  id: string;
  token: string;
  kind: 'client' | 'public';
  label: string | null;
  allow_download: boolean;
  allow_approve: boolean;
  allow_revision: boolean;
  /** Per-link branding flag (migration 087). Optional until T4 wires the
   *  customer card + all consumers always supply it; defaults TRUE elsewhere. */
  show_branding?: boolean;
  approved_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  viewed_count: number;
  last_viewed_at: string | null;
  created_at: string;
};

export type CapabilityField = 'allow_download' | 'allow_approve' | 'allow_revision';

/**
 * Fields an onToggle handler accepts. Capability flags plus the per-link
 * branding flag (show_branding) — both flow through the same PATCH path.
 * The panel only emits the three CapabilityField values until T4 wires
 * show_branding into the restructured customer card.
 */
export type ToggleField = CapabilityField | 'show_branding';

/**
 * `list` (default, video hub): every link for a kind, always-on label composer.
 * `single` (PropertyCommandCenter dialog): newest link per kind only — the
 * composer collapses to a single "Create link" CTA shown only when the kind is
 * empty, preserving the v2 ShareDialog UX and test ids.
 */
export type SharePanelMode = 'list' | 'single';

interface SharePanelProps {
  baseUrl: string;
  clientLinks: PreviewLinkRow[];
  publicLinks: PreviewLinkRow[];
  mode?: SharePanelMode;
  onCreateLink: (kind: 'client' | 'public', label?: string) => Promise<void>;
  onToggle: (id: string, field: ToggleField, value: boolean) => Promise<void>;
  onSetLabel: (id: string, label: string) => Promise<void>;
  onRevoke: (id: string, revoked: boolean) => Promise<void>;
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyLinkButton({ url, testId }: { url: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — silently ignore
    }
  };
  return (
    <button
      type="button"
      className="studio-btn-ghost studio-btn-sm"
      onClick={() => void handleCopy()}
      data-testid={testId}
    >
      {copied ? (
        <Check size={11} strokeWidth={2} style={{ color: 'var(--le-good)' }} />
      ) : (
        <Copy size={11} strokeWidth={1.6} />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ─── Capability toggle ────────────────────────────────────────────────────────

function CapabilityToggle({
  id,
  field,
  label,
  checked,
  testId,
  onToggle,
}: {
  id: string;
  field: CapabilityField;
  label: string;
  checked: boolean;
  testId: string;
  onToggle: (id: string, field: CapabilityField, value: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  const handleChange = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onToggle(id, field, !checked);
    } finally {
      setPending(false);
    }
  };

  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        cursor: pending ? 'wait' : 'pointer',
        fontSize: 12.5,
        color: 'var(--le-ink-2)',
      }}
    >
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={() => void handleChange()}
        disabled={pending}
        style={{ cursor: 'inherit', accentColor: 'var(--le-accent)' }}
      />
      {label}
      {pending && <Loader2 size={11} className="studio-spinner" />}
    </label>
  );
}

// ─── Inline editable label ──────────────────────────────────────────────────

function LinkLabel({
  id,
  label,
  onSetLabel,
}: {
  id: string;
  label: string | null;
  onSetLabel: (id: string, label: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label ?? '');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(label ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSetLabel(id, draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
        <input
          type="text"
          data-testid={`label-input-${id}`}
          value={draft}
          autoFocus
          placeholder="Label (e.g. Sent to Brian)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="studio-input"
          style={{ flex: 1, minWidth: 0, fontSize: 12.5, padding: '6px 10px' }}
        />
        <button
          type="button"
          className="studio-btn-ghost studio-btn-sm"
          data-testid={`save-label-${id}`}
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? <Loader2 size={11} className="studio-spinner" /> : <Check size={11} strokeWidth={2} />}
          Save
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={`edit-label-${id}`}
      onClick={startEdit}
      className="studio-btn-ghost studio-btn-sm"
      style={{
        flex: 1,
        minWidth: 0,
        justifyContent: 'flex-start',
        color: label ? 'var(--le-ink)' : 'var(--le-muted-2)',
        fontWeight: label ? 600 : 400,
      }}
      title="Edit label"
    >
      <Pencil size={11} strokeWidth={1.6} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label || 'Add label'}
      </span>
    </button>
  );
}

// ─── A single link row ──────────────────────────────────────────────────────

function LinkRow({
  link,
  baseUrl,
  testIds,
  togglePrefix,
  showApprovedBadge,
  manageable,
  onToggle,
  onSetLabel,
  onRevoke,
}: {
  link: PreviewLinkRow;
  baseUrl: string;
  testIds: {
    copy: string;
    viewCount: string;
    lastViewed: string;
    approvedBadge: string;
  };
  togglePrefix: string;
  showApprovedBadge: boolean;
  manageable: boolean;
  onToggle: (id: string, field: ToggleField, value: boolean) => Promise<void>;
  onSetLabel: (id: string, label: string) => Promise<void>;
  onRevoke: (id: string, revoked: boolean) => Promise<void>;
}) {
  const [revoking, setRevoking] = useState(false);
  const url = `${baseUrl}/preview/${link.token}`;
  const revoked = link.revoked_at !== null;

  const handleRevoke = async (next: boolean) => {
    if (revoking) return;
    setRevoking(true);
    try {
      await onRevoke(link.id, next);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div
      data-testid={`share-link-${link.id}`}
      className="studio-card-flat"
      style={{
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        opacity: revoked ? 0.72 : 1,
      }}
    >
      {/* Label + revoke/restore control */}
      {manageable && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <LinkLabel id={link.id} label={link.label} onSetLabel={onSetLabel} />
        {revoked ? (
          <button
            type="button"
            className="studio-btn-ghost studio-btn-sm"
            data-testid={`restore-${link.id}`}
            onClick={() => void handleRevoke(false)}
            disabled={revoking}
          >
            {revoking ? <Loader2 size={11} className="studio-spinner" /> : <RotateCcw size={11} strokeWidth={1.6} />}
            Restore
          </button>
        ) : (
          <button
            type="button"
            className="studio-btn-ghost studio-btn-sm"
            data-testid={`revoke-${link.id}`}
            onClick={() => void handleRevoke(true)}
            disabled={revoking}
            style={{ color: 'var(--le-bad)' }}
          >
            {revoking ? <Loader2 size={11} className="studio-spinner" /> : <Ban size={11} strokeWidth={1.6} />}
            Revoke
          </button>
        )}
      </div>
      )}

      {revoked ? (
        /* Revoked/expired state */
        <div
          data-testid={`revoked-state-${link.id}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--le-muted-2)' }}
        >
          <Ban size={12} strokeWidth={1.6} />
          Revoked/expired — viewers see the link as no longer available.
        </div>
      ) : (
        <>
          {/* URL row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 12,
                color: 'var(--le-accent)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
              }}
            >
              {url}
            </span>
            <CopyLinkButton url={url} testId={testIds.copy} />
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span
              data-testid={testIds.viewCount}
              style={{ fontSize: 12, color: 'var(--le-muted-2)', fontVariantNumeric: 'tabular-nums' }}
            >
              {link.viewed_count} {link.viewed_count === 1 ? 'view' : 'views'}
            </span>
            {link.last_viewed_at && (
              <span data-testid={testIds.lastViewed} style={{ fontSize: 12, color: 'var(--le-muted-2)' }}>
                Last viewed {getRelativeTime(link.last_viewed_at)}
              </span>
            )}
            {link.expires_at && (
              <span
                data-testid={`expiry-${link.id}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--le-muted-2)' }}
              >
                <Clock size={11} strokeWidth={1.6} />
                Expires {getRelativeTime(link.expires_at)}
              </span>
            )}
            {showApprovedBadge && link.approved_at && (
              <span
                data-testid={testIds.approvedBadge}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 'var(--le-r-pill)',
                  background: 'rgba(47, 138, 85, 0.12)',
                  color: 'var(--le-good)',
                }}
              >
                Approved
              </span>
            )}
          </div>

          {/* Capability toggles */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <CapabilityToggle
              id={link.id}
              field="allow_download"
              label="Download"
              checked={link.allow_download}
              testId={`${togglePrefix}allow_download`}
              onToggle={onToggle}
            />
            <CapabilityToggle
              id={link.id}
              field="allow_approve"
              label="Approve"
              checked={link.allow_approve}
              testId={`${togglePrefix}allow_approve`}
              onToggle={onToggle}
            />
            <CapabilityToggle
              id={link.id}
              field="allow_revision"
              label="Request change"
              checked={link.allow_revision}
              testId={`${togglePrefix}allow_revision`}
              onToggle={onToggle}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ─── A kind section (Client / Public) ───────────────────────────────────────

function LinkSection({
  kind,
  heading,
  description,
  links,
  baseUrl,
  showApprovedBadge,
  mode,
  onCreateLink,
  onToggle,
  onSetLabel,
  onRevoke,
}: {
  kind: 'client' | 'public';
  heading: string;
  description: string;
  links: PreviewLinkRow[];
  baseUrl: string;
  showApprovedBadge: boolean;
  mode: SharePanelMode;
  onCreateLink: (kind: 'client' | 'public', label?: string) => Promise<void>;
  onToggle: (id: string, field: ToggleField, value: boolean) => Promise<void>;
  onSetLabel: (id: string, label: string) => Promise<void>;
  onRevoke: (id: string, revoked: boolean) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const trimmed = newLabel.trim();
      await onCreateLink(kind, trimmed.length > 0 ? trimmed : undefined);
      setNewLabel('');
    } finally {
      setCreating(false);
    }
  };

  const isSingle = mode === 'single';

  return (
    <div
      data-testid={`share-section-${kind}`}
      // In single (dialog) mode the section is itself a flat card, matching v2.
      className={isSingle ? 'studio-card-flat' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        ...(isSingle ? { padding: '16px 18px' } : {}),
      }}
    >
      {/* Section heading */}
      <div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--le-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
          }}
        >
          {heading}
        </span>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--le-muted-2)' }}>{description}</p>
      </div>

      {/* Empty hint — list mode only (dialog shows a Create CTA instead). */}
      {links.length === 0 && !isSingle && (
        <p
          data-testid={`share-empty-${kind}`}
          style={{ margin: 0, fontSize: 12.5, color: 'var(--le-muted-2)', fontStyle: 'italic' }}
        >
          No links yet — create one below.
        </p>
      )}

      {/* Link rows */}
      {links.map((link, i) => (
        <LinkRow
          key={link.id}
          link={link}
          baseUrl={baseUrl}
          showApprovedBadge={showApprovedBadge}
          manageable={!isSingle}
          // The first link of each kind keeps the canonical testids for
          // back-compat with the v2 ShareDialog tests; the rest are id-suffixed.
          testIds={
            i === 0
              ? {
                  copy: `copy-${kind}-link`,
                  viewCount: `${kind}-view-count`,
                  lastViewed: `${kind}-last-viewed`,
                  approvedBadge: `${kind}-approved-badge`,
                }
              : {
                  copy: `copy-${kind}-link-${link.id}`,
                  viewCount: `${kind}-view-count-${link.id}`,
                  lastViewed: `${kind}-last-viewed-${link.id}`,
                  approvedBadge: `${kind}-approved-badge-${link.id}`,
                }
          }
          togglePrefix={i === 0 ? `toggle-${kind}-` : `toggle-${kind}-${link.id}-`}
          onToggle={onToggle}
          onSetLabel={onSetLabel}
          onRevoke={onRevoke}
        />
      ))}

      {isSingle ? (
        // Dialog: single Create CTA, only when the kind has no link.
        links.length === 0 && (
          <button
            type="button"
            className="studio-btn-ghost studio-btn-sm"
            onClick={() => void handleCreate()}
            disabled={creating}
            data-testid={`create-${kind}-link`}
          >
            {creating ? <Loader2 size={11} className="studio-spinner" /> : <Plus size={11} strokeWidth={2} />}
            {creating ? 'Creating…' : 'Create link'}
          </button>
        )
      ) : (
        // Hub: always-on label composer.
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            data-testid={`new-link-label-${kind}`}
            value={newLabel}
            placeholder="New link label (optional)"
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
            className="studio-input"
            style={{ flex: 1, minWidth: 0, fontSize: 12.5, padding: '8px 10px' }}
          />
          <button
            type="button"
            className="studio-btn-ghost studio-btn-sm"
            onClick={() => void handleCreate()}
            disabled={creating}
            data-testid={`create-${kind}-link`}
          >
            {creating ? <Loader2 size={11} className="studio-spinner" /> : <Plus size={11} strokeWidth={2} />}
            {creating ? 'Creating…' : 'New link'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── SharePanel ──────────────────────────────────────────────────────────────

export default function SharePanel({
  baseUrl,
  clientLinks,
  publicLinks,
  mode = 'list',
  onCreateLink,
  onToggle,
  onSetLabel,
  onRevoke,
}: SharePanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <LinkSection
        kind="client"
        heading="Client review link"
        description="Full-featured link for the agent to review, approve, or request changes."
        links={clientLinks}
        baseUrl={baseUrl}
        showApprovedBadge
        mode={mode}
        onCreateLink={onCreateLink}
        onToggle={onToggle}
        onSetLabel={onSetLabel}
        onRevoke={onRevoke}
      />
      <LinkSection
        kind="public"
        heading="Public sharing link"
        description="View-only link, safe to post anywhere. All action capabilities are off."
        links={publicLinks}
        baseUrl={baseUrl}
        showApprovedBadge={false}
        mode={mode}
        onCreateLink={onCreateLink}
        onToggle={onToggle}
        onSetLabel={onSetLabel}
        onRevoke={onRevoke}
      />
    </div>
  );
}
