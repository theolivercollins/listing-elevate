import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ChangeEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { authedFetch, lookupMls } from "@/lib/api";
import { Loader2, Image, X, ArrowRight, Search } from 'lucide-react';
import { StudioNav } from '@/components/studio/StudioNav';
import { StudioShell } from '@/components/studio/StudioShell';
import { ClientPicker } from '@/components/studio/ClientPicker';
import { DrivePullPanel, type DrivePullResult } from '@/components/studio/DrivePullPanel';
import { DriveUploadButton } from '@/components/studio/DriveUploadButton';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { uploadPhotosToStorage } from '@/lib/photo-upload';
import { extractImageFiles } from '@/lib/studio/extract-photos';
import { digitsOnly, formatNumber } from '@/lib/format';

const MIN_PHOTOS = 5;

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepIndicator({ steps, currentStep }: { steps: string[]; currentStep: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
      {steps.map((label, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  background: done
                    ? 'var(--le-ink)'
                    : active
                      ? 'var(--le-ink)'
                      : 'rgba(11,11,16,0.06)',
                  color: done || active ? 'var(--le-surface)' : 'var(--le-muted)',
                  transition: 'background 0.2s, color 0.2s',
                  flexShrink: 0,
                }}
              >
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: active ? 'var(--le-ink)' : done ? 'var(--le-muted)' : 'var(--le-muted-2)',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: done ? 'var(--le-ink)' : 'rgba(11,11,16,0.10)',
                  margin: '0 8px',
                  marginBottom: 22,
                  transition: 'background 0.2s',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

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

const StudioNew = () => {
  const navigate = useNavigate();

  // ─── Brian gate — Drive Pull panel ───
  const DRIVE_PULL_CLIENT_ID = import.meta.env.VITE_DRIVE_PULL_CLIENT_ID as string | undefined;

  // ─── form state ───
  const [address, setAddress] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [squareFootage, setSquareFootage] = useState('');
  const [price, setPrice] = useState('');                    // stores raw digits ("2400000")
  const [directorNotes, setDirectorNotes] = useState('');
  const [selectedDuration, setSelectedDuration] = useState<15 | 30 | 60>(30);
  const [videoType, setVideoType] = useState<'just_listed' | 'just_pended' | 'just_closed'>('just_listed');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [drivePhotos, setDrivePhotos] = useState<{ path: string; url: string }[]>([]);

  // ─── template availability ───
  interface ComboKey { video_type: string; duration: number; orientation: string }
  interface ComboAvailability extends ComboKey { available: boolean }
  const [templateAvailability, setTemplateAvailability] = useState<ComboAvailability[]>([]);

  useEffect(() => {
    authedFetch('/api/admin/studio/template-availability')
      .then((r) => r.json())
      .then((data: { combos?: ComboAvailability[] }) => {
        if (data.combos) setTemplateAvailability(data.combos);
      })
      .catch(() => {
        // Intentionally optimistic: a fetch error leaves templateAvailability empty,
        // so isComboAvailable returns true for every combo (the "not yet loaded"
        // branch). This is best-effort UI — the real backstop is server-side:
        // resolveTemplateId returns null for an unconfigured combo, which falls
        // through to the assembly code-gen path rather than ever blocking the
        // operator here.
      });
  }, []);

  /** Returns true when this combo has a configured template (or availability info not yet loaded). */
  const isComboAvailable = (vt: string, dur: number, orientation = 'horizontal'): boolean => {
    if (templateAvailability.length === 0) return true; // not yet loaded → optimistic
    const match = templateAvailability.find(
      (c) => c.video_type === vt && c.duration === dur && c.orientation === orientation,
    );
    return match?.available ?? true;
  };

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
  const zipInputRef = useRef<HTMLInputElement>(null);

  const currentComboAvailable = isComboAvailable(videoType, selectedDuration);
  const totalPhotoCount = files.length + drivePhotos.length;
  const isValid = address.trim() && totalPhotoCount >= MIN_PHOTOS && currentComboAvailable;

  // Step indicator — which conceptual step the user is on
  // Step 0: address (required); client is optional, no longer gates step 0
  // Step 1: property details + notes
  // Step 2: photos
  const currentStep = !address.trim() ? 0 : totalPhotoCount < MIN_PHOTOS ? 1 : 2;
  const FORM_STEPS = ['Client & address', 'Details & notes', 'Photos'];

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

  /** Handle a zip file or folder selection via extractImageFiles, then merge into files state. */
  const handleBulkInput = useCallback(
    async (input: File | FileList) => {
      try {
        const extracted = await extractImageFiles(input);
        // Use functional updater to read current length at the time of commit
        let droppedForCap = 0;
        let addedCount = 0;
        setFiles((prev) => {
          const remaining = 60 - prev.length;
          const toAdd = extracted.slice(0, remaining);
          droppedForCap = extracted.length - toAdd.length;
          addedCount = toAdd.length;
          const mapped = toAdd.map((f) => ({
            file: f,
            preview: URL.createObjectURL(f),
            id: crypto.randomUUID(),
          }));
          return [...prev, ...mapped];
        });
        // Don't silently truncate — tell the operator what got dropped at the 60-photo cap.
        if (droppedForCap > 0) {
          setSubmitError(
            `Imported ${addedCount} photo${addedCount === 1 ? '' : 's'}; dropped ${droppedForCap} over the 60-photo limit.`,
          );
        }
      } catch (err) {
        setSubmitError(
          err instanceof Error ? `Bulk import failed: ${err.message}` : 'Bulk import failed',
        );
      }
    },
    [],
  );

  // ─── Drive Pull handler ───
  const handleDrivePulled = (result: DrivePullResult) => {
    if (result.address) setAddress(result.address);
    const m = result.metadata;
    if (m.bedrooms != null) setBedrooms(String(m.bedrooms));
    if (m.bathrooms != null) setBathrooms(String(m.bathrooms));
    if (m.sqft != null) setSquareFootage(String(m.sqft));
    if (m.price != null) setPrice(String(Math.round(m.price)));
    setDrivePhotos(result.photos);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const removed = prev.find((f) => f.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  // ─── MLS lookup by address (Apify/Redfin chain) ───
  const handleMlsLookup = async () => {
    if (!address.trim()) {
      setMlsMsg({ kind: 'warn', text: 'Enter or pick an address first.' });
      return;
    }
    setMlsLooking(true);
    setMlsMsg({ kind: 'warn', text: 'Searching MLS — this can take 1–3 minutes…' });
    try {
      const r = await lookupMls(address.trim());
      if (r.price != null) setPrice(String(r.price));
      if (r.bedrooms != null) setBedrooms(String(r.bedrooms));
      if (r.bathrooms != null) setBathrooms(String(r.bathrooms));
      if (r.sqft != null) setSquareFootage(String(r.sqft));
      setMlsMsg({ kind: 'ok', text: `Matched via ${r.source}. Review and edit before submitting.` });
    } catch (err) {
      setMlsMsg({
        kind: 'err',
        text:
          err instanceof Error
            ? err.message
            : "Couldn't find this address on MLS — fill in details manually.",
      });
    } finally {
      setMlsLooking(false);
    }
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
      let uploadedPaths: string[] = [];
      if (files.length > 0) {
        uploadedPaths = await uploadPhotosToStorage(
          files.map((f) => f.file),
          `${tempId}/raw`,
          (uploaded, total) => setUploadProgress({ uploaded, total }),
        );

        if (uploadedPaths.length === 0) {
          throw new Error('All photo uploads failed. Check browser console for details.');
        }
      }

      setUploadProgress(null);

      const res = await authedFetch('/api/admin/studio/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          address: address.trim(),
          bedrooms: bedrooms ? Number(bedrooms) : null,
          bathrooms: bathrooms ? Number(bathrooms) : null,
          square_footage: squareFootage ? Number(squareFootage) : null,
          price: price ? Number(price) : null,
          photo_storage_paths: [...drivePhotos.map((p) => p.path), ...uploadedPaths],
          director_notes: directorNotes.trim() || null,
          selected_duration: selectedDuration,
          video_type: videoType,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `${res.status} ${res.statusText}`);
      }

      const { property_id } = await res.json();
      fetch(`/api/pipeline/${property_id}`, { method: 'POST' }).catch(() => {});
      // Fire scrape action fire-and-forget: fetch the run id from the bundle then kick scrape.
      authedFetch(`/api/admin/studio/properties/${property_id}`)
        .then((r) => r.json())
        .then((b) => {
          const runId = (b as { delivery_run?: { id?: string } }).delivery_run?.id;
          if (runId) {
            return authedFetch(`/api/admin/studio/delivery/${runId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'scrape' }),
            });
          }
        })
        // Recovery owner: the Property Command Center stepper (Task 13) exposes
        // a retry that re-fires the scrape action, which is resumable from 'intake'.
        .catch((e) => console.warn('[studio] scrape kick failed; stepper retry will recover', e));
      setDrivePhotos([]);
      navigate(`/dashboard/studio/video/properties/${property_id}`);
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
          <p className="studio-page-sub">Pick a client, drop in photos, send the pipeline.</p>
        </div>
      </div>

      {/* ─── StudioNav ─── */}
      <StudioNav />

      {/* ─── Form ─── */}
      <form
        onSubmit={handleSubmit}
        style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 0 }}
      >
        <StepIndicator steps={FORM_STEPS} currentStep={currentStep} />

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

            {/* Drive Pull — gated to Brian's client ID */}
            {clientId && DRIVE_PULL_CLIENT_ID && clientId === DRIVE_PULL_CLIENT_ID && (
              <DrivePullPanel onPulled={handleDrivePulled} />
            )}

            {/* Address — Google Places Autocomplete + MLS lookup */}
            <div>
              <FieldLabel required>Address</FieldLabel>
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <div style={{ flex: 1 }}>
                  <AddressAutocomplete
                    value={address}
                    onChange={(formatted) => {
                      setAddress(formatted);
                      setMlsMsg(null);
                    }}
                    className="studio-input"
                  />
                </div>
                <button
                  type="button"
                  className="studio-btn-ghost"
                  onClick={handleMlsLookup}
                  disabled={mlsLooking || !address.trim()}
                  style={{ whiteSpace: 'nowrap', padding: '10px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  title="Look up property details by address"
                >
                  {mlsLooking ? (
                    <Loader2 size={13} className="studio-spinner" />
                  ) : (
                    <Search size={13} strokeWidth={2} />
                  )}
                  Lookup MLS
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
            <div className="le-stack-sm" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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

            {/* Square footage / price — comma-formatted */}
            <div className="le-stack-sm" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <FieldLabel>Square footage</FieldLabel>
                <input
                  className="studio-input studio-tabnum"
                  type="text"
                  inputMode="numeric"
                  value={squareFootage ? formatNumber(Number(squareFootage)) : ''}
                  onChange={(e) => setSquareFootage(digitsOnly(e.target.value))}
                  placeholder="1,850"
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
                    type="text"
                    inputMode="numeric"
                    value={price ? formatNumber(Number(price)) : ''}
                    onChange={(e) => setPrice(digitsOnly(e.target.value))}
                    placeholder="2,400,000"
                    style={{ paddingLeft: 26 }}
                  />
                </div>
              </div>
            </div>

            {/* Director notes */}
            <div>
              <FieldLabel>Director notes</FieldLabel>
              <textarea
                className="studio-textarea"
                value={directorNotes}
                onChange={(e) => setDirectorNotes(e.target.value)}
                placeholder="Specific shots, pacing, brand language, or anything you want the pipeline to consider…"
                rows={4}
              />
            </div>

            {/* Video type */}
            <div>
              <FieldLabel>Video type</FieldLabel>
              <div
                role="group"
                aria-label="Video type"
                style={{ display: 'flex', gap: 8 }}
              >
                {(['just_listed', 'just_pended', 'just_closed'] as const).map((vt) => {
                  const active = videoType === vt;
                  // Check whether *any* duration for this video type is available.
                  // A type is reachable if at least one duration combo is live.
                  const vtAvailable = ([15, 30, 60] as const).some((d) => isComboAvailable(vt, d));
                  const label = vt === 'just_listed' ? 'Just Listed' : vt === 'just_pended' ? 'Just Pended' : 'Just Closed';
                  return (
                    <div
                      key={vt}
                      style={{ flex: 1, position: 'relative' }}
                      title={!vtAvailable ? 'Not available yet' : undefined}
                    >
                      <button
                        type="button"
                        aria-pressed={active}
                        aria-disabled={!vtAvailable}
                        onClick={() => { if (vtAvailable) setVideoType(vt); }}
                        className="studio-input"
                        style={{
                          width: '100%',
                          cursor: vtAvailable ? 'pointer' : 'not-allowed',
                          textAlign: 'center',
                          fontWeight: active ? 600 : 500,
                          color: !vtAvailable
                            ? 'var(--le-muted-2, rgba(11,11,16,0.3))'
                            : active
                              ? 'var(--le-ink)'
                              : 'var(--le-muted)',
                          borderColor: active && vtAvailable ? 'var(--le-ink)' : undefined,
                          background: active && vtAvailable
                            ? 'var(--le-surface-2, rgba(0,0,0,0.04))'
                            : !vtAvailable
                              ? 'rgba(11,11,16,0.02)'
                              : undefined,
                          opacity: vtAvailable ? 1 : 0.5,
                        }}
                      >
                        {label}
                        {!vtAvailable && (
                          <span
                            style={{
                              display: 'block',
                              fontSize: 10,
                              fontWeight: 400,
                              color: 'var(--le-muted-2, rgba(11,11,16,0.3))',
                              marginTop: 2,
                            }}
                          >
                            not available yet
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Duration */}
            <div>
              <FieldLabel>Video length</FieldLabel>
              <div
                role="group"
                aria-label="Video length"
                style={{ display: 'flex', gap: 8 }}
              >
                {([15, 30, 60] as const).map((d) => {
                  const active = selectedDuration === d;
                  const dAvailable = isComboAvailable(videoType, d);
                  return (
                    <div
                      key={d}
                      style={{ flex: 1, position: 'relative' }}
                      title={!dAvailable ? 'Not available yet' : undefined}
                    >
                      <button
                        type="button"
                        aria-pressed={active}
                        aria-disabled={!dAvailable}
                        onClick={() => { if (dAvailable) setSelectedDuration(d); }}
                        className="studio-input"
                        style={{
                          width: '100%',
                          cursor: dAvailable ? 'pointer' : 'not-allowed',
                          textAlign: 'center',
                          fontWeight: active ? 600 : 500,
                          color: !dAvailable
                            ? 'var(--le-muted-2, rgba(11,11,16,0.3))'
                            : active
                              ? 'var(--le-ink)'
                              : 'var(--le-muted)',
                          borderColor: active && dAvailable ? 'var(--le-ink)' : undefined,
                          background: active && dAvailable
                            ? 'var(--le-surface-2, rgba(0,0,0,0.04))'
                            : !dAvailable
                              ? 'rgba(11,11,16,0.02)'
                              : undefined,
                          opacity: dAvailable ? 1 : 0.5,
                        }}
                      >
                        {d}s
                        {!dAvailable && (
                          <span
                            style={{
                              display: 'block',
                              fontSize: 10,
                              fontWeight: 400,
                              color: 'var(--le-muted-2, rgba(11,11,16,0.3))',
                              marginTop: 2,
                            }}
                          >
                            not available yet
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Photo dropzone */}
            <div>
              <FieldLabel>Photos</FieldLabel>
              <div
                className={'studio-dropzone' + (isDragging ? ' dragging' : '')}
                style={{
                  aspectRatio: '16/6',
                  minHeight: 140,
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
                    e.target.files && handleBulkInput(e.target.files)
                  }
                />
                <input
                  ref={zipInputRef}
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  style={{ display: 'none' }}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const f = e.target.files?.[0];
                    if (f) handleBulkInput(f);
                    // Reset so the same zip can be re-selected if needed
                    e.target.value = '';
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <Image size={28} strokeWidth={1.4} style={{ color: 'var(--le-muted)' }} />
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--le-ink-2)', letterSpacing: '-0.01em' }}>
                    Drop photos to upload
                  </p>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--le-muted)' }}>
                    or click to browse — JPG, PNG, HEIC, WebP
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}
                      className="studio-btn-ghost studio-btn-sm"
                    >
                      Import folder
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); zipInputRef.current?.click(); }}
                      className="studio-btn-ghost studio-btn-sm"
                    >
                      Import ZIP
                    </button>
                    {/* Drive upload — only rendered when VITE_GOOGLE_* env vars are set */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <DriveUploadButton
                        onFilesImported={(imported) =>
                          setFiles((prev) => {
                            const seen = new Set(prev.map((f) => f.id));
                            return [...prev, ...imported.filter((f) => !seen.has(f.id))];
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Photo count progress */}
              {totalPhotoCount > 0 && totalPhotoCount < MIN_PHOTOS && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      background: 'var(--le-line)',
                      borderRadius: 999,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${(totalPhotoCount / MIN_PHOTOS) * 100}%`,
                        background: 'var(--le-accent)',
                        borderRadius: 999,
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
                    {MIN_PHOTOS - totalPhotoCount} more required
                  </span>
                </div>
              )}
              {totalPhotoCount >= MIN_PHOTOS && (
                <p
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: 'var(--le-good)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {totalPhotoCount} photo{totalPhotoCount !== 1 ? 's' : ''} ready
                </p>
              )}

              {/* Thumbnails */}
              {(files.length > 0 || drivePhotos.length > 0) && (
                <div
                  className="le-cols-3-lg le-cols-2-sm"
                  style={{
                    marginTop: 16,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(6, 1fr)',
                    gap: 6,
                  }}
                >
                  {drivePhotos.map((p, i) => (
                    <div
                      key={p.path}
                      style={{
                        position: 'relative',
                        aspectRatio: '1',
                        borderRadius: 'var(--le-r-md)',
                        overflow: 'hidden',
                        background: 'rgba(11,11,16,0.06)',
                      }}
                    >
                      <img
                        src={p.url}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                      <span
                        style={{
                          position: 'absolute',
                          top: 4,
                          left: 4,
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: '0.02em',
                          background: 'rgba(11,11,16,0.72)',
                          color: '#fff',
                          borderRadius: 3,
                          padding: '1px 5px',
                          pointerEvents: 'none',
                        }}
                      >
                        Drive
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDrivePhotos((prev) => prev.filter((_, j) => j !== i)); }}
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
                        aria-label="Remove Drive photo"
                      >
                        <X size={14} strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                  {files.map((f) => (
                    <div
                      key={f.id}
                      style={{
                        position: 'relative',
                        aspectRatio: '1',
                        borderRadius: 'var(--le-r-md)',
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
                    : totalPhotoCount < MIN_PHOTOS
                      ? `${MIN_PHOTOS - totalPhotoCount} more photo${MIN_PHOTOS - totalPhotoCount !== 1 ? 's' : ''} required`
                      : !currentComboAvailable
                        ? 'Selected combination not available yet — choose a different type or duration'
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
