// Lazy Anthropic client for the market-update modules. Mirrors the lazy-getter
// pattern in api/blog/ai/chat.ts so an absent key can't crash a cold Vercel
// function at import time.
import Anthropic from "@anthropic-ai/sdk";

let _anthropic: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

export const MU_MODEL = "claude-sonnet-4-6";
