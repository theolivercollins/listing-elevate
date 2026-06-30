/**
 * Framework-agnostic helpers for Google Drive OAuth + Picker integration.
 *
 * Design goals:
 *  - Scripts injected lazily on first use; index.html untouched.
 *  - Pure-ish functions (accept fetchFn) so unit tests can mock without
 *    patching globals.
 *  - No React/component dependencies — usable from any context.
 */

// ─── Script loader ─────────────────────────────────────────────────────────────

const _scriptPromises = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  if (_scriptPromises.has(src)) return _scriptPromises.get(src)!;
  const p = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      // Script already injected by something else — wait for it if still loading,
      // or resolve immediately if already loaded.
      if (existing.dataset.loaded) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Script failed: ${src}`)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      s.dataset.loaded = '1';
      resolve();
    };
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
  _scriptPromises.set(src, p);
  return p;
}

const GIS_URL = 'https://accounts.google.com/gsi/client';
const GAPI_URL = 'https://apis.google.com/js/api.js';

// ─── OAuth access token ────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** In-memory cache for the current Drive access token. */
let _tokenCache: CachedToken | null = null;

/**
 * The GIS token client, built once and reused. Building a new client (and
 * calling requestAccessToken on it) on every call is what forced a fresh
 * OAuth popup/re-consent on every single click — see FIX 1.
 */
let _tokenClient: google.accounts.oauth2.TokenClient | null = null;

/**
 * GIS bakes the callback into the client at construction time, so the one
 * reused client's fixed callback delegates to whichever promise is currently
 * in flight via these refs.
 */
let _pendingResolve: ((token: string) => void) | null = null;
let _pendingReject: ((err: Error) => void) | null = null;

/**
 * Clears the cached Drive access token and the underlying GIS token client.
 * Call this on sign-out (so the next session never inherits a previous
 * user's grant) and from tests that need a clean slate between cases.
 */
export function _resetDriveToken(): void {
  _tokenCache = null;
  _tokenClient = null;
  _pendingResolve = null;
  _pendingReject = null;
}

function getOrCreateTokenClient(clientId: string): google.accounts.oauth2.TokenClient {
  if (_tokenClient) return _tokenClient;
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    // '' reuses an existing grant silently instead of re-prompting for
    // consent every time the (now-cached) token needs a refresh.
    prompt: '',
    callback: (response) => {
      const resolve = _pendingResolve;
      const reject = _pendingReject;
      _pendingResolve = null;
      _pendingReject = null;
      if (response.access_token) {
        const expiresInSec = Number(response.expires_in ?? 3600);
        _tokenCache = {
          token: response.access_token,
          expiresAt: Date.now() + expiresInSec * 1000,
        };
        resolve?.(response.access_token);
      } else {
        reject?.(new Error(`OAuth error: ${response.error ?? 'unknown'}`));
      }
    },
    error_callback: (err) => {
      const reject = _pendingReject;
      _pendingResolve = null;
      _pendingReject = null;
      // GIS SDK types only declare `message`, but at runtime the object
      // also exposes `type` (e.g. "popup_closed") which is more actionable.
      const gisErr = err as unknown as { type?: string; message?: string };
      reject?.(new Error(gisErr.type ?? gisErr.message ?? 'oauth_error'));
    },
  });
  return _tokenClient;
}

/**
 * Resolves with a Drive read-only access token.
 *
 * A cached token is returned immediately — no popup, no GIS round-trip — as
 * long as it's more than 60s from expiry. Otherwise this initiates a Google
 * OAuth2 implicit-grant flow via GIS, reusing a single module-level token
 * client (built once, lazily) configured with `prompt: ''` so the refresh
 * reuses the existing grant silently rather than re-prompting for consent.
 *
 * Rejects if the user closes the popup or an error occurs.
 */
export function requestDriveAccessToken({ clientId }: { clientId: string }): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) {
    return Promise.resolve(_tokenCache.token);
  }

  return loadScript(GIS_URL).then(
    () =>
      new Promise<string>((resolve, reject) => {
        _pendingResolve = resolve;
        _pendingReject = reject;
        const client = getOrCreateTokenClient(clientId);
        client.requestAccessToken();
      }),
  );
}

// ─── Google Picker ─────────────────────────────────────────────────────────────

export interface DrivePicked {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Opens the Google Picker UI.  Resolves with the array of selected docs
 * (files and/or folders) on PICKED, or an empty array on CANCEL.
 *
 * The picker is configured with:
 *   - DOCS view that shows images and folders
 *   - Folder select + folder display enabled
 *   - Multi-select enabled
 */
export function openPicker({
  accessToken,
  apiKey,
  appId,
}: {
  accessToken: string;
  apiKey: string;
  appId: string;
}): Promise<DrivePicked[]> {
  return loadScript(GAPI_URL).then(
    () =>
      new Promise<DrivePicked[]>((resolve) => {
        gapi.load('picker', () => {
          const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(true);

          const picker = new google.picker.PickerBuilder()
            .addView(view)
            .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
            .setOAuthToken(accessToken)
            .setDeveloperKey(apiKey)
            .setAppId(appId)
            .setCallback((data) => {
              if (data.action === google.picker.Action.PICKED) {
                resolve(
                  (data.docs ?? []).map((d) => ({
                    id: d.id,
                    name: d.name,
                    mimeType: d.mimeType,
                  })),
                );
              } else if (data.action === google.picker.Action.CANCEL) {
                resolve([]);
              }
              // LOADED action is ignored — we wait for PICKED or CANCEL.
            })
            .build();

          picker.setVisible(true);
        });
      }),
  );
}

// ─── Expand folders → flat image list ─────────────────────────────────────────

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const IMAGE_CAP = 300;

/**
 * Explicit MIME-type allowlist matching the manual/ZIP upload accept list.
 * SVG (stored-XSS vector) and unsupported formats (gif, bmp, tiff, …) are
 * excluded; they are dropped silently both from folder listings and from
 * directly-picked images.
 */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/webp',
]);

interface DriveFilesResponse {
  files?: Array<{ id: string; name: string; mimeType: string }>;
}

/**
 * Expands any folder items in `picked` into their child image files via the
 * Drive v3 Files API.  Non-image, non-folder items are dropped.
 *
 * Results are capped at 300 images (logged when truncated).
 *
 * @param fetchFn  Injected fetch — defaults to the global `fetch` so
 *                 callers can pass a mock for unit testing.
 */
export async function expandFoldersToImages(
  picked: DrivePicked[],
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<DrivePicked[]> {
  const results: DrivePicked[] = [];

  for (const item of picked) {
    if (results.length >= IMAGE_CAP) break;

    if (item.mimeType === 'application/vnd.google-apps.folder') {
      // List immediate children that are images (query broad; results filtered by allowlist below)
      const q = `'${item.id}' in parents and mimeType contains 'image/' and trashed = false`;
      const url = `${DRIVE_FILES_API}?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=1000`;
      const res = await fetchFn(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`Drive API error ${res.status} listing folder "${item.name}"`);
      }
      const data: DriveFilesResponse = await res.json();
      for (const f of data.files ?? []) {
        if (!ALLOWED_MIME_TYPES.has(f.mimeType)) continue; // drop gif/svg/bmp/tiff/…
        results.push({ id: f.id, name: f.name, mimeType: f.mimeType });
        if (results.length >= IMAGE_CAP) {
          console.warn(`[google-picker] Truncated to ${IMAGE_CAP} images — some files were not imported`);
          return results;
        }
      }
    } else if (ALLOWED_MIME_TYPES.has(item.mimeType)) {
      results.push(item);
      if (results.length >= IMAGE_CAP) {
        console.warn(`[google-picker] Truncated to ${IMAGE_CAP} images — some files were not imported`);
        return results;
      }
    }
    // Non-image, non-folder items are silently dropped per spec.
  }

  return results;
}

// ─── Download a Drive file ─────────────────────────────────────────────────────

/**
 * Downloads a Drive file by ID via the alt=media endpoint and returns it as a
 * browser `File` object, ready to be handed to any upload path.
 *
 * @param fetchFn  Injected fetch — defaults to the global `fetch` so
 *                 callers can pass a mock for unit testing.
 */
export async function downloadDriveFile(
  { id, name, mimeType }: DrivePicked,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<File> {
  const res = await fetchFn(`${DRIVE_FILES_API}/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Drive download error ${res.status} for file "${name}" (id: ${id})`);
  }
  const blob = await res.blob();
  return new File([blob], name, { type: mimeType });
}
