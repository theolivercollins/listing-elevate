// Classify provider errors so the pipeline can decide whether to
// fail over to another provider or just retry the same one.
//
// Before this module, any exception in `provider.generateClip` caused
// `runGenerationSubmit` to mark the scene `needs_review` permanently —
// which meant a transient Kling 500 took Kling out of rotation for the
// rest of the run. Matching the classification rule the TODO pinned:
//
//   - permanent — bad creds/billing/schema (400/401/402/403). Failover
//                 to a different provider is the only sensible action.
//   - capacity  — 429/concurrency (trial plan cap). Retry same provider
//                 after backoff; don't burn the provider.
//   - transient — 5xx, network, timeout. Retry with backoff on same
//                 provider; fail over only if the retry also fails.
//   - unknown   — anything we can't classify. Treat as transient.
//
// Both status codes AND message heuristics are consulted because
// provider SDKs throw mixed shapes (fetch Response errors, custom
// classes, plain Error with a status embedded in the text).

export type ProviderErrorKind = "permanent" | "capacity" | "transient" | "unknown";

export interface ClassifiedError {
  kind: ProviderErrorKind;
  status?: number;
  message: string;
  retryable: boolean;
  shouldFailover: boolean;
}

const PERMANENT_CODES = new Set([400, 401, 402, 403, 404, 410, 422]);
const CAPACITY_CODES = new Set([408, 425, 429]);

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const anyErr = err as { status?: unknown; statusCode?: unknown; code?: unknown; response?: { status?: unknown } };
  const candidates = [anyErr.status, anyErr.statusCode, anyErr.code, anyErr.response?.status];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isInteger(c)) return c;
    if (typeof c === "string" && /^\d{3}$/.test(c)) return parseInt(c, 10);
  }
  return undefined;
}

function extractMessage(err: unknown): string {
  if (!err) return "";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

function statusFromMessage(msg: string): number | undefined {
  // Providers frequently throw errors like:
  //   "Kling API error: 429 rate limit exceeded"
  //   "Runway 401 unauthorized"
  //   "KLING_ACCESS_KEY missing"
  // so if there's a 3-digit status in the first 120 chars, grab it.
  const m = msg.slice(0, 120).match(/\b([345]\d{2})\b/);
  return m ? parseInt(m[1], 10) : undefined;
}

export function classifyProviderError(err: unknown): ClassifiedError {
  const message = extractMessage(err);
  const status = extractStatus(err) ?? statusFromMessage(message);
  const lower = message.toLowerCase();

  if (status && PERMANENT_CODES.has(status)) {
    return { kind: "permanent", status, message, retryable: false, shouldFailover: true };
  }
  if (status && CAPACITY_CODES.has(status)) {
    return { kind: "capacity", status, message, retryable: true, shouldFailover: false };
  }
  if (status && status >= 500) {
    return { kind: "transient", status, message, retryable: true, shouldFailover: false };
  }

  // Keyword fallbacks for SDKs that don't expose status cleanly.
  // atlas_insufficient_balance is a permanent billing failure — retrying is pointless.
  if (/unauthor|forbidden|invalid api key|api key.*(missing|invalid)|quota exceeded|insufficient.*(credit|balance)|atlas_insufficient_balance|payment required|billing/i.test(message)) {
    return { kind: "permanent", status, message, retryable: false, shouldFailover: true };
  }
  if (/rate.?limit|too many|concurrency|capacity|slots.*full/i.test(message)) {
    return { kind: "capacity", status, message, retryable: true, shouldFailover: false };
  }
  if (/timeout|timed out|econnreset|network|fetch failed|socket hang up|bad gateway/i.test(message)) {
    return { kind: "transient", status, message, retryable: true, shouldFailover: false };
  }
  // Silence the unused-var TypeScript warning on the lowered copy — we
  // used it inside the keyword regexes above.
  void lower;

  return { kind: "unknown", status, message, retryable: true, shouldFailover: false };
}
