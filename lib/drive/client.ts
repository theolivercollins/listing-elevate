/**
 * Google Drive v3 read-only client — service-account JWT-bearer auth.
 *
 * No external dependencies: uses Node's built-in `crypto` and the global
 * `fetch`. Configured via GOOGLE_DRIVE_SA_JSON (base64-encoded SA JSON).
 *
 * Auth flow:
 *  1. Decode + parse GOOGLE_DRIVE_SA_JSON → {client_email, private_key}
 *  2. Build RS256 JWT, exchange at oauth2.googleapis.com/token
 *  3. Cache the access token until 60 s before expiry
 *  4. All Drive v3 calls send Authorization: Bearer <token>
 */

import crypto from "node:crypto";

// ── Error sentinel ─────────────────────────────────────────────────────────────

/** Thrown when GOOGLE_DRIVE_SA_JSON is not set — mirrors MlsProviderUnconfiguredError. */
export class DriveUnconfiguredError extends Error {
  constructor() {
    super(
      "Google Drive not configured: GOOGLE_DRIVE_SA_JSON env var not set. " +
        "Set it to the base64-encoded service-account JSON key.",
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
}

export interface DriveChange {
  fileId: string;
  removed: boolean;
  file?: {
    id: string;
    name: string;
    mimeType: string;
    parents?: string[];
    trashed?: boolean;
  };
}

export interface ListChangesResult {
  changes: DriveChange[];
  newStartPageToken?: string;
  nextPageToken?: string;
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

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // Return cached token if still valid (with 60 s buffer before expiry)
  if (_tokenCache && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.accessToken;
  }

  const sa = getServiceAccount();
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

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  _tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return _tokenCache.accessToken;
}

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

/** Hard cap on binary downloads — prevents OOM in serverless from oversized Drive files. */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

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
): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const results: Array<{ id: string; name: string; mimeType: string }> = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = {
      q: `'${finalFolderId}' in parents and mimeType contains 'image/' and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType)",
    };
    if (pageToken) params.pageToken = pageToken;

    const data = (await driveGet("/files", params)) as {
      files?: Array<{ id: string; name: string; mimeType: string }>;
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

  // Fetch binary content
  const mediaResp = await fetch(
    `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!mediaResp.ok) {
    const text = await mediaResp.text();
    throw new Error(`[drive/client] Download ${fileId} failed ${mediaResp.status}: ${text}`);
  }
  // Guard against OOM: reject before reading the body if Content-Length exceeds the cap.
  // (Content-Length may be absent for chunked/media responses; absence is not an error.)
  const contentLength = mediaResp.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Drive file ${fileId} exceeds MAX_DOWNLOAD_BYTES (${MAX_DOWNLOAD_BYTES} bytes)`,
    );
  }
  const bytes = await mediaResp.arrayBuffer();

  // Fetch metadata separately
  const meta = (await driveGet(`/files/${encodeURIComponent(fileId)}`, {
    fields: "id,name,mimeType",
  })) as { id: string; name: string; mimeType: string };

  return { bytes, name: meta.name, mimeType: meta.mimeType };
}

// ── Change feed ────────────────────────────────────────────────────────────────

/** Fetch the current startPageToken for the change feed. */
export async function getStartPageToken(): Promise<string> {
  const data = (await driveGet("/changes/startPageToken")) as { startPageToken: string };
  return data.startPageToken;
}

/**
 * List changes since `pageToken`, accumulating all pages within one call.
 * Returns the accumulated changes plus newStartPageToken for the next poll.
 */
export async function listChanges(pageToken: string): Promise<ListChangesResult> {
  const allChanges: DriveChange[] = [];
  let currentToken: string | undefined = pageToken;
  let newStartPageToken: string | undefined;
  let lastNextPageToken: string | undefined;

  while (currentToken) {
    const data = (await driveGet("/changes", {
      pageToken: currentToken,
      fields:
        "newStartPageToken,nextPageToken,changes(fileId,removed,file(id,name,mimeType,parents,trashed))",
    })) as {
      newStartPageToken?: string;
      nextPageToken?: string;
      changes?: DriveChange[];
    };

    allChanges.push(...(data.changes ?? []));
    if (data.newStartPageToken) newStartPageToken = data.newStartPageToken;
    lastNextPageToken = data.nextPageToken;
    currentToken = data.nextPageToken;
  }

  return {
    changes: allChanges,
    newStartPageToken,
    nextPageToken: lastNextPageToken,
  };
}

/**
 * Subscribe to Drive push notifications via a webhook channel.
 * Returns the channelId + resourceId needed to stop the subscription later.
 */
export async function watchChanges(
  pageToken: string,
  webhookUrl: string,
  channelToken: string,
): Promise<{ channelId: string; resourceId: string; expiration: number }> {
  const token = await getAccessToken();
  const channelId = crypto.randomUUID();

  const url = new URL(`${DRIVE_BASE}/changes/watch`);
  url.searchParams.set("pageToken", pageToken);

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: channelId,
      type: "web_hook",
      address: webhookUrl,
      token: channelToken,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[drive/client] watchChanges failed ${resp.status}: ${text}`);
  }

  const data = (await resp.json()) as {
    id: string;
    resourceId: string;
    expiration: string; // Drive returns expiration as a string (ms since epoch)
  };

  return {
    channelId: data.id,
    resourceId: data.resourceId,
    expiration: Number(data.expiration),
  };
}

/**
 * Stop a Drive push-notification channel.
 * Drive returns 204 No Content on success.
 */
export async function stopChannel(channelId: string, resourceId: string): Promise<void> {
  const token = await getAccessToken();

  const resp = await fetch("https://www.googleapis.com/drive/v3/channels/stop", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: channelId, resourceId }),
  });

  if (!resp.ok && resp.status !== 204) {
    const text = await resp.text();
    throw new Error(`[drive/client] stopChannel failed ${resp.status}: ${text}`);
  }
}
