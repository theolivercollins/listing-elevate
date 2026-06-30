/**
 * Tests for lib/drive/client.ts — Google Drive v3 read-only client.
 *
 * All network calls are mocked via vi.stubGlobal("fetch", ...).
 * The real RSA-SHA256 signing path runs — no crypto stubs needed —
 * because we generate a real RSA key pair in beforeAll() and embed its
 * private key in the fake service-account JSON.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  DriveUnconfiguredError,
  listPropertyFolders,
  findFinalSubfolder,
  countFinalImages,
  listFinalImages,
  downloadFile,
  _resetTokenCache,
} from "../client.js";

// ─── RSA key generated once for all tests ─────────────────────────────────────

let fakeSaJson: string;

beforeAll(() => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const sa = {
    type: "service_account",
    project_id: "test-project",
    client_email: "test-sa@test-project.iam.gserviceaccount.com",
    private_key: privateKey,
  };
  fakeSaJson = Buffer.from(JSON.stringify(sa)).toString("base64");
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

/** Build a fetch mock that returns a token exchange first, then Drive API responses in order. */
function buildFetchMock(driveResponses: unknown[]) {
  const queue = [...driveResponses];
  return vi.fn(async (url: string | URL) => {
    const urlStr = url.toString();
    if (urlStr.includes("oauth2.googleapis.com")) {
      // Token exchange
      return mockJsonResponse({ access_token: "test-access-token", expires_in: 3600 });
    }
    // Drive API — pop next response from queue
    const resp = queue.shift();
    if (resp === undefined) throw new Error("Unexpected extra fetch call to Drive API");
    return mockJsonResponse(resp);
  });
}

afterEach(() => {
  _resetTokenCache();
  vi.restoreAllMocks();
  delete process.env.GOOGLE_DRIVE_SA_JSON;
  delete process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;
  delete process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN;
});

// ─── 1. DriveUnconfiguredError ────────────────────────────────────────────────

describe("DriveUnconfiguredError", () => {
  it("is thrown from listPropertyFolders when no auth vars are set", async () => {
    // afterEach clears all auth env vars; ensure none slip in
    delete process.env.GOOGLE_DRIVE_SA_JSON;
    delete process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN;
    await expect(listPropertyFolders("some-parent")).rejects.toBeInstanceOf(DriveUnconfiguredError);
  });

  it("has the right name and message", () => {
    const err = new DriveUnconfiguredError();
    expect(err.name).toBe("DriveUnconfiguredError");
    expect(err.message).toContain("GOOGLE_DRIVE_SA_JSON");
  });
});

// ─── 2. Auth selection ────────────────────────────────────────────────────────

