import { supabase } from "@/lib/supabase";

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = init?.body ? { "Content-Type": "application/json" } : {};
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body as T;
}

export type OrderStatus =
  | "awaiting_onboarding"
  | "awaiting_delivery"
  | "awaiting_payment"
  | "paid"
  | "in_progress"
  | "delivered"
  | "in_review"
  | "revision_requested"
  | "approved"
  | "canceled";

/**
 * Format a portal order number for display. Matches the string we attach
 * to Stripe PaymentIntent descriptions so the customer sees the same value
 * on the success page, in their Stripe receipt email, and in any support
 * conversation.
 */
export function formatOrderNumber(n: number): string {
  return `REC-${String(n).padStart(4, "0")}`;
}

export interface PortalOrder {
  id: string;
  order_number: number;
  customer_id: string;
  title: string;
  description: string | null;
  amount_cents: number;
  currency: string;
  line_items: Array<{ description: string; amount_cents: number; quantity: number }>;
  status: OrderStatus;
  onboarding_token: string | null;
  stripe_invoice_id: string | null;
  stripe_invoice_url: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  customer?: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    business_name: string | null;
  };
}

export interface CreateOrderInput {
  customer_email: string;
  customer_first_name: string;
  customer_last_name: string;
  title: string;
  description?: string;
  amount_cents: number;
  line_items?: Array<{ description: string; amount_cents: number; quantity: number }>;
}

export async function listOrders(): Promise<PortalOrder[]> {
  const { orders } = await authedFetch<{ orders: PortalOrder[] }>("/api/portal/orders");
  return orders;
}

export async function createOrder(input: CreateOrderInput): Promise<{ order: PortalOrder; onboarding_url: string | null }> {
  return authedFetch("/api/portal/orders", { method: "POST", body: JSON.stringify(input) });
}

export async function getOrder(id: string): Promise<{ order: PortalOrder; onboarding_url: string | null; deliverables: PortalDeliverable[] }> {
  return authedFetch(`/api/portal/orders/${id}`);
}

// Public — no auth header required (still passes through authedFetch for consistency)
export interface OnboardOrderSummary {
  order: {
    id: string;
    order_number: number;
    title: string;
    description: string | null;
    amount_cents: number;
    currency: string;
    line_items: Array<{ description: string; amount_cents: number; quantity: number }>;
    status: OrderStatus;
  };
  customer: {
    email: string;
    first_name: string;
    last_name: string;
    business_name: string | null;
    phone: string | null;
    address_line1: string | null;
    address_line2: string | null;
    address_city: string | null;
    address_state: string | null;
    address_postal_code: string | null;
    address_country: string | null;
  };
}

export async function fetchOnboardingSummary(token: string): Promise<OnboardOrderSummary> {
  const res = await fetch(`/api/portal/onboard/${token}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
  return res.json();
}

export interface OnboardSubmitInput {
  first_name?: string;
  last_name?: string;
  business_name?: string;
  phone: string;
  address_line1: string;
  address_line2?: string;
  address_city: string;
  address_state: string;
  address_postal_code: string;
  address_country: string;
}

export async function submitOnboarding(token: string, input: OnboardSubmitInput): Promise<{ status: OrderStatus }> {
  const res = await fetch(`/api/portal/onboard/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${res.status}`);
  return res.json();
}

export function formatStatus(status: OrderStatus): { label: string; tone: "neutral" | "accent" | "warning" | "success" | "destructive" } {
  switch (status) {
    case "awaiting_onboarding": return { label: "Awaiting client", tone: "warning" };
    case "awaiting_delivery": return { label: "Awaiting delivery", tone: "accent" };
    case "awaiting_payment": return { label: "Invoice sent", tone: "warning" };
    case "paid": return { label: "Paid", tone: "accent" };
    case "in_progress": return { label: "In progress", tone: "accent" };
    case "delivered": return { label: "Delivered", tone: "accent" };
    case "in_review": return { label: "In review", tone: "accent" };
    case "revision_requested": return { label: "Revision requested", tone: "warning" };
    case "approved": return { label: "Approved", tone: "success" };
    case "canceled": return { label: "Canceled", tone: "destructive" };
  }
}

export interface PortalDeliverable {
  id: string;
  order_id: string;
  title: string;
  description: string | null;
  review_token: string;
  status: "pending" | "in_review" | "revision_requested" | "approved";
  created_at: string;
  updated_at: string;
  versions: PortalDeliverableVersion[];
}

export interface PortalDeliverableVersion {
  id: string;
  version: number;
  file_name: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  upload_note: string | null;
  upload_status: "pending" | "uploaded" | "failed";
  created_at: string;
}

export async function createDeliverable(orderId: string, title: string): Promise<{ deliverable_id: string }> {
  return authedFetch(`/api/portal/orders/${orderId}/deliverables`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function createVersion(
  orderId: string,
  deliverableId: string,
  init: { file_name: string; mime_type: string; file_size_bytes: number; upload_note?: string },
): Promise<{ version_id: string; signed_upload_url: string; storage_path: string }> {
  return authedFetch(`/api/portal/orders/${orderId}/deliverables/${deliverableId}/versions`, {
    method: "POST",
    body: JSON.stringify(init),
  });
}

export async function finalizeVersion(
  orderId: string,
  deliverableId: string,
  versionId: string,
): Promise<{ status: "uploaded"; order_status: OrderStatus }> {
  return authedFetch(
    `/api/portal/orders/${orderId}/deliverables/${deliverableId}/versions/${versionId}/finalize`,
    { method: "POST" },
  );
}

export async function deleteDeliverable(orderId: string, deliverableId: string): Promise<void> {
  await authedFetch(`/api/portal/orders/${orderId}/deliverables/${deliverableId}`, { method: "DELETE" });
}
