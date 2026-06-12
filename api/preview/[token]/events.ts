import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isWellFormedToken } from '../../../lib/operator-studio/preview-tokens.js';
import {
  fetchByToken,
  lookupPreviewId,
  insertViewEvent,
  type ViewEventType,
} from '../../../lib/operator-studio/preview.js';

/** The six allowed event values, kept as a Set for O(1) whitelist check. */
const ALLOWED_EVENTS = new Set<ViewEventType>([
  'view', 'play', 'progress_25', 'progress_50', 'progress_75', 'complete',
]);

function isAllowedEvent(v: unknown): v is ViewEventType {
  return typeof v === 'string' && ALLOWED_EVENTS.has(v as ViewEventType);
}

function isOrientation(v: unknown): v is 'horizontal' | 'vertical' {
  return v === 'horizontal' || v === 'vertical';
}

const UA_REFERRER_CLAMP = 512;
const SESSION_ID_CLAMP = 200;

/** Clamp a string header value to the given length; returns null when absent. */
function clampHeader(v: unknown, max: number): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  return s.slice(0, max);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only POST is accepted for beacon events.
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // 1. Token well-formedness — fail fast before any DB hit.
  const token = String(req.query.token ?? '');
  if (!isWellFormedToken(token)) return res.status(404).json({ error: 'not_found' });

  // 2. Link existence + expiry/revocation check.
  //    fetchByToken sets expired=true when revoked_at is present (spec §Back-compat).
  const result = await fetchByToken(token);
  if (!result || result.expired) return res.status(404).json({ error: 'not_found' });

  // 3. session_id — required, non-empty, clamped to 200 chars.
  const rawSessionId = req.body?.session_id;
  if (rawSessionId == null || String(rawSessionId).trim() === '') {
    return res.status(400).json({ error: 'session_id required' });
  }
  const session_id = String(rawSessionId).slice(0, SESSION_ID_CLAMP);

  // 4. event whitelist — reject anything not in the allowed set.
  const rawEvent = req.body?.event;
  if (!isAllowedEvent(rawEvent)) {
    return res.status(400).json({ error: 'invalid event' });
  }
  const event: ViewEventType = rawEvent;

  // 5. Optional fields — position_seconds (numeric|null), orientation (whitelisted|null).
  const rawOrientation = req.body?.orientation;
  if (rawOrientation !== undefined && rawOrientation !== null && !isOrientation(rawOrientation)) {
    return res.status(400).json({ error: 'invalid orientation' });
  }
  const orientation: 'horizontal' | 'vertical' | null =
    isOrientation(rawOrientation) ? rawOrientation : null;

  const rawPosition = req.body?.position_seconds;
  const position_seconds: number | null =
    rawPosition != null && typeof rawPosition === 'number' ? rawPosition : null;

  // 6. Clamp UA and referrer from request headers.
  const user_agent = clampHeader(req.headers['user-agent'], UA_REFERRER_CLAMP);
  // Both 'referer' (HTTP/1.1 misspelling) and 'referrer' are checked for safety.
  const referrerRaw = req.headers['referer'] ?? req.headers['referrer'];
  const referrer = clampHeader(referrerRaw, UA_REFERRER_CLAMP);

  // 7. Lookup the preview_id UUID needed for the FK insert.
  //    Returns null pre-migration or on any error — swallow and still 204.
  const preview_id = await lookupPreviewId(token);
  if (preview_id != null) {
    // insertViewEvent swallows all errors internally (including table-not-found
    // pre-migration-084) and always returns void — the beacon must never fail.
    await insertViewEvent({ preview_id, session_id, event, position_seconds, orientation, user_agent, referrer });
  }
  // Pre-migration (preview_id null or insert error swallowed): still 204.
  return res.status(204).end();
}
