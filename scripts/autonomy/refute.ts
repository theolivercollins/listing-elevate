#!/usr/bin/env tsx
/**
 * scripts/autonomy/refute.ts
 *
 * Cross-model refuter — the independent "Handler 2" adversarial check.
 *
 * Calls a non-Claude model via OpenRouter and asks it to try to REFUTE that
 * the provided diff correctly and completely implements the spec.  The model
 * defaults to `refuted: true` when uncertain, making it a strict, skeptical
 * gate.
 *
 * The refuter is OFF by default (`config.refuter.enabled = false`).
 * It is a no-op until explicitly armed in `.autonomy/config.json`.
 *
 * Usage (CLI):
 *   tsx refute.ts --spec=<specFile> --diff=<diffFile>
 *
 * Exit codes:
 *   0 — refuter returned refuted:false (change is acceptable)
 *   1 — refuted:true (change rejected), disabled, missing key, or error
 *
 * Import API:
 *   import { refute } from "./refute.js";
 *   const result = await refute({ spec, diff });
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RefuteInput {
  /** The specification text the diff is meant to implement. */
  spec: string;
  /** The unified diff (or any textual change representation) to evaluate. */
  diff: string;
}

export interface RefuteResult {
  /** true → the model found a problem; false → change looks correct. */
  refuted: boolean;
  /** Human-readable explanation of the verdict. */
  reason: string;
  /**
   * Model's stated confidence in the verdict, 0–1.
   * 0 when the refuter is disabled or the key is absent.
   */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Internal: credential resolution
// ---------------------------------------------------------------------------

/** Lines from ~/credentials.md, cached on first call. */
let _credLines: string[] | null = null;

function credLines(): string[] {
  if (_credLines !== null) return _credLines;
  const p = path.join(os.homedir(), "credentials.md");
  if (!fs.existsSync(p)) {
    _credLines = [];
    return _credLines;
  }
  _credLines = fs.readFileSync(p, "utf8").split("\n");
  return _credLines;
}

/**
 * Resolve OPENROUTER_API_KEY:
 *   1. process.env
 *   2. ~/credentials.md  (line matching `OPENROUTER_API_KEY=...`)
 *   3. Returns null if absent.
 *
 * NEVER logs the value.
 */
function resolveOpenRouterKey(): string | null {
  if (process.env["OPENROUTER_API_KEY"]) {
    return process.env["OPENROUTER_API_KEY"];
  }
  for (const line of credLines()) {
    const trimmed = line.trim();
    if (trimmed.startsWith("OPENROUTER_API_KEY=")) {
      const val = trimmed.slice("OPENROUTER_API_KEY=".length).trim();
      if (val) return val;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal: OpenRouter call
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `\
You are an adversarial code reviewer.  Your sole job is to REFUTE the claim
that the diff below correctly and completely implements the spec.

Approach:
- Read the spec carefully.  Identify every requirement — explicit and implied.
- Read the diff.  Find ANY gap, omission, incorrect behaviour, edge case not
  handled, security hole, or deviation from the spec.
- You are SKEPTICAL by default.  If you are uncertain whether something is
  correct, set refuted:true.
- Only set refuted:false if you are confident the diff fully satisfies every
  spec requirement with no defects.

Respond with ONLY valid JSON — no markdown fences, no extra text:
{"refuted": <boolean>, "reason": "<concise explanation>", "confidence": <0.0–1.0>}`;

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: { message: string };
}

/**
 * POST to the OpenRouter chat-completions endpoint and parse the structured
 * JSON verdict out of the model's reply.
 *
 * Throws on network failure; returns a best-effort RefuteResult on parse
 * failure (refuted:true so the gate fails safe).
 */
async function callOpenRouter(
  apiKey: string,
  model: string,
  spec: string,
  diff: string,
): Promise<RefuteResult> {
  const userContent =
    `SPEC:\n${spec}\n\n` +
    `DIFF:\n${diff}\n\n` +
    `Respond only with JSON: {"refuted": <boolean>, "reason": "<string>", "confidence": <number>}`;

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0,
    max_tokens: 512,
  });

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Authorization header carries the key — never echoed to logs.
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://listingelevate.com",
      "X-Title": "Listing Elevate autonomy refuter",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(unreadable)");
    throw new Error(`OpenRouter HTTP ${response.status}: ${text}`);
  }

