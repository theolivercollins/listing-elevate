// src/components/blog/ally-storage.ts
//
// localStorage-backed persistence for the Improve-with-Ally floating chat.
// Keyed by post id so reopening Ally on the same post resumes the thread.
// Attachments are deliberately NOT persisted (one-shot per turn + base64
// chews through the storage budget). Schema is versioned.

import type { AIChatMessage, AIResearchSource } from "@/lib/blog/api-client";

interface FormPatch {
  title?: string;
  body_html?: string;
  meta_title?: string;
  meta_description?: string;
  meta_tags?: string[];
  author_label?: string;
  category_label?: string;
}

export interface ProposalCardSnapshot {
  id: string;
  reply: string;
  patch: FormPatch;
  changedSummary: string;
  changesNarrative: string | null;
  beforeBodyHtml: string;
  afterBodyHtml: string;
  beforeTitle: string;
  afterTitle: string;
  applied: boolean;
}

export interface PersistedChat {
  v: 1;
  messages: Array<AIChatMessage & { suggestResearch?: boolean; queued?: boolean }>;
  proposals: ProposalCardSnapshot[];
  sources: AIResearchSource[];
  totalCostCents: number;
  useResearch: boolean;
  /** ISO timestamp — when the chat was last touched. Used by the history page
   *  to sort by recency. Older blobs may omit it; fall back to 1970. */
  updatedAt?: string;
}

export const STORAGE_PREFIX = "ally-chat:";
const MAX_PERSISTED_MESSAGES = 60;

export function storageKey(postId: string): string {
  return `${STORAGE_PREFIX}${postId}`;
}

export function loadPersisted(postId: string): PersistedChat | null {
  if (!postId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(postId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1 || !Array.isArray(parsed.messages)) return null;
    return parsed as PersistedChat;
  } catch {
    return null;
  }
}

export function savePersisted(postId: string, state: Omit<PersistedChat, "updatedAt">) {
  if (!postId || typeof window === "undefined") return;
  try {
    const trimmed: PersistedChat = {
      ...state,
      messages: state.messages.slice(-MAX_PERSISTED_MESSAGES),
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey(postId), JSON.stringify(trimmed));
  } catch {
    // Quota exceeded or storage disabled — silently skip; chat still works in-memory.
  }
}

export function clearPersisted(postId: string) {
  if (!postId || typeof window === "undefined") return;
  try { window.localStorage.removeItem(storageKey(postId)); } catch { /* ignore */ }
}

export interface PersistedChatEntry {
  postId: string;
  data: PersistedChat;
}

/** Enumerate every persisted Ally chat. Sorted newest first. */
export function listAllPersisted(): PersistedChatEntry[] {
  if (typeof window === "undefined") return [];
  const out: PersistedChatEntry[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const postId = key.slice(STORAGE_PREFIX.length);
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const data = JSON.parse(raw) as PersistedChat;
        if (data?.v !== 1) continue;
        out.push({ postId, data });
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
