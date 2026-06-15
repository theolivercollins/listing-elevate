import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const COOKIE_NAME = "mally_cid";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns the visitor's anonymous conversation_id, issuing+setting a new
 * cookie if none is present or the existing value is malformed.
 */
export function getOrSetConversationCookie(req: VercelRequest, res: VercelResponse): string {
  const existing = parseCookie(req.headers?.cookie);
  if (existing && UUID_RE.test(existing)) return existing;

  const id = randomUUID();
  const parts = [
    `${COOKIE_NAME}=${id}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
  return id;
}

function parseCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const piece of header.split(";")) {
    const [k, v] = piece.trim().split("=");
    if (k === COOKIE_NAME) return v ?? null;
  }
  return null;
}
