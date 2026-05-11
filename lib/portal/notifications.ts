import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplateEmail, type EmailTemplate } from "./email.js";

export type NotificationKind =
  | "onboarding_completed"
  | "comment_added"
  | "revision_requested"
  | "approval_received"
  | "order_paid";

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  linkPath?: string;
  orderId?: string;
  deliverableId?: string;
  commentId?: string;
}

export async function writeNotification(supabase: SupabaseClient, input: NotifyInput): Promise<void> {
  const { error } = await supabase.from("portal_notifications").insert({
    user_id: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    link_path: input.linkPath ?? null,
    order_id: input.orderId ?? null,
    deliverable_id: input.deliverableId ?? null,
    comment_id: input.commentId ?? null,
  });
  if (error) console.error("[notifications] write failed", error);
}

export async function notifyOwner(
  supabase: SupabaseClient,
  ownerId: string,
  template: EmailTemplate,
  toEmail: string,
  data: Record<string, unknown>,
  notif: Omit<NotifyInput, "userId">,
): Promise<void> {
  try {
    await writeNotification(supabase, { ...notif, userId: ownerId });
  } catch (e) {
    console.error("[notifications] notifyOwner write failed", e);
  }
  try {
    await sendTemplateEmail({ to: toEmail, template, data });
  } catch (e) {
    console.error("[notifications] notifyOwner email failed", e);
  }
}

export async function notifyClient(
  _supabase: SupabaseClient,
  toEmail: string,
  template: EmailTemplate,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await sendTemplateEmail({ to: toEmail, template, data });
  } catch (e) {
    console.error("[notifications] notifyClient email failed", e);
  }
}
