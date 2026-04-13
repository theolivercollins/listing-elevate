import { getSupabase, insertPhotos, log } from "./db.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const BUCKET = "property-photos";
const IMAGE_MIME_PREFIX = "image/";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export function extractDriveFolderId(link: string): string | null {
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const re of patterns) {
    const m = link.match(re);
    if (m) return m[1];
  }
  return null;
}

async function listDriveFolderImages(folderId: string, apiKey: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType)",
      pageSize: "100",
      key: apiKey,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${DRIVE_API}/files?${params}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Drive list failed (${res.status}): ${body}`);
    }
    const json = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    for (const f of json.files ?? []) {
      if (f.mimeType.startsWith(IMAGE_MIME_PREFIX)) files.push(f);
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return files;
}

async function downloadDriveFile(fileId: string, apiKey: string): Promise<ArrayBuffer> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media&key=${apiKey}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive download failed (${res.status}): ${body}`);
  }
  return res.arrayBuffer();
}

export async function ingestDriveFolder(
  propertyId: string,
  driveLink: string,
): Promise<number> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY env var is not set");

  const folderId = extractDriveFolderId(driveLink);
  if (!folderId) throw new Error(`Could not parse Drive folder ID from: ${driveLink}`);

  await log(propertyId, "intake", "info", `Ingesting Drive folder ${folderId}`);

  const files = await listDriveFolderImages(folderId, apiKey);
  if (files.length === 0) {
    throw new Error("No images found in Drive folder (is it shared 'Anyone with link'?)");
  }
  await log(propertyId, "intake", "info", `Found ${files.length} images in Drive`);

  const supabase = getSupabase();
  const records: Array<{ property_id: string; file_url: string; file_name: string }> = [];

  for (const f of files) {
    const buf = await downloadDriveFile(f.id, apiKey);
    const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${propertyId}/${f.id}_${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buf, {
        contentType: f.mimeType,
        upsert: true,
      });
    if (uploadErr) throw new Error(`Storage upload failed for ${f.name}: ${uploadErr.message}`);

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    records.push({
      property_id: propertyId,
      file_url: urlData.publicUrl,
      file_name: f.name,
    });
  }

  await insertPhotos(records);
  await supabase
    .from("properties")
    .update({ photo_count: records.length })
    .eq("id", propertyId);

  await log(propertyId, "intake", "info", `Ingested ${records.length} photos from Drive`);
  return records.length;
}
