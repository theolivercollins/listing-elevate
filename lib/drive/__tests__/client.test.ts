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
});

// ─── 1. DriveUnconfiguredError ────────────────────────────────────────────────

describe("DriveUnconfiguredError", () => {
  it("is thrown from listPropertyFolders when GOOGLE_DRIVE_SA_JSON is absent", async () => {
    delete process.env.GOOGLE_DRIVE_SA_JSON;
    await expect(listPropertyFolders("some-parent")).rejects.toBeInstanceOf(DriveUnconfiguredError);
  });

  it("has the right name and message", () => {
    const err = new DriveUnconfiguredError();
    expect(err.name).toBe("DriveUnconfiguredError");
    expect(err.message).toContain("GOOGLE_DRIVE_SA_JSON");
  });
});

// ─── 2. Token exchange and caching ───────────────────────────────────────────

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

// ─── 3. listPropertyFolders ───────────────────────────────────────────────────

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

// ─── 4. findFinalSubfolder ────────────────────────────────────────────────────

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

// ─── 5. countFinalImages / listFinalImages ────────────────────────────────────

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

// ─── 6. downloadFile ──────────────────────────────────────────────────────────

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
