import { useState } from 'react';
import { Copy, Check, Plus, X, Loader2 } from 'lucide-react';
import { getRelativeTime } from '@/lib/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export type PreviewLinkRow = {
  id: string;
  token: string;
  kind: 'client' | 'public';
  allow_download: boolean;
  allow_approve: boolean;
  allow_revision: boolean;
  approved_at: string | null;
  viewed_count: number;
  last_viewed_at: string | null;
  created_at: string;
};

export type ShareLinks = {
  client: PreviewLinkRow | null;
  public: PreviewLinkRow | null;
};

export type CapabilityField = 'allow_download' | 'allow_approve' | 'allow_revision';

interface ShareDialogProps {
  propertyId: string;
  baseUrl: string;
  links: ShareLinks;
  onCreateLink: (kind: 'client' | 'public') => Promise<void>;
  onToggle: (id: string, field: CapabilityField, value: boolean) => Promise<void>;
  onClose: () => void;
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

// ─── Section ─────────────────────────────────────────────────────────────────

function LinkSection({
  kind,
  label,
  description,
  link,
  baseUrl,
  sectionTestId,
  createTestId,
  copyTestId,
  viewCountTestId,
  lastViewedTestId,
  approvedBadgeTestId,
  togglePrefix,
  onCreateLink,
  onToggle,
}: {
  kind: 'client' | 'public';
  label: string;
  description: string;
  link: PreviewLinkRow | null;
  baseUrl: string;
  sectionTestId: string;
  createTestId: string;
  copyTestId: string;
  viewCountTestId: string;
  lastViewedTestId: string;
  approvedBadgeTestId: string | null;
  togglePrefix: string;
  onCreateLink: (kind: 'client' | 'public') => Promise<void>;
  onToggle: (id: string, field: CapabilityField, value: boolean) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await onCreateLink(kind);
    } finally {
      setCreating(false);
    }
  };

  const url = link ? `${baseUrl}/preview/${link.token}` : null;

  return (
    <div
      data-testid={sectionTestId}
      className="studio-card-flat"
      style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {/* Section heading */}
      <div>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: 'var(--le-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {label}
        </span>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--le-muted-2)' }}>
          {description}
        </p>
      </div>

      {link === null ? (
        /* Create CTA */
        <button
          type="button"
          className="studio-btn-ghost studio-btn-sm"
          onClick={() => void handleCreate()}
          disabled={creating}
          data-testid={createTestId}
        >
          {creating ? (
            <Loader2 size={11} className="studio-spinner" />
          ) : (
            <Plus size={11} strokeWidth={2} />
          )}
          {creating ? 'Creating…' : 'Create link'}
        </button>
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
            <CopyLinkButton url={url!} testId={copyTestId} />
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span
              data-testid={viewCountTestId}
              style={{ fontSize: 12, color: 'var(--le-muted-2)', fontVariantNumeric: 'tabular-nums' }}
            >
              {link.viewed_count} {link.viewed_count === 1 ? 'view' : 'views'}
            </span>
            {link.last_viewed_at && (
              <span
                data-testid={lastViewedTestId}
                style={{ fontSize: 12, color: 'var(--le-muted-2)' }}
              >
                Last viewed {getRelativeTime(link.last_viewed_at)}
              </span>
            )}
            {/* Approved badge — only for client links */}
            {approvedBadgeTestId && link.approved_at && (
              <span
                data-testid={approvedBadgeTestId}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 999,
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

// ─── ShareDialog ──────────────────────────────────────────────────────────────

export default function ShareDialog({
  baseUrl,
  links,
  onCreateLink,
  onToggle,
  onClose,
}: ShareDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share preview links"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(11, 11, 16, 0.45)',
      }}
      // Click on the backdrop closes the dialog
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="studio-card"
        style={{
          width: '100%',
          maxWidth: 520,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          position: 'relative',
        }}
        // Prevent backdrop click from bubbling through the card
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--le-ink)' }}>
            Share
          </h2>
          <button
            type="button"
            className="studio-btn-ghost studio-btn-sm"
            onClick={onClose}
            data-testid="share-dialog-close"
            aria-label="Close share dialog"
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>

        {/* Client review link section */}
        <LinkSection
          kind="client"
          label="Client review link"
          description="Full-featured link for the agent to review, approve, or request changes."
          link={links.client}
          baseUrl={baseUrl}
          sectionTestId="share-section-client"
          createTestId="create-client-link"
          copyTestId="copy-client-link"
          viewCountTestId="client-view-count"
          lastViewedTestId="client-last-viewed"
          approvedBadgeTestId="client-approved-badge"
          togglePrefix="toggle-client-"
          onCreateLink={onCreateLink}
          onToggle={onToggle}
        />

        {/* Public sharing link section */}
        <LinkSection
          kind="public"
          label="Public sharing link"
          description="View-only link, safe to post anywhere. All action capabilities are off."
          link={links.public}
          baseUrl={baseUrl}
          sectionTestId="share-section-public"
          createTestId="create-public-link"
          copyTestId="copy-public-link"
          viewCountTestId="public-view-count"
          lastViewedTestId="public-last-viewed"
          approvedBadgeTestId={null}
          togglePrefix="toggle-public-"
          onCreateLink={onCreateLink}
          onToggle={onToggle}
        />
      </div>
    </div>
  );
}
