import {
  useState,
  useCallback,
  useRef,
  type ChangeEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Image, X, ArrowRight, Search } from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { StudioShell } from '@/components/studio/StudioShell';
import { ClientPicker } from '@/components/studio/ClientPicker';
import { AddressAutocomplete, type AddressDetails } from '@/components/studio/AddressAutocomplete';
import { uploadPhotosToStorage } from '@/lib/photo-upload';

const MIN_PHOTOS = 5;

type Pkg = 'just_listed' | 'just_pended' | 'just_closed' | 'life_cycle';
type Duration = 15 | 30 | 60;
type Orientation = 'horizontal' | 'vertical' | 'both';

interface UploadedFile {
  file: File;
  preview: string;
  id: string;
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--le-muted)',
        marginBottom: 6,
      }}
    >
      {children}
      {required && <span style={{ color: 'var(--le-bad)', marginLeft: 3 }}>*</span>}
    </label>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 10px',
        borderRadius: 8,
        border: active ? '1px solid rgba(11,11,16,0.18)' : '1px solid var(--le-line)',
        background: active ? 'var(--le-surface-2)' : 'var(--le-surface)',
        fontFamily: 'inherit',
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--le-ink)' : 'var(--le-muted)',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >
      {children}
    </button>
  );
}

const StudioNew = () => {
  const navigate = useNavigate();

  // ─── form state ───
  const [address, setAddress] = useState('');
  const [addressDetails, setAddressDetails] = useState<AddressDetails | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [squareFootage, setSquareFootage] = useState('');
  const [price, setPrice] = useState('');
  const [directorNotes, setDirectorNotes] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);

  // ─── add-on state (mirrors customer Upload.tsx) ───
  const [selectedPackage, setSelectedPackage] = useState<Pkg>('just_listed');
  const [selectedDuration, setSelectedDuration] = useState<Duration>(30);
  const [selectedOrientation, setSelectedOrientation] = useState<Orientation>('horizontal');
  const [addVoiceover, setAddVoiceover] = useState(false);
  const [addVoiceClone, setAddVoiceClone] = useState(false);
  const [customRequest, setCustomRequest] = useState('');
  const [daysOnMarket, setDaysOnMarket] = useState('');
  const [soldPrice, setSoldPrice] = useState('');

  // ─── MLS lookup state ───
  const [mlsLooking, setMlsLooking] = useState(false);
  const [mlsMsg, setMlsMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  // ─── submit state ───
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; total: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const isValid = address.trim() && files.length >= MIN_PHOTOS;
  const showLifecycleFields = selectedPackage === 'just_pended' || selectedPackage === 'just_closed' || selectedPackage === 'life_cycle';

  // ─── MLS lookup ───
  const lookupMls = async () => {
    if (!address.trim()) {
      setMlsMsg({ kind: 'warn', text: 'Enter or pick an address first.' });
      return;
    }
    setMlsLooking(true);
    setMlsMsg(null);
    try {
      const r = await fetch('/api/admin/studio/mls-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 501) {
        setMlsMsg({
          kind: 'warn',
          text: 'MLS lookup not configured (set RENTCAST_API_KEY). You can still enter details manually.',
        });
        return;
      }
      if (!r.ok) {
        setMlsMsg({
          kind: 'err',
          text: data.detail ?? data.error ?? `${r.status} ${r.statusText}`,
        });
        return;
      }
      if (typeof data.bedrooms === 'number') setBedrooms(String(data.bedrooms));
      if (typeof data.bathrooms === 'number') setBathrooms(String(data.bathrooms));
      if (typeof data.square_footage === 'number') setSquareFootage(String(data.square_footage));
      if (typeof data.price === 'number') setPrice(String(data.price));
      if (typeof data.matched_address === 'string' && data.matched_address) {
        setAddress(data.matched_address);
      }
      setMlsMsg({ kind: 'ok', text: `Matched via ${data.source}. Review and edit before submitting.` });
    } catch (err) {
      setMlsMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'MLS lookup failed',
      });
    } finally {
      setMlsLooking(false);
    }
  };

  // ─── file handling ───
  const handleFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const accepted = Array.from(newFiles).filter((f) =>
        /\.(jpg|jpeg|png|heic|webp)$/i.test(f.name),
      );
      const remaining = 60 - files.length;
      const toAdd = accepted.slice(0, remaining);
      const mapped = toAdd.map((f) => ({
        file: f,
        preview: URL.createObjectURL(f),
        id: crypto.randomUUID(),
      }));
      setFiles((prev) => [...prev, ...mapped]);
    },
    [files.length],
  );

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const removed = prev.find((f) => f.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  // ─── submit ───
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    setSubmitting(true);
    setSubmitError(null);
    setUploadProgress(null);

    try {
      const tempId = crypto.randomUUID();
      const photoPaths = await uploadPhotosToStorage(
        files.map((f) => f.file),
        `${tempId}/raw`,
        (uploaded, total) => setUploadProgress({ uploaded, total }),
      );

      if (photoPaths.length === 0) {
        throw new Error('All photo uploads failed. Check browser console for details.');
      }

      setUploadProgress(null);

      const res = await fetch('/api/admin/studio/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          address: address.trim(),
          bedrooms: bedrooms ? Number(bedrooms) : null,
          bathrooms: bathrooms ? Number(bathrooms) : null,
          square_footage: squareFootage ? Number(squareFootage) : null,
          price: price ? Number(price) : null,
          photo_storage_paths: photoPaths,
          director_notes: directorNotes.trim() || null,
          selected_package: selectedPackage,
          selected_duration: selectedDuration,
          selected_orientation: selectedOrientation,
          add_voiceover: addVoiceover,
          add_voice_clone: addVoiceClone,
          add_custom_request: customRequest.trim().length > 0,
          custom_request_text: customRequest.trim() || null,
          days_on_market: showLifecycleFields && daysOnMarket ? Number(daysOnMarket) : null,
          sold_price: showLifecycleFields && soldPrice ? Number(soldPrice) : null,
          mls_source: addressDetails?.place_id ? 'google_places' : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `${res.status} ${res.statusText}`);
      }

      const { property_id } = await res.json();
      fetch(`/api/pipeline/${property_id}`, { method: 'POST' }).catch(() => {});
      navigate(`/dashboard/studio/properties/${property_id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StudioShell>
      {/* ─── Page heading ─── */}
      <div className="studio-page-heading">
        <div>
          <span className="studio-page-eyebrow">Studio · new listing</span>
          <h1 className="studio-page-h1">New listing</h1>
          <p className="studio-page-sub">Optional client, drop in photos, configure the order, send the pipeline.</p>
        </div>
      </div>

      {/* ─── StudioNav ─── */}
      <StudioNav />

      {/* ─── Form ─── */}
      <form
        onSubmit={handleSubmit}
        style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 0 }}
      >
        <div className="studio-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Client picker (optional) */}
            <div>
              <FieldLabel>Client</FieldLabel>
              <ClientPicker value={clientId} onChange={setClientId} includeNone={true} />
              <p style={{ marginTop: 6, fontSize: 11.5, color: 'var(--le-muted)' }}>
                Leave blank for personal / no-client renders. Brand-kit injection is skipped when there's no client.
              </p>
            </div>

            {/* Address — Google Places Autocomplete + MLS lookup */}
            <div>
              <FieldLabel required>Address</FieldLabel>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <AddressAutocomplete
                    value={address}
                    onChange={setAddress}
                    onPick={(d) => {
                      setAddressDetails(d);
                      setMlsMsg(null);
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="studio-btn-ghost"
                  onClick={lookupMls}
                  disabled={mlsLooking || !address.trim()}
                  style={{ whiteSpace: 'nowrap', padding: '10px 14px' }}
                  title="Look up property details by address"
                >
                  {mlsLooking ? (
                    <Loader2 size={13} className="studio-spinner" />
                  ) : (
                    <Search size={13} strokeWidth={2} />
                  )}
                  <span style={{ marginLeft: 6 }}>Lookup MLS</span>
                </button>
              </div>
              {mlsMsg && (
                <p
                  style={{
                    marginTop: 6,
                    fontSize: 11.5,
                    color:
                      mlsMsg.kind === 'ok'
                        ? 'var(--le-good)'
                        : mlsMsg.kind === 'warn'
                          ? 'var(--le-warn)'
                          : 'var(--le-bad)',
                  }}
                >
                  {mlsMsg.text}
                </p>
              )}
            </div>

            {/* Bedrooms / bathrooms */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <FieldLabel>Bedrooms</FieldLabel>
                <input
                  className="studio-input studio-tabnum"
                  type="number"
                  min={0}
                  step={1}
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  placeholder="3"
                />
              </div>
              <div>
                <FieldLabel>Bathrooms</FieldLabel>
                <input
                  className="studio-input studio-tabnum"
                  type="number"
                  min={0}
                  step={0.5}
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                  placeholder="2.5"
                />
              </div>
            </div>

            {/* Square footage / price */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <FieldLabel>Square footage</FieldLabel>
                <input
                  className="studio-input studio-tabnum"
                  type="number"
                  min={0}
                  step={1}
                  value={squareFootage}
                  onChange={(e) => setSquareFootage(e.target.value)}
                  placeholder="1850"
                />
              </div>
              <div>
                <FieldLabel>Price ($)</FieldLabel>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 13.5,
                      color: 'var(--le-muted)',
                      pointerEvents: 'none',
                    }}
                  >
                    $
                  </span>
                  <input
                    className="studio-input studio-tabnum"
                    type="number"
                    min={0}
                    step={1}
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="2400000"
                    style={{ paddingLeft: 26 }}
                  />
                </div>
              </div>
            </div>

            {/* Package */}
            <div>
              <FieldLabel>Package</FieldLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {(['just_listed', 'just_pended', 'just_closed', 'life_cycle'] as const).map((p) => (
                  <SegButton key={p} active={selectedPackage === p} onClick={() => setSelectedPackage(p)}>
                    {p === 'just_listed' ? 'Just Listed' : p === 'just_pended' ? 'Just Pended' : p === 'just_closed' ? 'Just Closed' : 'Life Cycle'}
                  </SegButton>
                ))}
              </div>
            </div>

            {/* Lifecycle-only fields */}
            {showLifecycleFields && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <FieldLabel>Days on market</FieldLabel>
                  <input
                    className="studio-input studio-tabnum"
                    type="number"
                    min={0}
                    step={1}
                    value={daysOnMarket}
                    onChange={(e) => setDaysOnMarket(e.target.value)}
                    placeholder="14"
                  />
                </div>
                <div>
                  <FieldLabel>Sold price ($)</FieldLabel>
                  <div style={{ position: 'relative' }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: 12,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: 13.5,
                        color: 'var(--le-muted)',
                        pointerEvents: 'none',
                      }}
                    >
                      $
                    </span>
                    <input
                      className="studio-input studio-tabnum"
                      type="number"
                      min={0}
                      step={1}
                      value={soldPrice}
                      onChange={(e) => setSoldPrice(e.target.value)}
                      placeholder="2250000"
                      style={{ paddingLeft: 26 }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Duration + Orientation */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <FieldLabel>Duration</FieldLabel>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([15, 30, 60] as const).map((d) => (
                    <SegButton key={d} active={selectedDuration === d} onClick={() => setSelectedDuration(d)}>
                      {d}s
                    </SegButton>
                  ))}
                </div>
              </div>
              <div>
                <FieldLabel>Orientation</FieldLabel>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['horizontal', 'vertical', 'both'] as const).map((o) => (
                    <SegButton key={o} active={selectedOrientation === o} onClick={() => setSelectedOrientation(o)}>
                      {o === 'horizontal' ? '16:9' : o === 'vertical' ? '9:16' : 'Both'}
                    </SegButton>
                  ))}
                </div>
              </div>
            </div>

            {/* Voiceover add-ons */}
            <div>
              <FieldLabel>Voiceover</FieldLabel>
              <p style={{ margin: '0 0 8px 0', fontSize: 11.5, color: 'var(--le-muted)' }}>
                AI voiceover and voice clone are mutually exclusive — pick one or neither.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <SegButton
                  active={addVoiceover}
                  onClick={() => {
                    setAddVoiceover((v) => !v);
                    if (!addVoiceover) setAddVoiceClone(false);
                  }}
                >
                  AI voiceover
                </SegButton>
                <SegButton
                  active={addVoiceClone}
                  onClick={() => {
                    setAddVoiceClone((v) => !v);
                    if (!addVoiceClone) setAddVoiceover(false);
                  }}
                >
                  Voice clone
                </SegButton>
              </div>
            </div>

            {/* Custom request */}
            <div>
              <FieldLabel>Custom request</FieldLabel>
              <textarea
                className="studio-textarea"
                value={customRequest}
                onChange={(e) => setCustomRequest(e.target.value)}
                placeholder="Anything else the pipeline should know — required shots, brand language, music vibe…"
                rows={3}
              />
            </div>

            {/* Director notes */}
            <div>
              <FieldLabel>Director notes (internal)</FieldLabel>
              <textarea
                className="studio-textarea"
                value={directorNotes}
                onChange={(e) => setDirectorNotes(e.target.value)}
                placeholder="Operator-only notes that show up on the Property Command Center, not sent to the director model."
                rows={3}
              />
            </div>

            {/* Photo dropzone */}
            <div>
              <FieldLabel required>Photos</FieldLabel>
              <div
                className={'studio-dropzone' + (isDragging ? ' dragging' : '')}
                style={{
                  aspectRatio: '16/6',
                  flexDirection: 'column',
                  textAlign: 'center',
                  gap: 0,
                }}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  handleFiles(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.heic,.webp"
                  style={{ display: 'none' }}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    e.target.files && handleFiles(e.target.files)
                  }
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  {...({ webkitdirectory: '', directory: '' } as React.HTMLAttributes<HTMLInputElement>)}
                  style={{ display: 'none' }}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    e.target.files && handleFiles(e.target.files)
                  }
                />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <Image size={28} strokeWidth={1.4} style={{ color: 'var(--le-muted)' }} />
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--le-ink-2)', letterSpacing: '-0.01em' }}>
                    Drop photos to upload
                  </p>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--le-muted)' }}>
                    or click to browse — JPG, PNG, HEIC, WebP
                  </p>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}
                    className="studio-btn-ghost"
                    style={{ fontSize: 11.5, padding: '5px 12px', marginTop: 4 }}
                  >
                    Import entire folder
                  </button>
                </div>
              </div>

              {/* Photo count progress */}
              {files.length > 0 && files.length < MIN_PHOTOS && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      background: 'var(--le-line)',
                      borderRadius: 99,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${(files.length / MIN_PHOTOS) * 100}%`,
                        background: 'var(--le-accent)',
                        borderRadius: 99,
                        transition: 'width 0.3s cubic-bezier(.2,.8,.2,1)',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 11.5,
                      color: 'var(--le-warn)',
                      fontVariantNumeric: 'tabular-nums',
                      flexShrink: 0,
                    }}
                  >
                    {MIN_PHOTOS - files.length} more required
                  </span>
                </div>
              )}
              {files.length >= MIN_PHOTOS && (
                <p
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: 'var(--le-good)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {files.length} photo{files.length !== 1 ? 's' : ''} ready
                </p>
              )}

              {/* Thumbnails */}
              {files.length > 0 && (
                <div
                  style={{
                    marginTop: 16,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(6, 1fr)',
                    gap: 6,
                  }}
                >
                  {files.map((f) => (
                    <div
                      key={f.id}
                      style={{
                        position: 'relative',
                        aspectRatio: '1',
                        borderRadius: 10,
                        overflow: 'hidden',
                        background: 'rgba(11,11,16,0.06)',
                      }}
                    >
                      <img
                        src={f.preview}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(11,11,16,0.65)',
                          opacity: 0,
                          transition: 'opacity 0.15s',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#fff',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0'; }}
                        aria-label="Remove photo"
                      >
                        <X size={14} strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {submitError && (
            <div className="studio-error-strip" style={{ marginTop: 16 }}>{submitError}</div>
          )}

          {/* Submit footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              paddingTop: 20,
              marginTop: 20,
              borderTop: '1px solid var(--le-line-2)',
            }}
          >
            <button
              type="button"
              className="studio-btn-ghost"
              onClick={() => navigate('/dashboard/studio')}
            >
              Cancel
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {!isValid && !submitting && (
                <span style={{ fontSize: 12.5, color: 'var(--le-muted)' }}>
                  {!address.trim()
                    ? 'Address required'
                    : files.length < MIN_PHOTOS
                      ? `${MIN_PHOTOS - files.length} more photo${MIN_PHOTOS - files.length !== 1 ? 's' : ''} required`
                      : ''}
                </span>
              )}
              <button
                type="submit"
                className="studio-cta-primary"
                disabled={!isValid || submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 size={13} className="studio-spinner" />
                    {uploadProgress
                      ? `Uploading ${uploadProgress.uploaded} / ${uploadProgress.total}…`
                      : 'Ingesting…'}
                  </>
                ) : (
                  <>
                    Send to pipeline
                    <ArrowRight size={13} strokeWidth={2} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </StudioShell>
  );
};

export default StudioNew;
