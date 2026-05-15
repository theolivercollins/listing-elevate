import {
  useState,
  useCallback,
  useRef,
  type CSSProperties,
  type ChangeEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Camera, X, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { StudioNav } from '@/components/studio/StudioNav';
import { ClientPicker } from '@/components/studio/ClientPicker';
import { uploadPhotosToStorage } from '@/lib/photo-upload';
import '@/v2/styles/v2.css';

const EYEBROW: CSSProperties = {
  fontFamily: 'var(--le-font-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)',
};

const PAGE_H1: CSSProperties = {
  fontFamily: 'var(--le-font-sans)',
  fontSize: 'clamp(28px, 4vw, 44px)',
  fontWeight: 500,
  letterSpacing: '-0.035em',
  lineHeight: 0.98,
  color: '#fff',
  margin: 0,
};

const SECTION_HEADER: CSSProperties = {
  fontFamily: 'var(--le-font-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)',
  paddingBottom: 12,
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  display: 'block',
  marginBottom: 20,
};

const MIN_PHOTOS = 5;

interface UploadedFile {
  file: File;
  preview: string;
  id: string;
}

const StudioNew = () => {
  const navigate = useNavigate();

  // ─── form state ───
  const [address, setAddress] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [squareFootage, setSquareFootage] = useState('');
  const [price, setPrice] = useState('');
  const [directorNotes, setDirectorNotes] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);

  // ─── submit state ───
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; total: number } | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Validation
  const isValid = address.trim() && clientId && files.length >= MIN_PHOTOS;

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
      // 1. Upload photos to storage
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

      // 2. POST to ingest endpoint
      const res = await fetch('/api/admin/studio/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          address: address.trim(),
          bedrooms: bedrooms ? Number(bedrooms) : null,
          bathrooms: bathrooms ? Number(bathrooms) : null,
          // square_footage accepted by the API but not persisted yet — will land in a future migration
          square_footage: squareFootage ? Number(squareFootage) : null,
          price: price ? Number(price) : null,
          photo_storage_paths: photoPaths,
          director_notes: directorNotes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `${res.status} ${res.statusText}`);
      }

      const { property_id } = await res.json();

      // 3. Fire-and-forget pipeline trigger (matches customer-flow pattern in src/lib/api.ts)
      fetch(`/api/pipeline/${property_id}`, { method: 'POST' }).catch(() => {});

      // 4. Navigate to Property Command Center
      navigate(`/dashboard/studio/properties/${property_id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div>
        <span style={EYEBROW}>— New Listing</span>
        <h2 className="mt-3" style={PAGE_H1}>
          New Listing
        </h2>
      </div>

      <StudioNav />

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-12">
        {/* ─── Address + Client ─── */}
        <section>
          <span style={SECTION_HEADER}>— Property</span>
          <div className="space-y-6">
            <div>
              <Label className="label text-muted-foreground">
                Address <span className="text-destructive">*</span>
              </Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="208 Berry Street, Brooklyn, NY"
                required
                className="mt-2"
              />
            </div>

            <div>
              <Label className="label text-muted-foreground">
                Client <span className="text-destructive">*</span>
              </Label>
              <div className="mt-2">
                <ClientPicker value={clientId} onChange={setClientId} includeNone={false} />
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <Label className="label text-muted-foreground">Bedrooms</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  placeholder="3"
                  className="tabular mt-2"
                />
              </div>
              <div>
                <Label className="label text-muted-foreground">Bathrooms</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                  placeholder="2.5"
                  className="tabular mt-2"
                />
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <Label className="label text-muted-foreground">Square footage</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={squareFootage}
                  onChange={(e) => setSquareFootage(e.target.value)}
                  placeholder="1850"
                  className="tabular mt-2"
                />
              </div>
              <div>
                <Label className="label text-muted-foreground">Price ($)</Label>
                <div className="relative mt-2">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/60">
                    $
                  </span>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="2400000"
                    className="tabular pl-7"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label className="label text-muted-foreground">Director notes</Label>
              <textarea
                value={directorNotes}
                onChange={(e) => setDirectorNotes(e.target.value)}
                placeholder="Specific shots, pacing, brand language, or anything you want the pipeline to consider…"
                rows={4}
                className="mt-2 flex min-h-[100px] w-full rounded-none border border-border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus-visible:border-accent focus-visible:outline-none"
              />
            </div>
          </div>
        </section>

        {/* ─── Photos ─── */}
        <section>
          <span style={SECTION_HEADER}>— Photos</span>

          <div className="flex items-baseline justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              Drop or browse {MIN_PHOTOS}–60 high-resolution images (JPG, PNG, HEIC, WebP).
            </p>
            {files.length > 0 && (
              <span className="tabular text-xs text-muted-foreground">
                {files.length} / 60
              </span>
            )}
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className="relative flex aspect-[16/6] cursor-pointer items-center justify-center border-2 border-dashed text-center transition-all duration-500"
            style={{
              borderColor: isDragging ? 'var(--le-text)' : 'var(--le-border-strong)',
              background: isDragging ? 'var(--le-bg-sunken)' : 'var(--le-bg-elev)',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.heic,.webp"
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                e.target.files && handleFiles(e.target.files)
              }
            />
            <input
              ref={folderInputRef}
              type="file"
              {...({ webkitdirectory: '', directory: '' } as React.HTMLAttributes<HTMLInputElement>)}
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                e.target.files && handleFiles(e.target.files)
              }
            />
            <div>
              <Camera className="mx-auto h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
              <p className="mt-4 text-sm font-semibold tracking-[-0.01em]">Drop photos to upload</p>
              <p className="mt-1 text-xs text-muted-foreground">or click to browse files</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
                className="mt-4 text-[11px] font-medium uppercase tracking-[0.15em] text-accent underline underline-offset-4 hover:text-accent/80"
              >
                Import entire folder
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {files.length > 0 && files.length < MIN_PHOTOS && (
            <div className="mt-4 flex items-center gap-4">
              <div className="h-px flex-1 overflow-hidden bg-border">
                <div
                  className="h-full bg-foreground transition-all duration-500"
                  style={{ width: `${(files.length / MIN_PHOTOS) * 100}%` }}
                />
              </div>
              <span className="tabular text-[11px] text-accent">
                {MIN_PHOTOS - files.length} more required
              </span>
            </div>
          )}
          {files.length >= MIN_PHOTOS && (
            <p className="mt-3 text-xs text-accent">
              {files.length} photo{files.length !== 1 ? 's' : ''} ready
            </p>
          )}

          {/* Thumbnails */}
          {files.length > 0 && (
            <div className="mt-6 grid grid-cols-4 gap-1 sm:grid-cols-6 md:grid-cols-8">
              {files.map((f) => (
                <div
                  key={f.id}
                  className="group relative aspect-square overflow-hidden bg-secondary"
                >
                  <img src={f.preview} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(f.id);
                    }}
                    className="absolute inset-0 flex items-center justify-center bg-black/70 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    aria-label="Remove photo"
                  >
                    <X className="h-3.5 w-3.5 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Submit error */}
        {submitError && (
          <div className="border border-destructive/40 bg-destructive/10 px-4 py-3">
            <p className="text-xs text-destructive">{submitError}</p>
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-4 border-t border-border pt-6">
          <Button
            type="submit"
            disabled={!isValid || submitting}
            className="min-w-[160px]"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {uploadProgress
                  ? `Uploading ${uploadProgress.uploaded} / ${uploadProgress.total}…`
                  : 'Ingesting…'}
              </>
            ) : (
              <>
                Ingest listing <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>

          {!isValid && !submitting && (
            <span className="text-xs text-muted-foreground">
              {!address.trim()
                ? 'Address required'
                : !clientId
                  ? 'Client required'
                  : files.length < MIN_PHOTOS
                    ? `${MIN_PHOTOS - files.length} more photo${MIN_PHOTOS - files.length !== 1 ? 's' : ''} required`
                    : ''}
            </span>
          )}
        </div>
      </form>
    </div>
  );
};

export default StudioNew;
