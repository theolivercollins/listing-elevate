/**
 * Minimal Supabase Storage photo upload helper.
 *
 * Extracted from the inline logic in src/lib/api.ts:createProperty so that
 * the Operator Studio ingest form (StudioNew.tsx) can reuse the same upload
 * pattern.  Upload.tsx / createProperty() could later be migrated to use this
 * helper to remove the duplication.
 */

const SUPABASE_URL = 'https://vrhmaeywqsohlztoouxu.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyaG1hZXl3cXNvaGx6dG9vdXh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDIxOTIsImV4cCI6MjA5MTQxODE5Mn0.GaiexH5L24zAoLgvjOUiixbHdnQW8kUMXXbyjnM8cM4';

const BATCH_SIZE = 5;

/**
 * Upload a list of File objects to the `property-photos` Supabase Storage
 * bucket under `<folderPath>/<timestamped-filename>`.
 *
 * Returns the list of storage paths that succeeded.  Partial uploads are
 * allowed — the caller can decide whether to reject on partial failure.
 *
 * @param files     Files to upload
 * @param folderPath  Bucket-relative prefix, e.g. `<tempId>/raw`
 * @param onProgress  Optional callback fired after each file finishes
 */
export async function uploadPhotosToStorage(
  files: File[],
  folderPath: string,
  onProgress?: (uploaded: number, total: number) => void,
): Promise<string[]> {
  const total = files.length;
  let uploaded = 0;
  const uploadedPaths: string[] = [];

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (file, j) => {
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const fileName = `${Date.now()}_${i + j}_${safeName}`;
        const storagePath = `${folderPath}/${fileName}`;
        try {
          const res = await fetch(
            `${SUPABASE_URL}/storage/v1/object/property-photos/${storagePath}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': file.type || 'image/jpeg',
                'x-upsert': 'true',
              },
              body: file,
            },
          );
          uploaded++;
          onProgress?.(uploaded, total);
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            console.error(`Upload failed for ${file.name}: ${res.status} ${text}`);
            return null;
          }
          return storagePath;
        } catch (err) {
          uploaded++;
          onProgress?.(uploaded, total);
          console.error(
            `Network error uploading ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }
      }),
    );
    uploadedPaths.push(...results.filter((p): p is string => p !== null));
  }

  return uploadedPaths;
}

/**
 * Upload a single file (logo, headshot, etc.) to Supabase Storage.
 *
 * Returns the storage path on success, or throws on failure.
 */
export async function uploadSingleFile(
  file: File,
  storagePath: string,
  bucket: string = 'property-photos',
): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
  return storagePath;
}

/**
 * Get a public URL for a storage path.
 */
export function getStoragePublicUrl(
  storagePath: string,
  bucket: string = 'property-photos',
): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;
}
