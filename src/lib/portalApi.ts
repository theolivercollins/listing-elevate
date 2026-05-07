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
  | "awaiting_payment"
  | "paid"
  | "in_progress"
  | "delivered"
  | "in_review"
  | "revision_requested"
  | "approved"
  | "canceled";

export interface PortalOrder {
  id: string;
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

export async function getOrder(id: string): Promise<{ order: PortalOrder; onboarding_url: string | null }> {
  return authedFetch(`/api/portal/orders/${id}`);
}

// Public — no auth header required (still passes through authedFetch for consistency)
export interface OnboardOrderSummary {
  order: {
    id: string;
    title: string;
    description: string | null;
    amount_cents: number;
    currency: string;
    line_items: Array<{ description: string; amount_cents: number; quantity: number }>;
    status: OrderStatus;
    stripe_invoice_url: string | null;
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
  business_name?: string;
  phone: string;
  address_line1: string;
  address_line2?: string;
  address_city: string;
  address_state: string;
  address_postal_code: string;
  address_country: string;
}

export async function submitOnboarding(token: string, input: OnboardSubmitInput): Promise<{ status: OrderStatus; stripe_invoice_url: string }> {
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
