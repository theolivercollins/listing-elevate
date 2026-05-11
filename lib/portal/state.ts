export type OrderStatus =
  | "awaiting_onboarding"
  | "awaiting_delivery"
  | "delivered"
  | "in_review"
  | "revision_requested"
  | "approved"
  | "awaiting_payment"
  | "paid"
  | "canceled"
  | "in_progress"; // legacy — accepted by the CHECK constraint but not produced by computeNextOrderStatus

export type OrderEvent =
  | "onboarding_completed"
  | "version_uploaded"
  | "client_opened"
  | "revision_requested"
  | "approved"
  | "payment_intent_created"
  | "payment_succeeded"
  | "canceled";

const TRANSITIONS: Partial<Record<OrderStatus, Partial<Record<OrderEvent, OrderStatus>>>> = {
  awaiting_onboarding: { onboarding_completed: "awaiting_delivery", canceled: "canceled" },
  awaiting_delivery: { version_uploaded: "delivered", canceled: "canceled" },
  delivered: { client_opened: "in_review", version_uploaded: "delivered", canceled: "canceled" },
  in_review: { revision_requested: "revision_requested", approved: "approved", version_uploaded: "delivered", canceled: "canceled" },
  revision_requested: { version_uploaded: "delivered", canceled: "canceled" },
  approved: { payment_intent_created: "awaiting_payment", canceled: "canceled" },
  awaiting_payment: { payment_succeeded: "paid", canceled: "canceled" },
};

export function computeNextOrderStatus(current: OrderStatus, event: OrderEvent): OrderStatus {
  const next = TRANSITIONS[current]?.[event];
  if (!next) {
    throw new Error(`illegal transition: ${current} + ${event}`);
  }
  return next;
}
