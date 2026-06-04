/**
 * extract-photos.ts
 *
 * Pure, framework-agnostic helper for bulk photo ingestion.
 *
 * Given a .zip file OR a File[]/FileList from a folder/multi-select input,
 * returns a sorted File[] of the image entries only — ready to be fed into
 * uploadPhotosToStorage() one batch at a time.
 *
 * NOTE: Multi-listing-per-folder splitting (one subfolder = one listing) is a
 * deliberate follow-up.  For now all images are collected flat regardless of
 * directory structure.
 */

import JSZip from "jszip";

/** All image extensions accepted by the Operator Studio pipeline. */
export const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "heic",
  "webp",
]);

function hasImageExtension(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

function isSkippable(entryPath: string): boolean {
  const basename = entryPath.split("/").pop() ?? entryPath;
  // Skip dotfiles (.DS_Store, .hidden.jpg, etc.)
  if (basename.startsWith(".")) return true;
  // Skip macOS metadata sidebar (__MACOSX/...)
  if (entryPath.startsWith("__MACOSX/") || entryPath.includes("/__MACOSX/")) return true;
  return false;
}

/**
 * Extract image File objects from a zip archive.
 * Entries are sorted by their in-archive path for stable ordering.
 */
async function extractFromZip(zipFile: File): Promise<File[]> {
  const zip = await JSZip.loadAsync(zipFile);

  // Collect matching entries sorted by path
  const entries: { path: string; entry: JSZip.JSZipObject }[] = [];
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    if (isSkippable(relativePath)) return;
    const basename = relativePath.split("/").pop() ?? relativePath;
    if (!hasImageExtension(basename)) return;
    entries.push({ path: relativePath, entry });
  });

  entries.sort((a, b) => a.path.localeCompare(b.path));

  const files = await Promise.all(
    entries.map(async ({ path, entry }) => {
      const blob = await entry.async("blob");
      const basename = path.split("/").pop() ?? path;
      const ext = basename.split(".").pop()?.toLowerCase() ?? "";
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        heic: "image/heic",
        webp: "image/webp",
      };
      return new File([blob], basename, { type: mimeMap[ext] ?? "image/jpeg" });
    }),
  );

  return files;
}

/**
 * Filter and sort a File array / FileList to image files only.
 * Sorted by filename for stable ordering.
 */
function filterFiles(input: File[] | FileList): File[] {
  return Array.from(input)
    .filter((f) => hasImageExtension(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract image File objects from:
 * - A single .zip File  → unzip and return sorted image entries
 * - A File[] / FileList → filter to images and sort by name
 *
 * Returns a Promise<File[]> in both cases.
 */
export async function extractImageFiles(
  input: File | File[] | FileList,
): Promise<File[]> {
  if (input instanceof File) {
    // Single file — treat as zip if name ends with .zip or MIME is zip-like
    const isZip =
      /\.zip$/i.test(input.name) ||
      input.type === "application/zip" ||
      input.type === "application/x-zip-compressed";
    if (isZip) {
      return extractFromZip(input);
    }
    // Fallback: single image file
    return hasImageExtension(input.name) ? [input] : [];
  }

  // File[] or FileList
  return filterFiles(input);
}
