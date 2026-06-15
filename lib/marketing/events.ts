import type { SupabaseClient } from "@supabase/supabase-js";

export type AllyEventType =
  | "message_sent"
  | "reply_returned"
  | "chip_clicked"
  | "cta_emitted"
  | "lead_captured"
  | "first_email_captured"
  | "kill_switch_blocked"
  | "rate_limited";

export interface AllyEvent {
  conversation_id: string;
  event_type: AllyEventType;
  payload?: Record<string, unknown>;
  ip_hash?: string | null;
}

// Telemetry is best-effort: never throw, never block the chat path.
export async function recordAllyEvent(
  supabase: SupabaseClient,
  event: AllyEvent,
): Promise<void> {
  try {
    const { error } = await supabase.from("marketing_ally_events").insert([{
      conversation_id: event.conversation_id,
      event_type: event.event_type,
      payload: event.payload ?? {},
      ip_hash: event.ip_hash ?? null,
    }]);
    if (error) {
      console.error(`recordAllyEvent failed (${event.event_type}): ${error.message}`);
    }
  } catch (err) {
    console.error(`recordAllyEvent exception (${event.event_type}):`, (err as Error).message);
  }
}
