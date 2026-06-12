import { X } from 'lucide-react';
import SharePanel, { type PreviewLinkRow as PanelLinkRow } from '@/components/studio/share/SharePanel';

// ─── Types ─────────────────────────────────────────────────────────────────
// Re-exported for PropertyCommandCenter, which still talks newest-per-kind.

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

// Adapt the dialog's newest-per-kind row into the SharePanel row shape. The
// dialog predates labels/revoke/expiry, so those fields default to null and are
// hidden by `mode="single"` anyway.
function toPanelRows(link: PreviewLinkRow | null): PanelLinkRow[] {
  if (!link) return [];
  return [{ ...link, label: null, revoked_at: null, expires_at: null }];
}

const noopManage = async () => {};

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

        {/* Shared SharePanel in newest-per-kind (single) mode. */}
        <SharePanel
          baseUrl={baseUrl}
          mode="single"
          clientLinks={toPanelRows(links.client)}
          publicLinks={toPanelRows(links.public)}
          onCreateLink={(kind) => onCreateLink(kind)}
          onToggle={onToggle}
          onSetLabel={noopManage}
          onRevoke={noopManage}
        />
      </div>
    </div>
  );
}
