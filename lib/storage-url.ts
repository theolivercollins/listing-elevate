// Canonical photo-URL normalizer.
//
// The pipeline analyzer, the video providers, and the QC judge all do
// fetch(photo.file_url) / new URL(photo.file_url), so file_url MUST be an
// absolute, fetchable URL. Some upload paths (e.g. the Operator Studio studio
// form) produce BARE storage paths like `<tempId>/raw/<file>.jpg`; storing
// those verbatim left property 8bd86c4f (310 Severin Rd) with 0 analyzed
// photos -> 0 scenes -> stuck at 'generating' forever.
//
// Use this at BOTH ends — when writing photo rows (ingest) and when reading
// them back for the pipeline (getPhotosForProperty) — so a relative path can
// never reach a fetch() call regardless of how the row was created.
//
// `getPublicUrl` is injected (e.g. supabase.storage.from('property-photos')
// .getPublicUrl(path).data.publicUrl) so this stays a pure, unit-testable fn.
export function ensureAbsolutePhotoUrl(
  fileUrl: string,
  getPublicUrl: (path: string) => string,
): string {
  if (!fileUrl) return fileUrl;
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  const path = fileUrl.replace(/^\/+/, "").replace(/^property-photos\//, "");
  return getPublicUrl(path);
}
