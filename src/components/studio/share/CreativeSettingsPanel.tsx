import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, Trash2, X } from 'lucide-react';
import type { Creative, CreativePatch } from '@/lib/share-api';
import { QrCode } from './QrCode';

type EmbedPreset = 'responsive' | '640x360' | '1280x720';

/**
 * Resolve a share/embed URL to an absolute one. The backend already returns an
 * absolute URL (e.g. https://listingelevate.com/v/<token>); only prepend the
 * current origin when the value is a bare relative path. (Previously this always
 * prepended origin, producing a doubled `https://host…https://host…/v/…` link.)
 */
function toAbsolute(url: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** YYYY-MM-DD for a date input, from an ISO string (or '' for none). */
function isoToDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="studio-btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
    >
      {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={2} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="share-toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  );
}

/**
 * CreativeSettingsPanel — Vimeo-style slide-over drawer for a selected creative.
 * Shows a live player and sections: General, Privacy, Embed, Sharing, Download.
 * Every change calls `onPatch(id, partial)`. Save persists General edits;
 * toggles/segments patch immediately. Delete confirms then calls `onDelete`.
 */
export function CreativeSettingsPanel({
  creative,
  onPatch,
  onDelete,
  onClose,
}: {
  creative: Creative;
  onPatch: (id: string, patch: CreativePatch) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onClose: () => void;
}) {
  // ─── General (local, saved on demand) ───
  const [title, setTitle] = useState(creative.title);
  const [description, setDescription] = useState(creative.description ?? '');
  const [savingGeneral, setSavingGeneral] = useState(false);

  // ─── Privacy ───
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');

  // ─── Embed ───
  const [embedPreset, setEmbedPreset] = useState<EmbedPreset>('responsive');

  // ─── Delete ───
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Re-sync local General fields when the selected creative changes.
  useEffect(() => {
    setTitle(creative.title);
    setDescription(creative.description ?? '');
    setPasswordEnabled(false);
    setPassword('');
    setConfirmingDelete(false);
  }, [creative.id, creative.title, creative.description]);

  const shareLink = toAbsolute(creative.shareUrl);
  const embedSrc = toAbsolute(creative.embedUrl);

  const embedSnippet = useMemo(() => {
    if (embedPreset === 'responsive') {
      return (
        `<div style="position:relative;padding-top:56.25%">` +
        `<iframe src="${embedSrc}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" ` +
        `frameborder="0" allowfullscreen></iframe></div>`
      );
    }
    const [w, h] = embedPreset.split('x');
    return `<iframe src="${embedSrc}" width="${w}" height="${h}" frameborder="0" allowfullscreen></iframe>`;
  }, [embedPreset, embedSrc]);

  async function saveGeneral() {
    setSavingGeneral(true);
    try {
      await onPatch(creative.id, { title, description: description || null });
    } finally {
      setSavingGeneral(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(creative.id);
    } finally {
      setDeleting(false);
    }
  }

  const poster = creative.thumbnail_url ?? undefined;

  return (
    <div className="share-drawer-overlay" onClick={onClose} role="presentation">
      <aside
        className="share-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Settings for ${creative.title}`}
      >
        <div className="share-drawer-head">
          <h2>{creative.title}</h2>
          <button type="button" className="share-drawer-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Live player */}
        <div className="share-drawer-player">
          {creative.bunnyEmbedUrl ? (
            <iframe
              src={creative.bunnyEmbedUrl}
              title={creative.title}
              loading="lazy"
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          ) : creative.kind === 'image' ? (
            <img src={creative.previewUrl ?? creative.public_url ?? poster} alt={creative.title} />
          ) : (
            <video
              src={creative.previewUrl ?? creative.public_url ?? undefined}
              poster={poster}
              controls
              preload="metadata"
            />
          )}
        </div>

        <div className="share-drawer-body">
          {/* ─── General ─── */}
          <section className="share-section">
            <div className="share-section-title">General</div>
            <div className="share-field">
              <label className="share-field-label" htmlFor="share-title">
                Title
              </label>
              <input
                id="share-title"
                className="studio-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="share-field">
              <label className="share-field-label" htmlFor="share-desc">
                Description
              </label>
              <textarea
                id="share-desc"
                className="studio-textarea"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div>
              <button
                type="button"
                className="studio-btn-dark"
                onClick={saveGeneral}
                disabled={savingGeneral}
              >
                {savingGeneral ? <Loader2 size={12} className="studio-spinner" /> : null}
                Save changes
              </button>
            </div>
          </section>

          {/* ─── Privacy ─── */}
          <section className="share-section">
            <div className="share-section-title">Privacy</div>
            <div className="share-field">
              <span className="share-field-label">Visibility</span>
              <div className="studio-segmented" role="group" aria-label="Visibility">
                {(['unlisted', 'public'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={'studio-segmented-item' + (creative.visibility === v ? ' active' : '')}
                    onClick={() => onPatch(creative.id, { visibility: v })}
                  >
                    {v === 'unlisted' ? 'Unlisted' : 'Public'}
                  </button>
                ))}
              </div>
            </div>

            <div className="share-toggle-row">
              <div>
                <div className="label">Password</div>
                <div className="hint">Require a password to view.</div>
              </div>
              <Toggle
                label="Password protection"
                checked={passwordEnabled}
                onChange={(v) => {
                  setPasswordEnabled(v);
                  if (!v) {
                    setPassword('');
                    // Clearing the password sends an empty string → clears the hash.
                    onPatch(creative.id, { password: '' });
                  }
                }}
              />
            </div>
            {passwordEnabled && (
              <div className="share-link-row">
                <input
                  className="studio-input share-link-input"
                  type="text"
                  placeholder="Set a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="studio-btn-ghost"
                  onClick={() => onPatch(creative.id, { password })}
                  disabled={!password}
                >
                  Set
                </button>
              </div>
            )}

            <div className="share-field">
              <label className="share-field-label" htmlFor="share-expiry">
                Expiry date
              </label>
              <input
                id="share-expiry"
                className="studio-input"
                type="date"
                value={isoToDateInput(creative.expires_at)}
                onChange={(e) =>
                  onPatch(creative.id, {
                    expires_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
              />
            </div>
          </section>

          {/* ─── Embed ─── */}
          <section className="share-section">
            <div className="share-section-title">Embed</div>
            <div className="share-toggle-row">
              <div>
                <div className="label">Allow embedding</div>
                <div className="hint">Let this play inside an iframe on other sites.</div>
              </div>
              <Toggle
                label="Allow embedding"
                checked={creative.allow_embed}
                onChange={(v) => onPatch(creative.id, { allow_embed: v })}
              />
            </div>
            <div className="share-embed-presets">
              {(['responsive', '640x360', '1280x720'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={'studio-btn-ghost' + (embedPreset === p ? ' active' : '')}
                  disabled={!creative.allow_embed}
                  onClick={() => setEmbedPreset(p)}
                >
                  {p === 'responsive' ? 'Responsive' : p.replace('x', '×')}
                </button>
              ))}
            </div>
            <textarea
              className="share-code"
              readOnly
              value={creative.allow_embed ? embedSnippet : 'Embedding is turned off for this creative.'}
              disabled={!creative.allow_embed}
              aria-label="Embed code"
            />
            <div>
              <CopyButton text={embedSnippet} label="Copy embed code" />
            </div>
          </section>

          {/* ─── Sharing ─── */}
          <section className="share-section">
            <div className="share-section-title">Sharing</div>
            <div className="share-link-row">
              <input
                className="studio-input share-link-input"
                type="text"
                readOnly
                value={shareLink}
                aria-label="Presentation link"
                onClick={(e) => e.currentTarget.select()}
                onFocus={(e) => e.currentTarget.select()}
              />
              <CopyButton text={shareLink} label="Copy link" />
              <a
                className="studio-btn-ghost"
                href={shareLink}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open presentation in a new tab"
                title="Open in new tab"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <ExternalLink size={13} strokeWidth={2} />
                Open
              </a>
            </div>
            {creative.visibility === 'unlisted' && (
              <p className="share-qr-note" style={{ marginTop: 4 }}>
                Anyone with this link can view — it just won&apos;t be listed publicly.
              </p>
            )}
            <div className="share-qr">
              <QrCode value={shareLink} size={92} />
              <span className="share-qr-note">Scan to open the presentation link.</span>
            </div>
          </section>

          {/* ─── Download ─── */}
          <section className="share-section">
            <div className="share-section-title">Download</div>
            <div className="share-toggle-row">
              <div>
                <div className="label">Allow download</div>
                <div className="hint">Show a download button on the presentation page.</div>
              </div>
              <Toggle
                label="Allow download"
                checked={creative.allow_download}
                onChange={(v) => onPatch(creative.id, { allow_download: v })}
              />
            </div>
          </section>

          {/* ─── Actions ─── */}
          <div className="share-drawer-actions">
            {confirmingDelete ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="share-btn-danger"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 size={12} className="studio-spinner" /> : <Trash2 size={12} />}
                  Confirm delete
                </button>
                <button
                  type="button"
                  className="studio-btn-ghost"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="share-btn-danger"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 size={12} />
                Delete
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