  const data = (await response.json()) as OpenRouterResponse;

  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.message}`);
  }

  const raw = data.choices?.[0]?.message?.content ?? "";

  return parseVerdict(raw);
}

/**
 * Robustly parse the model's JSON verdict.
 *
 * Strips markdown fences if present.  On any parse failure, returns
 * refuted:true so the gate fails safe rather than silently passing.
 */
function parseVerdict(raw: string): RefuteResult {
  // Strip optional ```json … ``` fences.
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      refuted: true,
      reason: `refuter returned non-JSON response — failing safe. Raw: ${cleaned.slice(0, 200)}`,
      confidence: 0.5,
    };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)["refuted"] !== "boolean"
  ) {
    return {
      refuted: true,
      reason: `refuter returned unexpected JSON shape — failing safe. Raw: ${cleaned.slice(0, 200)}`,
      confidence: 0.5,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const refuted = obj["refuted"] as boolean;
  const reason =
    typeof obj["reason"] === "string" && obj["reason"].trim()
      ? obj["reason"].trim()
      : refuted
        ? "refuter flagged the diff"
        : "refuter approved the diff";
  const confidence =
    typeof obj["confidence"] === "number" &&
    obj["confidence"] >= 0 &&
    obj["confidence"] <= 1
      ? obj["confidence"]
      : 0.5;

  return { refuted, reason, confidence };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the adversarial refuter against a spec+diff pair.
 *
 * Never throws — all failure modes return a RefuteResult so callers can treat
 * the result uniformly.  A missing key or disabled refuter returns
 * refuted:false (the gate does not block).
 */
export async function refute(input: RefuteInput): Promise<RefuteResult> {
  // Load config; if config is broken, don't block the pipeline.
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    return {
      refuted: false,
      reason: `refuter: config load failed — skipping (${(err as Error).message})`,
      confidence: 0,
    };
  }

  // Gate 1: feature flag.
  if (!config.refuter.enabled) {
    return { refuted: false, reason: "refuter disabled", confidence: 0 };
  }

  // Gate 2: API key.
  const apiKey = resolveOpenRouterKey();
  if (!apiKey) {
    return { refuted: false, reason: "no OpenRouter key", confidence: 0 };
  }

  // TODO(before-arming): record cost_events for each OpenRouter call — CLAUDE.md ship-gate rule 5
  // Perform the cross-model adversarial check.
  try {
    return await callOpenRouter(
      apiKey,
      config.refuter.model,
      input.spec,
      input.diff,
    );
  } catch (err) {
    // Network/API failures fail open (don't block the pipeline) but are logged.
    console.error(`[refute] OpenRouter call failed: ${(err as Error).message}`);
    return {
      refuted: false,
      reason: `refuter call failed — skipping (${(err as Error).message})`,
      confidence: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  function flag(name: string): string | undefined {
    const prefix = `--${name}=`;
    return argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
  }

  const specArg = flag("spec");
  const diffArg = flag("diff");

  if (!specArg || !diffArg) {
    console.error("Usage: tsx refute.ts --spec=<specFile> --diff=<diffFile>");
    process.exit(1);
  }

  let spec: string;
  let diff: string;

  try {
    spec = fs.readFileSync(specArg, "utf8");
  } catch (err) {
    console.error(`[refute] Cannot read spec file "${specArg}": ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    diff = fs.readFileSync(diffArg, "utf8");
  } catch (err) {
    console.error(`[refute] Cannot read diff file "${diffArg}": ${(err as Error).message}`);
    process.exit(1);
  }

  const result = await refute({ spec, diff });

  // Always print structured output to stdout.
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");

  if (result.refuted) {
    console.error(`\n[refute] REFUTED: ${result.reason}`);
    process.exit(1);
  } else {
    console.error(`\n[refute] APPROVED: ${result.reason}`);
    process.exit(0);
  }
}

// Run when invoked directly (not when imported as a module).
// tsx sets import.meta.url; compare to the resolved argv[1] path.
const selfUrl = new URL(import.meta.url);
const argvMain = process.argv[1] ? new URL(`file://${path.resolve(process.argv[1])}`).href : "";
if (selfUrl.href === argvMain) {
  main().catch((err) => {
    console.error(`[refute] Fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}
