/**
 * Google Drive v3 read-only client.
 *
 * No external dependencies: uses Node's built-in `crypto` and the global
 * `fetch`.
 *
 * Auth selection (first match wins):
 *  1. OAuth user refresh-token (preferred) — set all three:
 *       GOOGLE_DRIVE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET,
 *       GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN
 *     POST refresh_token grant to oauth2.googleapis.com/token.
 *  2. Service-account JWT-bearer (fallback) — set:
 *       GOOGLE_DRIVE_SA_JSON (base64-encoded SA JSON)
 *     Build RS256 JWT, exchange at oauth2.googleapis.com/token.
 *  3. Neither set → throws DriveUnconfiguredError.
 *
 * Either path caches the access token until 60 s before expiry.
 * All Drive v3 calls send Authorization: Bearer <token>.
 */

import crypto from "node:crypto";

// ── Error sentinel ─────────────────────────────────────────────────────────────

/**
 * Thrown when neither the OAuth refresh-token vars nor GOOGLE_DRIVE_SA_JSON are
 * set — mirrors MlsProviderUnconfiguredError.
 */
export class DriveUnconfiguredError extends Error {
  constructor() {
    super(
      "Google Drive not configured: set either " +
        "GOOGLE_DRIVE_OAUTH_CLIENT_ID + GOOGLE_DRIVE_OAUTH_CLIENT_SECRET + " +
        "GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN (preferred, OAuth user-token) " +
        "or GOOGLE_DRIVE_SA_JSON (base64-encoded service-account JSON key).",
    );
    this.name = "DriveUnconfiguredError";
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number; // Unix timestamp, ms
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** File size in bytes returned as a string by the Drive API. Present when the
   *  `size` field is included in the `fields` query parameter. */
  size?: string;
}

// ── Module-level token cache ───────────────────────────────────────────────────

let _tokenCache: TokenCache | null = null;

/** Reset token cache — used in tests to force re-exchange. */
export function _resetTokenCache(): void {
  _tokenCache = null;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function getServiceAccount(): ServiceAccountKey {
  const raw = process.env.GOOGLE_DRIVE_SA_JSON;
  if (!raw) throw new DriveUnconfiguredError();
  const json = Buffer.from(raw, "base64").toString("utf-8");
  return JSON.parse(json) as ServiceAccountKey;
}

function buildJwt(sa: ServiceAccountKey): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const iat = Math.floor(Date.now() / 1000);
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    }),
  );
  const signable = `${header}.${claims}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signable);
  const rawSig = sign.sign(sa.private_key, "base64");
  const signature = rawSig.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return `${signable}.${signature}`;
}

/** Fetch a fresh token via the OAuth refresh-token grant (preferred path). */
async function fetchOAuthToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[drive/client] OAuth token refresh failed ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<{ access_token: string; expires_in: number }>;
}

/** Fetch a fresh token via the SA JWT-bearer grant (fallback path). */
async function fetchSAToken(
  sa: ServiceAccountKey,
): Promise<{ access_token: string; expires_in: number }> {
  const jwt = buildJwt(sa);
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[drive/client] Token exchange failed ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // Return cached token if still valid (with 60 s buffer before expiry)
  if (_tokenCache && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.accessToken;
  }

  // Auth selection: OAuth refresh-token (preferred) → SA JWT-bearer → error
  const clientId = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN;

  let data: { access_token: string; expires_in: number };
  if (clientId && clientSecret && refreshToken) {
    data = await fetchOAuthToken(clientId, clientSecret, refreshToken);
  } else if (process.env.GOOGLE_DRIVE_SA_JSON) {
    data = await fetchSAToken(getServiceAccount());
  } else {
    throw new DriveUnconfiguredError();
  }

  _tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return _tokenCache.accessToken;
}

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

async function driveGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const token = await getAccessToken();
  const url = new URL(`${DRIVE_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[drive/client] GET ${path} failed ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * List all direct child folders under `parentId`.
 * Handles Drive pagination via nextPageToken.
 */
export async function listPropertyFolders(
  parentId: string,
): Promise<{ id: string; name: string }[]> {
  const results: { id: string; name: string }[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = {
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "nextPageToken,files(id,name)",
      // Required for files that live in a Shared Drive (e.g. Helgemo Team Drive).
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
    };
    if (pageToken) params.pageToken = pageToken;

    const data = (await driveGet("/files", params)) as {
      files?: Array<{ id: string; name: string }>;
      nextPageToken?: string;
    };
    results.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return results;
}

/**
 * Return the direct child folder of `propertyFolderId` whose name
 * case-insensitively equals "final", or null if absent.
 */
export async function findFinalSubfolder(
  propertyFolderId: string,
): Promise<{ id: string; name: string } | null> {
  const children = await listPropertyFolders(propertyFolderId);
  return children.find((f) => f.name.toLowerCase() === "final") ?? null;
}

/**
 * List all image files (mimeType contains 'image/') inside `finalFolderId`.
 * Paginated.
 */
export async function listFinalImages(
  finalFolderId: string,
): Promise<Array<{ id: string; name: string; mimeType: string; size?: string }>> {
  const results: Array<{ id: string; name: string; mimeType: string; size?: string }> = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = {
      q: `'${finalFolderId}' in parents and mimeType contains 'image/' and trashed=false`,
      // size included so callers can enforce per-file byte caps before downloading.
      fields: "nextPageToken,files(id,name,mimeType,size)",
      // Required for files that live in a Shared Drive (e.g. Helgemo Team Drive).
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      corpora: "allDrives",
    };
    if (pageToken) params.pageToken = pageToken;

    const data = (await driveGet("/files", params)) as {
      files?: Array<{ id: string; name: string; mimeType: string; size?: string }>;
      nextPageToken?: string;
    };
    results.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return results;
}

/** Count image files inside `finalFolderId`. */
export async function countFinalImages(finalFolderId: string): Promise<number> {
  const images = await listFinalImages(finalFolderId);
  return images.length;
}

/**
 * Download a file's bytes and fetch its metadata (name, mimeType).
 * Uses `?alt=media` for the binary content.
 */
export async function downloadFile(
  fileId: string,
): Promise<{ bytes: ArrayBuffer; name: string; mimeType: string }> {
  const token = await getAccessToken();

  // Fetch binary content.
  // supportsAllDrives=true is required for Shared Drive files.
  const mediaResp = await fetch(`${DRIVE_BASE}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!mediaResp.ok) {
    const text = await mediaResp.text();
    throw new Error(`[drive/client] Download ${fileId} failed ${mediaResp.status}: ${text}`);
  }
  const bytes = await mediaResp.arrayBuffer();

  // Fetch metadata separately.
  // supportsAllDrives=true is required for Shared Drive files.
  const meta = (await driveGet(`/files/${fileId}`, {
    fields: "id,name,mimeType",
    supportsAllDrives: "true",
  })) as { id: string; name: string; mimeType: string };

  return { bytes, name: meta.name, mimeType: meta.mimeType };
}
