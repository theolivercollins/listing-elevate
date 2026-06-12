import { supabase } from "./supabase";
import type { TokenPurchase, Expense, RevenueEntry, TokenProvider, CostEvent, Subscription, BillingPeriod } from "./types";

// ─── Token purchases ──────────────────────────────────────────────

export async function listTokenPurchases(): Promise<TokenPurchase[]> {
  const { data, error } = await supabase
    .from("token_purchases")
    .select("*")
    .order("purchased_at", { ascending: false });
  if (error) throw error;
  return (data || []) as TokenPurchase[];
}

export async function createTokenPurchase(input: {
  provider: TokenProvider;
  amount_cents: number;
  units: number;
  unit_type?: string;
  note?: string;
  purchased_at?: string;
}): Promise<TokenPurchase> {
  const { data, error } = await supabase
    .from("token_purchases")
    .insert({
      provider: input.provider,
      amount_cents: input.amount_cents,
      units: input.units,
      unit_type: input.unit_type || null,
      note: input.note || null,
      purchased_at: input.purchased_at || new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data as TokenPurchase;
}

export async function updateTokenPurchase(
  id: string,
  patch: Partial<Pick<TokenPurchase, "provider" | "amount_cents" | "units" | "unit_type" | "note" | "purchased_at">>,
): Promise<TokenPurchase> {
  const { data, error } = await supabase
    .from("token_purchases")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as TokenPurchase;
}

export async function deleteTokenPurchase(id: string): Promise<void> {
  const { error } = await supabase.from("token_purchases").delete().eq("id", id);
  if (error) throw error;
}

// ─── Expenses ─────────────────────────────────────────────────────

export async function listExpenses(): Promise<Expense[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .order("incurred_at", { ascending: false });
  if (error) throw error;
  return (data || []) as Expense[];
}

export async function createExpense(input: {
  category: string;
  amount_cents: number;
  description?: string;
  incurred_at?: string;
}): Promise<Expense> {
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      category: input.category,
      amount_cents: input.amount_cents,
      description: input.description || null,
      incurred_at: input.incurred_at || new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data as Expense;
}

export async function updateExpense(
  id: string,
  patch: Partial<Pick<Expense, "category" | "amount_cents" | "description" | "incurred_at">>,
): Promise<Expense> {
  const { data, error } = await supabase
    .from("expenses")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Expense;
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw error;
}

// ─── Revenue ──────────────────────────────────────────────────────

export async function listRevenueEntries(): Promise<RevenueEntry[]> {
  const { data, error } = await supabase
    .from("revenue_entries")
    .select("*")
    .order("received_at", { ascending: false });
  if (error) throw error;
  return (data || []) as RevenueEntry[];
}

export async function createRevenueEntry(input: {
  source: string;
  amount_cents: number;
  property_id?: string;
  note?: string;
  received_at?: string;
}): Promise<RevenueEntry> {
  const { data, error } = await supabase
    .from("revenue_entries")
    .insert({
      source: input.source,
      amount_cents: input.amount_cents,
      property_id: input.property_id || null,
      note: input.note || null,
      received_at: input.received_at || new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data as RevenueEntry;
}

export async function updateRevenueEntry(
  id: string,
  patch: Partial<Pick<RevenueEntry, "source" | "amount_cents" | "property_id" | "note" | "received_at">>,
): Promise<RevenueEntry> {
  const { data, error } = await supabase
    .from("revenue_entries")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as RevenueEntry;
}

export async function deleteRevenueEntry(id: string): Promise<void> {
  const { error } = await supabase.from("revenue_entries").delete().eq("id", id);
  if (error) throw error;
}

// Count of delivered videos (for cost-per-video calculations)
export async function countDeliveredVideos(): Promise<number> {
  const { count, error } = await supabase
    .from("properties")
    .select("*", { count: "exact", head: true })
    .eq("status", "complete");
  if (error) throw error;
  return count ?? 0;
}

// ─── Cost events (real per-call spend) ────────────────────────────

export async function listCostEvents(limit = 500): Promise<CostEvent[]> {
  const { data, error } = await supabase
    .from("cost_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as CostEvent[];
}

// ─── Subscriptions ─────────────────────────────────────────────────

export async function listSubscriptions(): Promise<Subscription[]> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as Subscription[];
}

export async function createSubscription(input: {
  provider: string;
  amount_cents: number;
  billing_period: BillingPeriod;
  started_at: string;
  next_charge_at: string;
  note?: string;
}): Promise<Subscription> {
  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      provider: input.provider,
      amount_cents: input.amount_cents,
      billing_period: input.billing_period,
      started_at: input.started_at,
      next_charge_at: input.next_charge_at,
      note: input.note || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function updateSubscription(
  id: string,
  patch: Partial<Pick<Subscription, "provider" | "amount_cents" | "billing_period" | "next_charge_at" | "status" | "note">>,
): Promise<Subscription> {
  const { data, error } = await supabase
    .from("subscriptions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function deleteSubscription(id: string): Promise<void> {
  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
