// src/lib/marketing/api-client.ts

export interface MarketingChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface MarketingChatLeadCapture {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  intent?: string;
}

export interface MarketingChatResponse {
  reply: string;
  followup_chips: string[] | null;
  cta: "get_started" | null;
  lead_capture: MarketingChatLeadCapture | null;
  conversation_id: string;
  cost_cents: number;
  model: string;
}

export interface MarketingChatError {
  error: string;
  scope?: string;
}

export async function marketingAllyChat(
  messages: MarketingChatMessage[],
): Promise<MarketingChatResponse> {
  const res = await fetch("/api/marketing/ally-chat", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as MarketingChatError;
    throw new Error(err.error ?? `chat failed (${res.status})`);
  }
  return (await res.json()) as MarketingChatResponse;
}