describe("auth selection", () => {
  it("uses OAuth refresh-token grant when all three OAuth vars are set", async () => {
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID = "oauth-client-id";
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET = "oauth-client-secret";
    process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN = "oauth-refresh-token";

    const capturedBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, opts?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          capturedBodies.push(opts?.body as string ?? "");
          return mockJsonResponse({ access_token: "oauth-tok", expires_in: 3600 });
        }
        return mockJsonResponse({ files: [] });
      }),
    );

    await listPropertyFolders("parent-1");

    expect(capturedBodies).toHaveLength(1);
    // Must be a refresh_token grant, not a JWT-bearer grant
    expect(capturedBodies[0]).toContain("grant_type=refresh_token");
    expect(capturedBodies[0]).toContain("refresh_token=oauth-refresh-token");
    expect(capturedBodies[0]).toContain("client_id=oauth-client-id");
    expect(capturedBodies[0]).toContain("client_secret=oauth-client-secret");
    // Must NOT be the SA JWT-bearer path
    expect(capturedBodies[0]).not.toContain("jwt-bearer");
  });

  it("uses SA JWT-bearer grant when only GOOGLE_DRIVE_SA_JSON is set", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    // No OAuth vars set

    const capturedBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, opts?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          capturedBodies.push(opts?.body as string ?? "");
          return mockJsonResponse({ access_token: "sa-tok", expires_in: 3600 });
        }
        return mockJsonResponse({ files: [] });
      }),
    );

    await listPropertyFolders("parent-1");

    expect(capturedBodies).toHaveLength(1);
    // The SA body is a raw template literal, not URLSearchParams — colons are not percent-encoded.
    expect(capturedBodies[0]).toContain("grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(capturedBodies[0]).toContain("assertion=");
    expect(capturedBodies[0]).not.toContain("refresh_token");
  });

  it("throws DriveUnconfiguredError when neither OAuth nor SA vars are present", async () => {
    // All auth env vars absent — afterEach guarantees this but be explicit
    delete process.env.GOOGLE_DRIVE_SA_JSON;
    delete process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN;

    await expect(listPropertyFolders("parent-1")).rejects.toBeInstanceOf(DriveUnconfiguredError);
  });

  it("falls back to SA when only partial OAuth vars are set (missing refresh token)", async () => {
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID = "oauth-client-id";
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET = "oauth-client-secret";
    // Intentionally NOT setting GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;

    const capturedBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, opts?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          capturedBodies.push(opts?.body as string ?? "");
          return mockJsonResponse({ access_token: "sa-tok", expires_in: 3600 });
        }
        return mockJsonResponse({ files: [] });
      }),
    );

    await listPropertyFolders("parent-1");

    // Should use the SA path, not the (incomplete) OAuth path
    expect(capturedBodies[0]).toContain("jwt-bearer");
  });

  it("OAuth wins over SA when both OAuth vars and GOOGLE_DRIVE_SA_JSON are set", async () => {
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID = "oauth-client-id";
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET = "oauth-client-secret";
    process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN = "oauth-refresh-token";
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson; // also present — should be ignored

    const capturedBodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, opts?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          capturedBodies.push(opts?.body as string ?? "");
          return mockJsonResponse({ access_token: "oauth-wins-tok", expires_in: 3600 });
        }
        return mockJsonResponse({ files: [] });
      }),
    );

    await listPropertyFolders("parent-oauth-wins");

    // Must use refresh_token grant (OAuth), NOT the SA JWT-bearer
    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0]).toContain("grant_type=refresh_token");
    expect(capturedBodies[0]).not.toContain("jwt-bearer");
  });

  it("propagates the OAuth-sourced access token as Bearer to Drive API calls", async () => {
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID = "oauth-client-id";
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET = "oauth-client-secret";
    process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN = "oauth-refresh-token";

    const capturedAuthHeaders: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, opts?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          return mockJsonResponse({ access_token: "oauth-bearer-check", expires_in: 3600 });
        }
        const headers = (opts?.headers ?? {}) as Record<string, string>;
        capturedAuthHeaders.push(headers["Authorization"] ?? "");
        return mockJsonResponse({ files: [] });
      }),
    );

    await listPropertyFolders("parent-bearer");

    expect(capturedAuthHeaders.length).toBeGreaterThan(0);
    expect(capturedAuthHeaders[0]).toBe("Bearer oauth-bearer-check");
  });

  it("throws DriveUnconfiguredError when only 1 of 3 OAuth vars is set and no SA", async () => {
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID = "oauth-client-id";
    // Missing clientSecret, refreshToken — no SA either

    await expect(listPropertyFolders("parent-partial-1")).rejects.toBeInstanceOf(
      DriveUnconfiguredError,
    );
  });

  it("throws with [drive/client] OAuth token refresh failed when OAuth endpoint returns an error", async () => {
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID = "oauth-client-id";
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET = "oauth-client-secret";
    process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN = "oauth-refresh-token";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          return {
            ok: false,
            status: 401,
            text: async () => "invalid_grant",
          };
        }
        return mockJsonResponse({ files: [] });
      }),
    );

    await expect(listPropertyFolders("parent-oauth-err")).rejects.toThrow(
      "[drive/client] OAuth token refresh failed 401",
    );
  });
});

