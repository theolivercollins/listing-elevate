// src/components/blog/ally-email-storage.ts
//
// localStorage-backed persistence for the Ally email floating chat.
// Keyed by email id (or a session-local key for the compose page) so
// reopening Ally on the same email resumes the thread.
// Mirrors ally-storage.ts exactly but uses a different key prefix to avoid
// namespace collisions with blog-post chat threads.

import type { AIChatMessage, AIResearchSource } from "@/lib/blog/api-client";

interface EmailFormPatch {
  subject?: string;
  preheader?: string;
  body_html?: string;
  from_name?: string;
  from_email?: string;
  audience?: string;
}

export interface EmailProposalCardSnapshot {
  id: string;
  reply: string;
  patch: EmailFormPatch;
  changedSummary: string;
  changesNarrative: string | null;
  beforeBodyHtml: string;
  afterBodyHtml: string;
  beforeSubject: string;
  afterSubject: string;
  applied: boolean;
}

export interface PersistedEmailChat {
  v: 1;
  messages: Array<AIChatMessage & { suggestResearch?: boolean; queued?: boolean }>;
  proposals: EmailProposalCardSnapshot[];
  sources: AIResearchSource[];
  totalCostCents: number;
  useResearch: boolean;
  updatedAt?: string;
}

export const STORAGE_PREFIX = "ally-email-chat:";
const MAX_PERSISTED_MESSAGES = 60;

export function storageKey(emailId: string): string {
  return `${STORAGE_PREFIX}${emailId}`;
}

export function loadPersisted(emailId: string): PersistedEmailChat | null {
  if (!emailId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(emailId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1 || !Array.isArray(parsed.messages)) return null;
    return parsed as PersistedEmailChat;
  } catch {
    return null;
  }
}

export function savePersisted(emailId: string, state: Omit<PersistedEmailChat, "updatedAt">) {
  if (!emailId || typeof window === "undefined") return;
  try {
    const trimmed: PersistedEmailChat = {
      ...state,
      messages: state.messages.slice(-MAX_PERSISTED_MESSAGES),
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey(emailId), JSON.stringify(trimmed));
  } catch {
    // Quota exceeded or storage disabled — silently skip; chat still works in-memory.
  }
}

export function clearPersisted(emailId: string) {
  if (!emailId || typeof window === "undefined") return;
  try { window.localStorage.removeItem(storageKey(emailId)); } catch { /* ignore */ }
}

export interface PersistedEmailChatEntry {
  emailId: string;
  data: PersistedEmailChat;
}

/** Enumerate every persisted Ally email chat. Sorted newest first. */
export function listAllPersisted(): PersistedEmailChatEntry[] {
  if (typeof window === "undefined") return [];
  const out: PersistedEmailChatEntry[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const emailId = key.slice(STORAGE_PREFIX.length);
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const data = JSON.parse(raw) as PersistedEmailChat;
        if (data?.v !== 1) continue;
        out.push({ emailId, data });
      } catch { /* skip malformed */ }
    }
  } catch { /* ignore */ }
  out.sort((a, b) => {
    const ta = a.data.updatedAt ? new Date(a.data.updatedAt).getTime() : 0;
    const tb = b.data.updatedAt ? new Date(b.data.updatedAt).getTime() : 0;
    return tb - ta;
  });
  return out;
}
