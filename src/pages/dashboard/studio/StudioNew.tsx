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
import { DriveUploadButton } from '@/components/studio/DriveUploadButton';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';
import { uploadSinglePhoto } from '@/lib/photo-upload';
import { extractImageFiles } from '@/lib/studio/extract-photos';
import { digitsOnly, formatNumber } from '@/lib/format';
import { OPERATOR_VIDEO_SKUS } from '@/lib/labModels';
import { getLatestDraft, saveDraft, deleteDraft, isDraftMeaningful, type Draft } from '@/lib/studio/draft';

const MIN_PHOTOS = 5;
const MAX_PHOTOS = 300;

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
  id: string;
  /** Present for freshly-added local files; absent for a photo restored from a draft. */
  file?: File;
  /** Original filename — set for both fresh and restored entries. */
  fileName: string;
  /** Local objectURL — only set for freshly-added files, revoked on remove/replace. */
  localPreview?: string;
  /** Bucket-relative Storage path, set once the eager upload succeeds. */
  storagePath?: string;
  /** Absolute public URL, set once the eager upload succeeds (or hydrated from a restored draft). */
  publicUrl?: string;
  uploadState: 'uploading' | 'done' | 'error';
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
  const [autoRun, setAutoRun] = useState(false);
  const [videoModelSku, setVideoModelSku] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);

  // ─── autosave draft state ───
  // draftId is the Storage folder prefix for eagerly-uploaded photos
  // (property-photos/{draftId}/raw/...) — minted on first photo add, or
  // adopted from a resumed draft's own id. It never needs to be reactive
  // (nothing renders it), so a ref is enough.
  const draftIdRef = useRef<string | null>(null);
  // The server-assigned id of the admin's single draft ROW, once known — set
  // after the first successful autosave, or immediately on Resume. Mirrored in
  // a ref so submit-time cleanup reads the live value, never a stale closure or
  // a null state that lost to an in-flight autosave (fix: reliable submit
  // cleanup). NOTE: this is the row id, distinct from draftIdRef (the Storage
  // folder prefix) — for a NEW draft the two differ (random prefix vs
  // server-assigned row id); only a resumed draft shares them.
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const savedDraftIdRef = useRef<string | null>(null);
  // True from the instant submit begins. A ref (not just `submitting` state) so
  // the debounced autosave sees it synchronously and can (a) refuse to start a
  // new save and (b) self-delete a late save that lands after submit's cleanup.
  const submittingRef = useRef(false);
  // Autosave sequencing: abort the previous in-flight PUT before starting a new
  // one, and drop any resolve whose token is no longer current — so a slow older
  // save can't clobber a newer one.
  const saveAbortRef = useRef<AbortController | null>(null);
  const saveSeqRef = useRef(0);
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  const [showResumeBanner, setShowResumeBanner] = useState(false);
  // Photo ids whose restored publicUrl 404'd/failed to load — tracked so the
  // thumbnail can offer "remove" instead of a broken <img>, and so submit
  // never sends a path for a photo that no longer exists in Storage.
  const [brokenPhotoIds, setBrokenPhotoIds] = useState<Set<string>>(new Set());

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
  const [isDragging, setIsDragging] = useState(false);
  // Inline error shown right under the photo import buttons — separate from
  // submitError (bottom-of-form) so a failed folder/zip/Drive import is never
  // silent. Clears on the next successful import.
  const [importError, setImportError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const currentComboAvailable = isComboAvailable(videoType, selectedDuration);
  // Counted the instant a photo is added (matches the pre-eager-upload feel)
  // — only excludes photos that are definitively unusable: a failed fresh
  // upload, or a restored photo whose remote object no longer loads.
  const totalPhotoCount = files.filter(
    (f) => f.uploadState !== 'error' && !brokenPhotoIds.has(f.id),
  ).length;
  const uploadingCount = files.filter((f) => f.uploadState === 'uploading').length;
  // usableFiles are the ones submit can actually send — already uploaded,
  // with a real storagePath, and not flagged broken.
  const usableFiles = files.filter(
    (f) => f.uploadState === 'done' && f.storagePath && !brokenPhotoIds.has(f.id),
  );
  const isValid =
    !!address.trim() &&
    totalPhotoCount >= MIN_PHOTOS &&
    currentComboAvailable &&
    uploadingCount === 0;

  // Step indicator — which conceptual step the user is on
  // Step 0: address (required); client is optional, no longer gates step 0
  // Step 1: property details + notes
  // Step 2: photos
  const currentStep = !address.trim() ? 0 : totalPhotoCount < MIN_PHOTOS ? 1 : 2;
  const FORM_STEPS = ['Client & address', 'Details & notes', 'Photos'];

  // ─── eager per-photo upload (autosave draft) ───

  /** Mint the Storage folder prefix lazily, on first photo add (its only caller). */
  const ensureDraftId = (): string => {
    if (!draftIdRef.current) draftIdRef.current = crypto.randomUUID();
    return draftIdRef.current;
  };

  /** Upload one file to Storage and flip its entry to done/error in place. */
  const uploadFileEntry = useCallback((id: string, file: File) => {
    const folder = `${ensureDraftId()}/raw`;
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, uploadState: 'uploading' as const } : f)),
    );
    uploadSinglePhoto(file, folder)
      .then(({ storagePath, publicUrl }) => {
        setFiles((prev) =>
          prev.map((f) => {
            if (f.id !== id) return f;
            // The thumbnail now renders publicUrl, so the local objectURL
            // preview is dead weight — revoke it to avoid a blob-URL leak.
            if (f.localPreview) URL.revokeObjectURL(f.localPreview);
            return {
              ...f,
              storagePath,
              publicUrl,
              uploadState: 'done' as const,
              localPreview: undefined,
            };
          }),
        );
      })
      .catch((err) => {
        console.error('[studio] photo upload failed:', err);
        setFiles((prev) =>
          prev.map((f) => (f.id === id ? { ...f, uploadState: 'error' as const } : f)),
        );
      });
  }, []);

  // ─── file handling ───
  const handleFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const accepted = Array.from(newFiles).filter((f) =>
        /\.(jpg|jpeg|png|heic|webp)$/i.test(f.name),
      );
      const remaining = MAX_PHOTOS - files.length;
      const toAdd = accepted.slice(0, remaining);
      const mapped: UploadedFile[] = toAdd.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        fileName: f.name,
        localPreview: URL.createObjectURL(f),
        uploadState: 'uploading',
      }));
      setFiles((prev) => [...prev, ...mapped]);
      if (toAdd.length > 0) setImportError(null);
      mapped.forEach((entry) => uploadFileEntry(entry.id, entry.file!));
    },
    [files.length, uploadFileEntry],
  );

  /** Handle a zip file or folder selection via extractImageFiles, then merge into files state. */
  const handleBulkInput = useCallback(
    async (input: File | FileList) => {
      try {
        const extracted = await extractImageFiles(input);
        if (extracted.length === 0) {
          // Goal: a failed folder/zip import is never silent.
          setImportError('No images found in that folder/zip.');
          return;
        }
        // Use functional updater to read current length at the time of commit
        let droppedForCap = 0;
        let addedEntries: UploadedFile[] = [];
        setFiles((prev) => {
          const remaining = MAX_PHOTOS - prev.length;
          const toAdd = extracted.slice(0, remaining);
          droppedForCap = extracted.length - toAdd.length;
          addedEntries = toAdd.map((f) => ({
            id: crypto.randomUUID(),
            file: f,
            fileName: f.name,
            localPreview: URL.createObjectURL(f),
            uploadState: 'uploading' as const,
          }));
          return [...prev, ...addedEntries];
        });
        setImportError(null); // successful import — clear any prior inline error
        addedEntries.forEach((entry) => uploadFileEntry(entry.id, entry.file!));
        // Don't silently truncate — tell the operator what got dropped at the photo cap.
        if (droppedForCap > 0) {
          setSubmitError(
            `Imported ${addedEntries.length} photo${addedEntries.length === 1 ? '' : 's'}; dropped ${droppedForCap} over the ${MAX_PHOTOS}-photo limit.`,
          );
        }
      } catch (err) {
        console.error('[studio import]', err);
        const message =
          err instanceof Error ? `Bulk import failed: ${err.message}` : 'Bulk import failed';
        setSubmitError(message);
        setImportError(message);
      }
    },
    [uploadFileEntry],
  );

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const removed = prev.find((f) => f.id === id);
      if (removed?.localPreview) URL.revokeObjectURL(removed.localPreview);
      // We deliberately do NOT delete the Storage object here. The anon client
      // has no DELETE policy on property-photos (INSERT/SELECT only), so a
      // client-side delete always 403s silently. Dropping the photo from
      // photo_paths is enough: the now-orphaned object is reclaimed server-side
      // (service-role) when the draft is discarded (?purge=1) or by the 14-day
      // studio-draft-cleanup cron — both of which skip any object still
      // referenced by a live property's photos.file_url.
      return prev.filter((f) => f.id !== id);
    });
    setBrokenPhotoIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // Keep a live handle on `files` for the unmount-only cleanup below (a cleanup
  // that closed over `files` directly would either capture a stale array or
  // re-run on every change).
  const filesRef = useRef(files);
  filesRef.current = files;
  // Revoke any outstanding objectURL previews on unmount (memory-leak guard) —
  // covers photos still uploading when the operator navigates away.
  useEffect(() => {
    return () => {
      for (const f of filesRef.current) {
        if (f.localPreview) URL.revokeObjectURL(f.localPreview);
      }
    };
  }, []);

  // ─── restore: check for an existing draft once, on mount ───
  useEffect(() => {
    getLatestDraft()
      .then((draft) => {
        if (!draft) return;
        if (!isDraftMeaningful(draft)) return; // an empty/stale row is never worth a banner
        setPendingDraft(draft);
        setShowResumeBanner(true);
      })
      .catch(() => {
        // Best-effort — a failed restore-check is invisible; the operator
        // just starts a fresh order, same as before this feature existed.
      });
  }, []);

  const handleResumeDraft = () => {
    if (!pendingDraft) return;
    const d = pendingDraft;
    draftIdRef.current = d.id;
    savedDraftIdRef.current = d.id;
    setSavedDraftId(d.id);
    setClientId(d.client_id ?? null);
    setAddress(d.address ?? '');
    setBedrooms(d.bedrooms != null ? String(d.bedrooms) : '');
    setBathrooms(d.bathrooms != null ? String(d.bathrooms) : '');
    setSquareFootage(d.square_footage != null ? String(d.square_footage) : '');
    setPrice(d.price != null ? String(d.price) : '');
    setDirectorNotes(d.director_notes ?? '');
    if (d.selected_duration === 15 || d.selected_duration === 30 || d.selected_duration === 60) {
      setSelectedDuration(d.selected_duration);
    }
    if (
      d.video_type === 'just_listed' ||
      d.video_type === 'just_pended' ||
      d.video_type === 'just_closed'
    ) {
      setVideoType(d.video_type);
    }
    setAutoRun(!!d.auto_run);
    setVideoModelSku(d.video_model_sku ?? null);
    setFiles(
      (d.photo_paths ?? []).map((p) => ({
        id: crypto.randomUUID(),
        fileName: p.name,
        storagePath: p.path,
        publicUrl: p.url,
        uploadState: 'done' as const,
      })),
    );
    setShowResumeBanner(false);
    setPendingDraft(null);
  };

  const handleDiscardDraft = () => {
    // Discard reclaims storage too (purge=1) — the operator is throwing this
    // WIP away, so its uploaded objects should go with it (server-side skips
    // any object still referenced by a live property).
    if (pendingDraft) deleteDraft(pendingDraft.id, { purge: true }).catch(() => {});
    setShowResumeBanner(false);
    setPendingDraft(null);
  };

  // ─── autosave: debounce a save of the current form snapshot ───
  useEffect(() => {
    if (submitting) return; // don't race the ingest POST with a redundant PUT

    const photoPaths = files
      .filter((f) => f.uploadState === 'done' && f.storagePath && f.publicUrl)
      .map((f) => ({ path: f.storagePath!, url: f.publicUrl!, name: f.fileName }));

    const snapshot = {
      client_id: clientId,
      address: address.trim() || null,
      bedrooms: bedrooms ? Number(bedrooms) : null,
      bathrooms: bathrooms ? Number(bathrooms) : null,
      square_footage: squareFootage ? Number(squareFootage) : null,
      price: price ? Number(price) : null,
      director_notes: directorNotes.trim() || null,
      selected_duration: selectedDuration,
      video_type: videoType,
      video_model_sku: videoModelSku,
      auto_run: autoRun,
      photo_paths: photoPaths,
    };

    if (!isDraftMeaningful(snapshot)) return; // never autosave a blank form

    const handle = setTimeout(() => {
      // Submit may have begun during the debounce window — never create or
      // rewrite the row once it has (it's about to be, or already, deleted).
      if (submittingRef.current) return;
      // Supersede any older in-flight autosave so a slow older PUT can't clobber
      // this newer one.
      saveAbortRef.current?.abort();
      const controller = new AbortController();
      saveAbortRef.current = controller;
      const seq = ++saveSeqRef.current;
      saveDraft(snapshot, controller.signal)
        .then((saved) => {
          if (seq !== saveSeqRef.current) return; // a newer save superseded this one
          if (!saved) return;
          savedDraftIdRef.current = saved.id;
          if (submittingRef.current) {
            // A late autosave landed AFTER submit ran its cleanup — delete the
            // row it just (re)wrote so an already-sent order never resurfaces as
            // a resumable draft (which would create a duplicate property).
            deleteDraft(saved.id).catch(() => {});
            return;
          }
          setSavedDraftId(saved.id);
        })
        .catch(() => {
          // Best-effort — a dropped/aborted autosave tick is invisible to the
          // operator; the next tick (or the next photo finishing upload)
          // retries automatically.
        });
    }, 800);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    address,
    clientId,
    bedrooms,
    bathrooms,
    squareFootage,
    price,
    directorNotes,
    selectedDuration,
    videoType,
    autoRun,
    videoModelSku,
    files,
    submitting,
  ]);

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

    // Synchronously freeze autosave: from here, any pending debounce refuses to
    // run and any in-flight save self-deletes on resolve (see the autosave
    // effect). Set before the first await so no tick can slip through.
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    try {
      // Photos already uploaded eagerly as they were added — no re-upload
      // here, just reuse the storage paths that finished successfully.
      const uploadedPaths = usableFiles.map((f) => f.storagePath!);
      if (uploadedPaths.length === 0) {
        throw new Error('No photos finished uploading. Check your connection and try again.');
      }

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
          photo_storage_paths: uploadedPaths,
          director_notes: directorNotes.trim() || null,
          selected_duration: selectedDuration,
          video_type: videoType,
          auto_run: autoRun,
          video_model_sku: videoModelSku,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `${res.status} ${res.statusText}`);
      }

      const { property_id } = await res.json();

      // The draft has fulfilled its purpose — remove it so a later visit to
      // New Order doesn't offer to "resume" an order that's already been
      // sent. Read the ROW ID from the ref (never the possibly-stale
      // `savedDraftId` state / a defeated closure) and AWAIT the delete
      // BEFORE navigating — submittingRef is already true (set at the top of
      // this handler), so the autosave effect can't re-create/rewrite the row
      // out from under this delete. Still best-effort: a failed delete just
      // leaves a stale row for the cleanup cron to sweep in 14 days: it must
      // never block navigation to the new property.
      const doneDraftId = savedDraftIdRef.current;
      if (doneDraftId) {
        try {
          await deleteDraft(doneDraftId);
        } catch {
          // best-effort; cron sweeps in 14 days
        }
      }

      // authedFetch attaches the Supabase Bearer token required by the now-gated
      // pipeline endpoint (F2 security fix). Fire-and-forget: not awaited.
      authedFetch(`/api/pipeline/${property_id}`, { method: 'POST' }).catch(() => {});
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

      {/* ─── Resume-draft banner ─── */}
      {showResumeBanner && pendingDraft && (
        <div
          className="studio-card"
          style={{
            maxWidth: 680,
            padding: '16px 20px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--le-ink)' }}>
              Resume your unsaved order?
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--le-muted)' }}>
              {pendingDraft.address?.trim() || 'An in-progress order'}
              {pendingDraft.photo_paths.length > 0
                ? ` — ${pendingDraft.photo_paths.length} photo${pendingDraft.photo_paths.length === 1 ? '' : 's'} saved`
                : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              className="studio-btn-ghost studio-btn-sm"
              onClick={handleDiscardDraft}
            >
              Discard
            </button>
            <button
              type="button"
              className="studio-cta-primary"
              style={{ padding: '8px 14px' }}
              onClick={handleResumeDraft}
            >
              Resume
            </button>
          </div>
        </div>
      )}

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

            {/* Autopilot */}
            <div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  cursor: 'pointer',
                  padding: '14px 16px',
                  borderRadius: 'var(--le-r-md)',
                  border: `1px solid ${autoRun ? 'rgba(47,138,85,0.35)' : 'var(--le-line)'}`,
                  background: autoRun ? 'rgba(47,138,85,0.05)' : 'var(--le-surface)',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={autoRun}
                  onChange={(e) => setAutoRun(e.target.checked)}
                  style={{ marginTop: 2, flexShrink: 0, accentColor: 'var(--le-good)', width: 15, height: 15 }}
                  aria-describedby="autopilot-hint"
                />
                <div>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: autoRun ? 'var(--le-good)' : 'var(--le-ink)',
                      marginBottom: 2,
                    }}
                  >
                    Auto-run (Autopilot)
                  </span>
                  <span
                    id="autopilot-hint"
                    style={{ fontSize: 12, color: 'var(--le-muted)', lineHeight: 1.45 }}
                  >
                    Let AI run this listing end-to-end. The pipeline will advance through
                    each gate automatically. You can pause or take over at any time.
                  </span>
                </div>
              </label>
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

            {/* Video model */}
            <div>
              <FieldLabel>Video model</FieldLabel>
              <select
                className="studio-input"
                value={videoModelSku ?? 'auto'}
                onChange={(e) =>
                  setVideoModelSku(e.target.value === 'auto' ? null : e.target.value)
                }
              >
                {OPERATOR_VIDEO_SKUS.map((opt) => (
                  <option
                    key={opt.key ?? 'auto'}
                    value={opt.key ?? 'auto'}
                    disabled={!opt.available}
                  >
                    {opt.label}{!opt.available ? ' (coming soon)' : ''}
                  </option>
                ))}
              </select>
              <p
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: 'var(--le-muted)',
                  lineHeight: 1.4,
                }}
              >
                Applies to every scene in this listing. 4K = native UHD (larger file).
              </p>
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
                        onFilesImported={(imported) => {
                          // Follow the same MAX_PHOTOS cap pattern as handleBulkInput.
                          let droppedForCap = 0;
                          let addedEntries: UploadedFile[] = [];
                          setFiles((prev) => {
                            const seen = new Set(prev.map((f) => f.id));
                            const deduped = imported.filter((f) => !seen.has(f.id));
                            const remaining = MAX_PHOTOS - prev.length;
                            const toAdd = deduped.slice(0, remaining);
                            droppedForCap = deduped.length - toAdd.length;
                            addedEntries = toAdd.map((f) => ({
                              id: f.id,
                              file: f.file,
                              fileName: f.file.name,
                              localPreview: f.preview,
                              uploadState: 'uploading' as const,
                            }));
                            return [...prev, ...addedEntries];
                          });
                          if (addedEntries.length > 0) setImportError(null);
                          addedEntries.forEach((entry) => uploadFileEntry(entry.id, entry.file!));
                          if (droppedForCap > 0) {
                            setSubmitError(
                              `Imported ${addedEntries.length} photo${addedEntries.length === 1 ? '' : 's'}; dropped ${droppedForCap} over the ${MAX_PHOTOS}-photo limit.`,
                            );
                          }
                        }}
                      />
                    </div>
                  </div>
                  {/* Inline import error — near the buttons, not only at the bottom of the form */}
                  {importError && (
                    <p
                      onClick={(e) => e.stopPropagation()}
                      role="alert"
                      style={{ marginTop: 4, fontSize: 11.5, color: 'var(--le-bad)' }}
                    >
                      {importError}
                    </p>
                  )}
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
              {uploadingCount > 0 && (
                <p
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: 'var(--le-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Loader2 size={11} className="studio-spinner" />
                  Uploading {uploadingCount} photo{uploadingCount === 1 ? '' : 's'}…
                </p>
              )}

              {/* Thumbnails */}
              {files.length > 0 && (
                <div
                  className="le-cols-3-lg le-cols-2-sm"
                  style={{
                    marginTop: 16,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(6, 1fr)',
                    gap: 6,
                  }}
                >
                  {files.map((f) => {
                    const broken = brokenPhotoIds.has(f.id);
                    const imgSrc = !broken ? (f.publicUrl ?? f.localPreview) : undefined;
                    const failed = f.uploadState === 'error' || broken;
                    return (
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
                        {imgSrc ? (
                          <img
                            src={imgSrc}
                            alt=""
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              display: 'block',
                              opacity: f.uploadState === 'uploading' ? 0.55 : 1,
                            }}
                            onError={() =>
                              setBrokenPhotoIds((prev) => new Set(prev).add(f.id))
                            }
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Image size={18} strokeWidth={1.4} style={{ color: 'var(--le-muted)' }} />
                          </div>
                        )}

                        {f.uploadState === 'uploading' && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Loader2 size={16} className="studio-spinner" style={{ color: '#fff' }} />
                          </div>
                        )}

                        {failed ? (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 4,
                              background: 'rgba(196,60,60,0.72)',
                              color: '#fff',
                              fontSize: 9.5,
                              fontWeight: 600,
                              textAlign: 'center',
                              padding: 4,
                            }}
                          >
                            <span>{broken ? 'Photo unavailable' : 'Upload failed'}</span>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {!broken && f.file && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    uploadFileEntry(f.id, f.file!);
                                  }}
                                  style={{
                                    background: 'rgba(255,255,255,0.25)',
                                    border: 'none',
                                    borderRadius: 4,
                                    color: '#fff',
                                    fontSize: 9.5,
                                    fontWeight: 600,
                                    padding: '3px 6px',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Retry
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                                style={{
                                  background: 'rgba(255,255,255,0.25)',
                                  border: 'none',
                                  borderRadius: 4,
                                  color: '#fff',
                                  fontSize: 9.5,
                                  fontWeight: 600,
                                  padding: '3px 6px',
                                  cursor: 'pointer',
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : (
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
                        )}
                      </div>
                    );
                  })}
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
                      : uploadingCount > 0
                        ? `Finishing ${uploadingCount} photo upload${uploadingCount === 1 ? '' : 's'}…`
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
                    Ingesting…
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