// ─── 3. Token exchange and caching ───────────────────────────────────────────

describe("token exchange and caching", () => {
  it("exchanges a JWT for an access token on the first call", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    let tokenCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          tokenCallCount++;
          return mockJsonResponse({ access_token: "tok-first", expires_in: 3600 });
        }
        return mockJsonResponse({ files: [] });
      }),
    );

    await listPropertyFolders("parent-1");
    expect(tokenCallCount).toBe(1);
  });

  it("reuses the cached token on subsequent calls without re-exchanging", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    let tokenCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          tokenCallCount++;
          return mockJsonResponse({ access_token: "tok-cached", expires_in: 3600 });
        }
        return mockJsonResponse({ files: [] });
      }),
    );

    await listPropertyFolders("parent-1");
    await listPropertyFolders("parent-2");
    await listPropertyFolders("parent-3");

    // Token exchange must happen exactly once across all three calls
    expect(tokenCallCount).toBe(1);
  });

  it("re-exchanges after cache is reset (simulating expiry)", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    let tokenCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          tokenCallCount++;
          return mockJsonResponse({ access_token: "tok-renewed", expires_in: 3600 });
        }
        return mockJsonResponse({ files: [] });
      }),
    );

    await listPropertyFolders("parent-1");
    _resetTokenCache();
    await listPropertyFolders("parent-2");

    expect(tokenCallCount).toBe(2);
  });

  it("sends the access token as Bearer in Drive API calls", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    const capturedHeaders: Record<string, string>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, opts?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          return mockJsonResponse({ access_token: "tok-bearer-test", expires_in: 3600 });
        }
        const headers = (opts?.headers ?? {}) as Record<string, string>;
        capturedHeaders.push(headers);
        return mockJsonResponse({ files: [] });
      }),
    );

    await listPropertyFolders("parent-x");

    expect(capturedHeaders.length).toBeGreaterThan(0);
    expect(capturedHeaders[0]["Authorization"]).toBe("Bearer tok-bearer-test");
  });
});

// ─── 4. listPropertyFolders ───────────────────────────────────────────────────

describe("listPropertyFolders", () => {
  it("returns an array of {id, name} for all folders under parentId", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal(
      "fetch",
      buildFetchMock([
        {
          files: [
            { id: "f1", name: "123 Main St" },
            { id: "f2", name: "456 Oak Ave" },
          ],
        },
      ]),
    );

    const result = await listPropertyFolders("root-folder");
    expect(result).toEqual([
      { id: "f1", name: "123 Main St" },
      { id: "f2", name: "456 Oak Ave" },
    ]);
  });

  it("handles pagination by accumulating pages via nextPageToken", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal(
      "fetch",
      buildFetchMock([
        {
          files: [{ id: "f1", name: "Page 1 Folder" }],
          nextPageToken: "token-page-2",
        },
        {
          files: [{ id: "f2", name: "Page 2 Folder" }],
          // no nextPageToken → last page
        },
      ]),
    );

    const result = await listPropertyFolders("root-folder");
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Page 1 Folder");
    expect(result[1].name).toBe("Page 2 Folder");
  });

  it("returns empty array when no folders exist", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal("fetch", buildFetchMock([{ files: [] }]));

    const result = await listPropertyFolders("empty-parent");
    expect(result).toEqual([]);
  });

  it("includes the parentId in the query parameter", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    const capturedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          return mockJsonResponse({ access_token: "tok", expires_in: 3600 });
        }
        capturedUrls.push(urlStr);
        return mockJsonResponse({ files: [] });
      }),
    );

    await listPropertyFolders("specific-parent-id");
    expect(capturedUrls[0]).toContain("specific-parent-id");
  });
});

// ─── 5. findFinalSubfolder ────────────────────────────────────────────────────

