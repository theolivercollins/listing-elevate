import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Public share payload returned by GET/POST /api/share/:token on success (200).
 * Mirrors the server-side SharePayload contract but is defined locally because
 * the frontend must not import server-side types (lib/operator-studio/*).
 */
export interface SharePayload {
  title: string;
  description: string | null;
  kind: 'video' | 'image';
  allow_download: boolean;
  allow_embed: boolean;
  presentation_enabled: boolean;
  playbackUrl: string;
  /** Bunny iframe player URL — when set, the viewer renders an iframe player. */
  embedUrl: string | null;
  posterUrl: string | null;
  downloadUrl: string | null;
  width: number | null;
  height: number | null;
}

export type ShareStatus =
  | 'loading'
  | 'ok'
  | 'password'
  | 'expired'
  | 'notfound'
  | 'embed_disabled'
  | 'error';

export interface UseShareData {
  status: ShareStatus;
  data?: SharePayload;
  /** Set when a submitted password was rejected, so the form can show an error. */
  passwordError?: boolean;
  submitPassword: (pw: string) => Promise<void>;
}

interface UseShareDataOpts {
  embed?: boolean;
}

/**
 * Maps a fetch Response to a state-machine status. Returns the parsed body when
 * the status is 'ok' so the caller can store the SharePayload.
 */
async function resolve(
  res: Response,
): Promise<{ status: ShareStatus; data?: SharePayload }> {
  if (res.status === 200) {
    const data = (await res.json()) as SharePayload;
    return { status: 'ok', data };
  }
  if (res.status === 401) return { status: 'password' };
  if (res.status === 410) return { status: 'expired' };
  if (res.status === 404) return { status: 'notfound' };
  if (res.status === 403) return { status: 'embed_disabled' };
  return { status: 'error' };
}

/**
 * useShareData — drives the public viewer pages. Fetches /api/share/:token and
 * exposes a small state machine. Pass { embed: true } to append ?ctx=embed so
 * the API enforces the allow_embed flag (403 → 'embed_disabled').
 *
 * Password retry is a POST to the same endpoint with a JSON { password } body.
 */
export function useShareData(
  token: string | undefined,
  opts: UseShareDataOpts = {},
): UseShareData {
  const embed = opts.embed === true;
  const [status, setStatus] = useState<ShareStatus>('loading');
  const [data, setData] = useState<SharePayload | undefined>(undefined);
  const [passwordError, setPasswordError] = useState(false);
  const activeRef = useRef(true);

  const endpoint = useCallback(() => {
    const base = `/api/share/${encodeURIComponent(token ?? '')}`;
    return embed ? `${base}?ctx=embed` : base;
  }, [token, embed]);

  useEffect(() => {
    activeRef.current = true;
    if (!token) {
      setStatus('notfound');
      return;
    }
    setStatus('loading');
    setData(undefined);
    setPasswordError(false);

    fetch(endpoint())
      .then((res) => resolve(res))
      .then(({ status: next, data: payload }) => {
        if (!activeRef.current) return;
        setStatus(next);
        if (payload) setData(payload);
      })
      .catch(() => {
        if (activeRef.current) setStatus('error');
      });

    return () => {
      activeRef.current = false;
    };
  }, [token, endpoint]);

  const submitPassword = useCallback(
    async (pw: string) => {
      if (!token) return;
      setPasswordError(false);
      try {
        const res = await fetch(endpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw }),
        });
        const { status: next, data: payload } = await resolve(res);
        if (!activeRef.current) return;
        if (next === 'password') {
          // Wrong password: stay on the gate but surface the error.
          setPasswordError(true);
          setStatus('password');
          return;
        }
        setStatus(next);
        if (payload) setData(payload);
      } catch {
        if (activeRef.current) setStatus('error');
      }
    },
    [token, endpoint],
  );

  return { status, data, passwordError, submitPassword };
}
