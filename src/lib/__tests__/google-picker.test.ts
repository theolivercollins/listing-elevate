import { describe, expect, it, vi } from 'vitest';
import { downloadDriveFile, expandFoldersToImages } from '../google-picker';

// ─── downloadDriveFile ────────────────────────────────────────────────────────

describe('downloadDriveFile', () => {
  it('builds a File from the response blob with correct name and type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['fake-image-data'], { type: 'image/jpeg' }),
    });

    const file = await downloadDriveFile(
      { id: 'file-abc', name: 'photo.jpg', mimeType: 'image/jpeg' },
      'access-token-123',
      mockFetch as unknown as typeof fetch,
    );

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('photo.jpg');
    expect(file.type).toBe('image/jpeg');
  });

  it('calls the Drive alt=media endpoint with Bearer token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['data']),
    });

    await downloadDriveFile(
      { id: 'file-xyz', name: 'img.png', mimeType: 'image/png' },
      'my-token',
      mockFetch as unknown as typeof fetch,
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/file-xyz?alt=media',
      { headers: { Authorization: 'Bearer my-token' } },
    );
  });

  it('throws a descriptive error on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });

    await expect(
      downloadDriveFile(
        { id: 'forbidden-id', name: 'secret.jpg', mimeType: 'image/jpeg' },
        'tok',
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow('403');
  });
});

// ─── expandFoldersToImages ────────────────────────────────────────────────────

describe('expandFoldersToImages', () => {
  it('lists folder children via the Drive Files API and returns them', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          { id: 'img-1', name: 'front.jpg', mimeType: 'image/jpeg' },
          { id: 'img-2', name: 'back.png', mimeType: 'image/png' },
        ],
      }),
    });

    const result = await expandFoldersToImages(
      [{ id: 'folder-1', name: 'Listing Photos', mimeType: 'application/vnd.google-apps.folder' }],
      'tok',
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'img-1', name: 'front.jpg', mimeType: 'image/jpeg' });
    expect(result[1]).toEqual({ id: 'img-2', name: 'back.png', mimeType: 'image/png' });

    // Verify the request targets the correct folder with Bearer auth.
    // Note: the query value is URL-encoded so 'image/' becomes 'image%2F'.
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('folder-1'),
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('image%2F');
  });

  it('passes through image items directly without making a fetch call', async () => {
    const mockFetch = vi.fn();

    const result = await expandFoldersToImages(
      [
        { id: 'img-a', name: 'photo.jpg', mimeType: 'image/jpeg' },
        { id: 'img-b', name: 'wide.webp', mimeType: 'image/webp' },
      ],
      'tok',
      mockFetch as unknown as typeof fetch,
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['img-a', 'img-b']);
  });

  it('filters out non-image, non-folder items from the picked list', async () => {
    const mockFetch = vi.fn();

    const result = await expandFoldersToImages(
      [
        { id: 'img-1', name: 'photo.jpg', mimeType: 'image/jpeg' },
        { id: 'pdf-1', name: 'brochure.pdf', mimeType: 'application/pdf' },
        { id: 'doc-1', name: 'notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { id: 'img-2', name: 'aerial.png', mimeType: 'image/png' },
      ],
      'tok',
      mockFetch as unknown as typeof fetch,
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['img-1', 'img-2']);
  });

  it('caps total results at 200 images and logs a warning', async () => {
    // Folder contains 250 images — only the first 200 should be returned.
    const twoFiftyFiles = Array.from({ length: 250 }, (_, i) => ({
      id: `img-${i}`,
      name: `photo${i}.jpg`,
      mimeType: 'image/jpeg',
    }));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: twoFiftyFiles }),
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await expandFoldersToImages(
      [{ id: 'folder-big', name: 'Big Folder', mimeType: 'application/vnd.google-apps.folder' }],
      'tok',
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toHaveLength(200);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Truncated'));

    warnSpy.mockRestore();
  });

  it('caps total across multiple picked items (not just within a single folder)', async () => {
    // 150 images from a folder + 100 direct images = 250 total, capped at 200.
    const folderImages = Array.from({ length: 150 }, (_, i) => ({
      id: `folder-img-${i}`,
      name: `f${i}.jpg`,
      mimeType: 'image/jpeg',
    }));
    const directImages = Array.from({ length: 100 }, (_, i) => ({
      id: `direct-img-${i}`,
      name: `d${i}.jpg`,
      mimeType: 'image/jpeg',
    }));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: folderImages }),
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await expandFoldersToImages(
      [
        { id: 'folder-1', name: 'Folder', mimeType: 'application/vnd.google-apps.folder' },
        ...directImages,
      ],
      'tok',
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toHaveLength(200);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Truncated'));

    warnSpy.mockRestore();
  });

  it('throws on a non-ok Drive API response when listing a folder', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(
      expandFoldersToImages(
        [{ id: 'folder-err', name: 'Bad Folder', mimeType: 'application/vnd.google-apps.folder' }],
        'tok',
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow('500');
  });
});
