import { createHash } from "node:crypto";
import type { VercelRequest } from "@vercel/node";

/**
 * Returns sha256(ip + IP_HASH_SALT) as 64-char hex.
 * Accepts a raw IP string OR a VercelRequest (in which case it pulls from
 * x-forwarded-for first, falling back to req.socket.remoteAddress).
 * Never returns the raw IP - this is the only value we persist.
 */
export function hashIp(input: string | VercelRequest): string {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) throw new Error("IP_HASH_SALT env var is required");

  let ip: string;
  if (typeof input === "string") {
    ip = input;
  } else {
    const xff = input.headers?.["x-forwarded-for"];
    const xffStr = Array.isArray(xff) ? xff[0] : xff;
    ip = xffStr?.split(",")[0]?.trim()
      || input.socket?.remoteAddress
      || "unknown";
  }

  return createHash("sha256").update(ip + salt).digest("hex");
}
