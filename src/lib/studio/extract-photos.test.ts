import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractImageFiles } from "./extract-photos";

/** Build a minimal in-memory zip File for testing. */
async function makeZip(
  entries: Record<string, string | null>,
): Promise<File> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    if (content === null) {
      // directory entry — JSZip creates it as a folder
      zip.folder(name);
    } else {
      zip.file(name, content);
    }
  }
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], "photos.zip", { type: "application/zip" });
}

describe("extractImageFiles", () => {
  describe("zip input", () => {
    it("returns only image files from a zip, sorted by path", async () => {
      const zipFile = await makeZip({
        "a.jpg": "fake-jpg-data",
        "b.png": "fake-png-data",
        "notes.txt": "some notes",
        "__MACOSX/x.jpg": "macos-metadata",
        ".DS_Store": "ds-store-data",
      });

      const result = await extractImageFiles(zipFile);

      expect(result).toHaveLength(2);
      expect(result.map((f) => f.name)).toEqual(["a.jpg", "b.png"]);
      expect(result[0]).toBeInstanceOf(File);
      expect(result[1]).toBeInstanceOf(File);
    });

    it("handles heic and webp extensions", async () => {
      const zipFile = await makeZip({
        "living.heic": "fake-heic",
        "exterior.webp": "fake-webp",
        "readme.md": "ignored",
      });

      const result = await extractImageFiles(zipFile);

      expect(result.map((f) => f.name)).toEqual(["exterior.webp", "living.heic"]);
    });

    it("skips dotfiles and __MACOSX entries", async () => {
      const zipFile = await makeZip({
        ".hidden.jpg": "dotfile-image",
        "__MACOSX/._kitchen.jpg": "metadata",
        "kitchen.jpg": "real-image",
      });

      const result = await extractImageFiles(zipFile);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("kitchen.jpg");
    });

    it("returns an empty array when zip has no image files", async () => {
      const zipFile = await makeZip({
        "readme.txt": "just text",
        "data.json": "{}",
      });

      const result = await extractImageFiles(zipFile);

      expect(result).toHaveLength(0);
    });

    it("returns images sorted by entry path", async () => {
      const zipFile = await makeZip({
        "z_last.jpg": "z",
        "a_first.jpg": "a",
        "m_middle.png": "m",
      });

      const result = await extractImageFiles(zipFile);

      expect(result.map((f) => f.name)).toEqual([
        "a_first.jpg",
        "m_middle.png",
        "z_last.jpg",
      ]);
    });
  });

  describe("File[] / FileList input", () => {
    it("filters a mixed array to only image files, sorted by name", async () => {
      const files: File[] = [
        new File(["data"], "z_photo.jpeg", { type: "image/jpeg" }),
        new File(["data"], "notes.txt", { type: "text/plain" }),
        new File(["data"], "a_photo.png", { type: "image/png" }),
      ];

      const result = await extractImageFiles(files);

      expect(result.map((f) => f.name)).toEqual(["a_photo.png", "z_photo.jpeg"]);
    });

    it("accepts all supported image types", async () => {
      const files: File[] = [
        new File(["d"], "a.jpg", { type: "image/jpeg" }),
        new File(["d"], "b.jpeg", { type: "image/jpeg" }),
        new File(["d"], "c.png", { type: "image/png" }),
        new File(["d"], "d.heic", { type: "image/heic" }),
        new File(["d"], "e.webp", { type: "image/webp" }),
      ];

      const result = await extractImageFiles(files);

      expect(result).toHaveLength(5);
    });

    it("returns empty array when no images in list", async () => {
      const files: File[] = [
        new File(["data"], "doc.pdf", { type: "application/pdf" }),
      ];

      const result = await extractImageFiles(files);

      expect(result).toHaveLength(0);
    });
  });
});