describe("findFinalSubfolder", () => {
  it("returns the folder when a child folder named 'Final' exists (exact case)", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal(
      "fetch",
      buildFetchMock([
        {
          files: [
            { id: "sub1", name: "Editing" },
            { id: "sub2", name: "Final" },
            { id: "sub3", name: "RAW" },
          ],
        },
      ]),
    );

    const result = await findFinalSubfolder("property-folder-id");
    expect(result).toEqual({ id: "sub2", name: "Final" });
  });

  it("matches 'final' case-insensitively — lowercase", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal(
      "fetch",
      buildFetchMock([{ files: [{ id: "sub1", name: "final" }] }]),
    );

    const result = await findFinalSubfolder("property-folder-id");
    expect(result).toEqual({ id: "sub1", name: "final" });
  });

  it("matches 'FINAL' case-insensitively — uppercase", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal(
      "fetch",
      buildFetchMock([{ files: [{ id: "sub1", name: "FINAL" }] }]),
    );

    const result = await findFinalSubfolder("property-folder-id");
    expect(result).toEqual({ id: "sub1", name: "FINAL" });
  });

  it("returns null when no child folder named 'final' exists", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal(
      "fetch",
      buildFetchMock([
        {
          files: [
            { id: "sub1", name: "Editing" },
            { id: "sub2", name: "RAW" },
          ],
        },
      ]),
    );

    const result = await findFinalSubfolder("property-folder-id");
    expect(result).toBeNull();
  });

  it("returns null when the folder has no children", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal("fetch", buildFetchMock([{ files: [] }]));

    const result = await findFinalSubfolder("property-folder-id");
    expect(result).toBeNull();
  });
});

// ─── 6. countFinalImages / listFinalImages ────────────────────────────────────

describe("listFinalImages", () => {
  it("returns only files whose mimeType starts with image/", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal(
      "fetch",
      buildFetchMock([
        {
          files: [
            { id: "img1", name: "photo1.jpg", mimeType: "image/jpeg" },
            { id: "img2", name: "photo2.png", mimeType: "image/png" },
          ],
        },
      ]),
    );

    const images = await listFinalImages("final-folder-id");
    expect(images).toHaveLength(2);
    expect(images[0].mimeType).toBe("image/jpeg");
    expect(images[1].mimeType).toBe("image/png");
  });

  it("includes the size field when Drive returns it", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal(
      "fetch",
      buildFetchMock([
        {
          files: [
            { id: "img1", name: "photo1.jpg", mimeType: "image/jpeg", size: "1048576" },
            { id: "img2", name: "photo2.png", mimeType: "image/png" }, // no size (optional)
          ],
        },
      ]),
    );

    const images = await listFinalImages("final-folder-id");
    expect(images).toHaveLength(2);
    expect(images[0].size).toBe("1048576");
    expect(images[1].size).toBeUndefined();
  });

  it("requests the size field in the Drive API fields parameter", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    const capturedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }), text: async () => "" };
        }
        capturedUrls.push(urlStr);
        return { ok: true, status: 200, json: async () => ({ files: [] }), text: async () => "" };
      }),
    );

    await listFinalImages("some-folder-id");
    expect(capturedUrls[0]).toContain("size");
  });

  it("paginates across multiple pages of images", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal(
      "fetch",
      buildFetchMock([
        {
          files: [{ id: "img1", name: "a.jpg", mimeType: "image/jpeg" }],
          nextPageToken: "page-2-token",
        },
        {
          files: [{ id: "img2", name: "b.jpg", mimeType: "image/jpeg" }],
        },
      ]),
    );

    const images = await listFinalImages("final-folder-id");
    expect(images).toHaveLength(2);
  });
});

describe("countFinalImages", () => {
  it("returns the count of image files", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal(
      "fetch",
      buildFetchMock([
        {
          files: [
            { id: "img1", name: "a.jpg", mimeType: "image/jpeg" },
            { id: "img2", name: "b.png", mimeType: "image/png" },
            { id: "img3", name: "c.webp", mimeType: "image/webp" },
          ],
        },
      ]),
    );

    const count = await countFinalImages("final-folder-id");
    expect(count).toBe(3);
  });

  it("returns 0 when folder is empty", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    vi.stubGlobal("fetch", buildFetchMock([{ files: [] }]));

    const count = await countFinalImages("final-folder-id");
    expect(count).toBe(0);
  });
});

