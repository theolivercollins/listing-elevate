import { describe, it, expect } from "vitest";
import { getOrSetConversationCookie } from "./cookie";

const COOKIE_NAME = "mally_cid";

function mockReqRes(cookieHeader?: string) {
  const setHeaders: Record<string, string | string[]> = {};
  const req: any = { headers: cookieHeader ? { cookie: cookieHeader } : {} };
  const res: any = {
    setHeader: (k: string, v: string | string[]) => { setHeaders[k.toLowerCase()] = v; },
  };
  return { req, res, setHeaders };
}

describe("getOrSetConversationCookie", () => {
  it("returns existing valid uuid when cookie present", () => {
    const existing = "11111111-1111-4111-8111-111111111111";
    const { req, res, setHeaders } = mockReqRes(`other=foo; ${COOKIE_NAME}=${existing}; bar=baz`);
    const id = getOrSetConversationCookie(req, res);
    expect(id).toBe(existing);
    expect(setHeaders["set-cookie"]).toBeUndefined();
  });

  it("issues a new uuid + Set-Cookie header when no cookie present", () => {
    const { req, res, setHeaders } = mockReqRes();
    const id = getOrSetConversationCookie(req, res);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const setCookie = setHeaders["set-cookie"] as string;
    expect(setCookie).toContain(`${COOKIE_NAME}=${id}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=2592000"); // 30 days
  });

  it("issues a new uuid when cookie value is malformed", () => {
    const { req, res, setHeaders } = mockReqRes(`${COOKIE_NAME}=not-a-uuid`);
    const id = getOrSetConversationCookie(req, res);
    expect(id).not.toBe("not-a-uuid");
    expect(setHeaders["set-cookie"]).toBeDefined();
  });

  it("includes Secure when NODE_ENV=production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { req, res, setHeaders } = mockReqRes();
      getOrSetConversationCookie(req, res);
      expect((setHeaders["set-cookie"] as string)).toContain("Secure");
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
