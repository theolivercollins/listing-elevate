import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetDriveToken,
  downloadDriveFile,
  DRIVE_AUTH_CANCELLED,
  expandFoldersToImages,
  requestDriveAccessToken,
} from '../google-picker';

// ─── requestDriveAccessToken (token caching — FIX 1) ──────────────────────────
//
// loadScript() injects a real <script src="..."> tag. happy-dom treats that
// as a real network load attempt ("JavaScript file loading is disabled")
// and fires `error` synchronously on connection — before a test ever gets a
// chance to simulate `load`. So instead of letting the script actually
// connect to the document, we stub document.head.appendChild to capture the
// element without connecting it, then invoke its `onload` handler directly
// (a plain function call — no real DOM event dispatch involved).

describe('requestDriveAccessToken', () => {
  let initTokenClientMock: ReturnType<typeof vi.fn>;
  let requestAccessTokenMock: ReturnType<typeof vi.fn>;
  let capturedConfig: google.accounts.oauth2.TokenClientConfig | null;
  let appendChildSpy: ReturnType<typeof vi.spyOn>;
  let pendingScriptOnload: (() => void) | null;

  /** Resolves loadScript()'s pending GIS <script> tag, if one is in flight. */
  function flushGisScriptLoad() {
    pendingScriptOnload?.();
    pendingScriptOnload = null;
  }

  beforeEach(() => {
    _resetDriveToken();
    capturedConfig = null;
    pendingScriptOnload = null;
    requestAccessTokenMock = vi.fn();
    initTokenClientMock = vi.fn((config: google.accounts.oauth2.TokenClientConfig) => {
      capturedConfig = config;
      return { requestAccessToken: requestAccessTokenMock };
    });
    (globalThis as unknown as { google: unknown }).google = {
      accounts: { oauth2: { initTokenClient: initTokenClientMock } },
    };
    appendChildSpy = vi
      .spyOn(document.head, 'appendChild')
      .mockImplementation((node: unknown) => {
        const el = node as { onload?: (() => void) | null };
        if (typeof el.onload === 'function') pendingScriptOnload = el.onload;
        return node as Node;
      });
  });

  afterEach(() => {
    delete (globalThis as { google?: unknown }).google;
    appendChildSpy.mockRestore();
  });

  it('requests a fresh token via GIS, configured with prompt: "" for silent reuse', async () => {
    requestAccessTokenMock.mockImplementation(() => {
      capturedConfig!.callback({ access_token: 'tok-1', expires_in: '3600' });
    });

    const promise = requestDriveAccessToken({ clientId: 'client-1' });
    flushGisScriptLoad();
    const token = await promise;

    expect(token).toBe('tok-1');
    expect(initTokenClientMock).toHaveBeenCalledTimes(1);
    expect(initTokenClientMock.mock.calls[0][0]).toMatchObject({
      client_id: 'client-1',
      prompt: '',
    });
    expect(requestAccessTokenMock).toHaveBeenCalledTimes(1);
  });

  it('returns the cached token on a second call within expiry, without calling initTokenClient again', async () => {
    requestAccessTokenMock.mockImplementation(() => {
      capturedConfig!.callback({ access_token: 'tok-1', expires_in: '3600' });
    });

    const p1 = requestDriveAccessToken({ clientId: 'client-1' });
    flushGisScriptLoad();
    await p1;

    initTokenClientMock.mockClear();
    requestAccessTokenMock.mockClear();

    const token2 = await requestDriveAccessToken({ clientId: 'client-1' });

    expect(token2).toBe('tok-1');
    expect(initTokenClientMock).not.toHaveBeenCalled();
    expect(requestAccessTokenMock).not.toHaveBeenCalled();
  });

  it('requests a fresh token once the cached one is within 60s of expiring', async () => {
    requestAccessTokenMock.mockImplementation(() => {
      capturedConfig!.callback({ access_token: 'tok-1', expires_in: '100' });
    });
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    const p1 = requestDriveAccessToken({ clientId: 'client-1' });
    flushGisScriptLoad();
    await p1; // expiresAt = 1_000_000 + 100_000 = 1_100_000

    initTokenClientMock.mockClear();
    requestAccessTokenMock.mockClear();
    requestAccessTokenMock.mockImplementation(() => {
      capturedConfig!.callback({ access_token: 'tok-2', expires_in: '100' });
    });

    // 1_045_000 is within the 60s safety margin of the 1_100_000 expiry.
    nowSpy.mockReturnValue(1_045_000);

    const p2 = requestDriveAccessToken({ clientId: 'client-1' });
    flushGisScriptLoad();
    const token2 = await p2;

    expect(token2).toBe('tok-2');
    // The token refreshes, but the module-level token client itself is
    // reused — initTokenClient must NOT be called a second time.
    expect(initTokenClientMock).not.toHaveBeenCalled();
    expect(requestAccessTokenMock).toHaveBeenCalledTimes(1);

    nowSpy.mockRestore();
  });

  it('_resetDriveToken clears the cache, forcing a fresh OAuth request on the next call', async () => {
    requestAccessTokenMock.mockImplementation(() => {
      capturedConfig!.callback({ access_token: 'tok-1', expires_in: '3600' });
    });

    const p1 = requestDriveAccessToken({ clientId: 'client-1' });
    flushGisScriptLoad();
    await p1;

    _resetDriveToken();
    initTokenClientMock.mockClear();
    requestAccessTokenMock.mockClear();
    requestAccessTokenMock.mockImplementation(() => {
      capturedConfig!.callback({ access_token: 'tok-2', expires_in: '3600' });
    });

    const p2 = requestDriveAccessToken({ clientId: 'client-1' });
    flushGisScriptLoad();
    const token2 = await p2;

    expect(token2).toBe('tok-2');
    expect(initTokenClientMock).toHaveBeenCalledTimes(1);
  });

  // ── Cancel vs. genuine error (strict type-match) ─────────────────────────────
  //
  // A closed popup is normal, expected operator behavior — never a failure —
  // so it must RESOLVE to the DRIVE_AUTH_CANCELLED sentinel, not reject. Only
  // an exact match against CANCEL_ERROR_TYPES counts; anything else still
  // rejects so a genuine OAuth error (bad client id, redirect mismatch, etc.)
  // keeps surfacing to the operator.

  it.each(['popup_closed', 'popup_closed_by_user', 'access_denied'])(
    'resolves to DRIVE_AUTH_CANCELLED (never rejects) when the GIS error type is "%s"',
    async (cancelType) => {
      requestAccessTokenMock.mockImplementation(() => {
        const config = capturedConfig!;
        (
          config as unknown as { error_callback: (err: { type: string }) => void }
        ).error_callback?.({ type: cancelType });
      });

      const promise = requestDriveAccessToken({ clientId: 'client-1' });
      flushGisScriptLoad();

      await expect(promise).resolves.toBe(DRIVE_AUTH_CANCELLED);
    },
  );

  it('still rejects for a genuine (non-cancel) GIS error type', async () => {
    requestAccessTokenMock.mockImplementation(() => {
      const config = capturedConfig!;
      (config as unknown as { error_callback: (err: { type: string }) => void }).error_callback?.({
        type: 'popup_failed_to_open',
      });
    });

    const promise = requestDriveAccessToken({ clientId: 'client-1' });
    flushGisScriptLoad();

    await expect(promise).rejects.toThrow('popup_failed_to_open');
  });
});

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

  it('caps total results at 300 images and logs a warning', async () => {
    // Folder contains 350 images — only the first 300 should be returned.
    const manyFiles = Array.from({ length: 350 }, (_, i) => ({
      id: `img-${i}`,
      name: `photo${i}.jpg`,
      mimeType: 'image/jpeg',
    }));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: manyFiles }),
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await expandFoldersToImages(
      [{ id: 'folder-big', name: 'Big Folder', mimeType: 'application/vnd.google-apps.folder' }],
      'tok',
      mockFetch as unknown as typeof fetch,
    );

    expect(result).toHaveLength(300);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Truncated'));

    warnSpy.mockRestore();
  });

  it('caps total across multiple picked items (not just within a single folder)', async () => {
    // 200 images from a folder + 150 direct images = 350 total, capped at 300.
    const folderImages = Array.from({ length: 200 }, (_, i) => ({
      id: `folder-img-${i}`,
      name: `f${i}.jpg`,
      mimeType: 'image/jpeg',
    }));
    const directImages = Array.from({ length: 150 }, (_, i) => ({
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

    expect(result).toHaveLength(300);
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

  // ── MIME allowlist — direct picks ─────────────────────────────────────────────

  it('drops gif and svg from direct picks (allowlist enforcement)', async () => {
    const mockFetch = vi.fn();

    const result = await expandFoldersToImages(
      [
        { id: 'img-1', name: 'photo.jpg', mimeType: 'image/jpeg' },
        { id: 'gif-1', name: 'anim.gif', mimeType: 'image/gif' },
        { id: 'svg-1', name: 'icon.svg', mimeType: 'image/svg+xml' },
        { id: 'img-2', name: 'photo.png', mimeType: 'image/png' },
        { id: 'bmp-1', name: 'scan.bmp', mimeType: 'image/bmp' },
        { id: 'img-3', name: 'photo.webp', mimeType: 'image/webp' },
        { id: 'img-4', name: 'photo.heic', mimeType: 'image/heic' },
      ],
      'tok',
      mockFetch as unknown as typeof fetch,
    );

    expect(mockFetch).not.toHaveBeenCalled();
    // Only jpeg, png, webp, heic pass; gif, svg, bmp are dropped.
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.id)).toEqual(['img-1', 'img-2', 'img-3', 'img-4']);
  });

  // ── MIME allowlist — folder listing results ───────────────────────────────────

  it('drops gif and bmp from folder listing results (allowlist enforcement)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          { id: 'img-1', name: 'front.jpg', mimeType: 'image/jpeg' },
          { id: 'gif-1', name: 'anim.gif', mimeType: 'image/gif' },
          { id: 'bmp-1', name: 'scan.bmp', mimeType: 'image/bmp' },
          { id: 'svg-1', name: 'icon.svg', mimeType: 'image/svg+xml' },
          { id: 'img-2', name: 'back.webp', mimeType: 'image/webp' },
        ],
      }),
    });

    const result = await expandFoldersToImages(
      [{ id: 'folder-1', name: 'Listing Photos', mimeType: 'application/vnd.google-apps.folder' }],
      'tok',
      mockFetch as unknown as typeof fetch,
    );

    // Only jpeg and webp survive; gif, bmp, svg are excluded by the allowlist.
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['img-1', 'img-2']);
  });

  // ── trashed = false in folder query ──────────────────────────────────────────

  it('includes trashed = false in the folder listing query', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: [] }),
    });

    await expandFoldersToImages(
      [{ id: 'folder-1', name: 'Photos', mimeType: 'application/vnd.google-apps.folder' }],
      'tok',
      mockFetch as unknown as typeof fetch,
    );

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    // The query must exclude trashed items.
    expect(calledUrl).toContain('trashed');
    expect(calledUrl).toContain('false');
  });
});