// ─── 7. downloadFile ──────────────────────────────────────────────────────────

describe("downloadFile", () => {
  it("returns bytes, name, and mimeType for a file", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    const fakeBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          return mockJsonResponse({ access_token: "tok", expires_in: 3600 });
        }
        if (urlStr.includes("alt=media")) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => fakeBytes,
          };
        }
        // Metadata fetch
        return mockJsonResponse({ id: "file-xyz", name: "front.jpg", mimeType: "image/jpeg" });
      }),
    );

    const result = await downloadFile("file-xyz");
    expect(result.name).toBe("front.jpg");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.bytes.byteLength).toBe(4);
  });
});

// ─── 8. Shared Drive params ───────────────────────────────────────────────────
//
// The feature's parent folder ("2026 Listing Photos") lives in a Shared Drive
// (driveId 0AKsR8IWPn6Q3Uk9PVA). Without these params Drive v3 returns empty
// results / 404 even when the service account has access.

describe("Shared Drive params", () => {
  it("listPropertyFolders request URL includes supportsAllDrives, includeItemsFromAllDrives, and corpora=allDrives", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    const capturedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          return mockJsonResponse({ access_token: "tok", expires_in: 3600 });
        }
        capturedUrls.push(urlStr);
        return mockJsonResponse({ files: [] });
      }),
    );

    await listPropertyFolders("shared-parent-id");

    expect(capturedUrls[0]).toContain("supportsAllDrives=true");
    expect(capturedUrls[0]).toContain("includeItemsFromAllDrives=true");
    expect(capturedUrls[0]).toContain("corpora=allDrives");
  });

  it("listFinalImages request URL includes supportsAllDrives, includeItemsFromAllDrives, and corpora=allDrives", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    const capturedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          return mockJsonResponse({ access_token: "tok", expires_in: 3600 });
        }
        capturedUrls.push(urlStr);
        return mockJsonResponse({ files: [] });
      }),
    );

    await listFinalImages("shared-final-folder-id");

    expect(capturedUrls[0]).toContain("supportsAllDrives=true");
    expect(capturedUrls[0]).toContain("includeItemsFromAllDrives=true");
    expect(capturedUrls[0]).toContain("corpora=allDrives");
  });

  it("downloadFile metadata GET (via driveGet) includes supportsAllDrives=true", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    const capturedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          return mockJsonResponse({ access_token: "tok", expires_in: 3600 });
        }
        capturedUrls.push(urlStr);
        if (urlStr.includes("alt=media")) {
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
        }
        return mockJsonResponse({ id: "file-meta", name: "photo.jpg", mimeType: "image/jpeg" });
      }),
    );

    await downloadFile("file-meta");

    const metaUrl = capturedUrls.find((u) => !u.includes("alt=media"));
    expect(metaUrl).toBeDefined();
    expect(metaUrl).toContain("supportsAllDrives=true");
  });

  it("downloadFile byte fetch (alt=media) includes supportsAllDrives=true", async () => {
    process.env.GOOGLE_DRIVE_SA_JSON = fakeSaJson;
    const capturedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("oauth2.googleapis.com")) {
          return mockJsonResponse({ access_token: "tok", expires_in: 3600 });
        }
        capturedUrls.push(urlStr);
        if (urlStr.includes("alt=media")) {
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
        }
        return mockJsonResponse({ id: "file-bytes", name: "photo.jpg", mimeType: "image/jpeg" });
      }),
    );

    await downloadFile("file-bytes");

    const mediaUrl = capturedUrls.find((u) => u.includes("alt=media"));
    expect(mediaUrl).toBeDefined();
    expect(mediaUrl).toContain("supportsAllDrives=true");
  });
});
