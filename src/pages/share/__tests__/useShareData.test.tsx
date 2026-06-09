import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useShareData, type SharePayload } from '../useShareData';

const OK_PAYLOAD: SharePayload = {
  title: 'Test Listing',
  description: 'A lovely home',
  kind: 'video',
  allow_download: true,
  allow_embed: true,
  presentation_enabled: true,
  playbackUrl: 'https://example.com/video.mp4',
  embedUrl: null,
  posterUrl: 'https://example.com/poster.jpg',
  downloadUrl: 'https://example.com/download.mp4',
  width: 1920,
  height: 1080,
};

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('useShareData', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts in loading then resolves to ok with data on 200', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, OK_PAYLOAD));
    const { result } = renderHook(() => useShareData('tok123'));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ok'));
    expect(result.current.data).toEqual(OK_PAYLOAD);
  });

  it('resolves to password on 401 requiresPassword', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401, { requiresPassword: true }));
    const { result } = renderHook(() => useShareData('tok123'));
    await waitFor(() => expect(result.current.status).toBe('password'));
  });

  it('resolves to expired on 410', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(410, { error: 'expired' }));
    const { result } = renderHook(() => useShareData('tok123'));
    await waitFor(() => expect(result.current.status).toBe('expired'));
  });

  it('resolves to notfound on 404', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404, { error: 'not found' }));
    const { result } = renderHook(() => useShareData('tok123'));
    await waitFor(() => expect(result.current.status).toBe('notfound'));
  });

  it('resolves to embed_disabled on 403 when embed=true', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(403, { error: 'embed disabled' }));
    const { result } = renderHook(() =>
      useShareData('tok123', { embed: true }),
    );
    await waitFor(() => expect(result.current.status).toBe('embed_disabled'));

    // ?ctx=embed must be appended for the embed context.
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('ctx=embed'));
  });

  it('appends no ctx param by default', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, OK_PAYLOAD));
    renderHook(() => useShareData('tok123'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).not.toContain('ctx=embed');
  });

  it('reports notfound immediately when token is missing', async () => {
    const { result } = renderHook(() => useShareData(undefined));
    await waitFor(() => expect(result.current.status).toBe('notfound'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('submitPassword', () => {
    it('POSTs the password and transitions to ok on success', async () => {
      // initial GET → password gate
      fetchMock.mockResolvedValueOnce(mockResponse(401, { requiresPassword: true }));
      const { result } = renderHook(() => useShareData('tok123'));
      await waitFor(() => expect(result.current.status).toBe('password'));

      // retry POST → ok
      fetchMock.mockResolvedValueOnce(mockResponse(200, OK_PAYLOAD));
      await act(async () => {
        await result.current.submitPassword('hunter2');
      });

      expect(result.current.status).toBe('ok');
      expect(result.current.data).toEqual(OK_PAYLOAD);

      const postCall = fetchMock.mock.calls[1];
      expect(postCall[1]).toMatchObject({ method: 'POST' });
      expect(JSON.parse(postCall[1].body)).toEqual({ password: 'hunter2' });
    });

    it('stays on password gate with passwordError when password is wrong', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(401, { requiresPassword: true }));
      const { result } = renderHook(() => useShareData('tok123'));
      await waitFor(() => expect(result.current.status).toBe('password'));

      fetchMock.mockResolvedValueOnce(mockResponse(401, { requiresPassword: true }));
      await act(async () => {
        await result.current.submitPassword('wrong');
      });

      expect(result.current.status).toBe('password');
      expect(result.current.passwordError).toBe(true);
    });
  });
});
