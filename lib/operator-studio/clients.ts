// lib/operator-studio/clients.ts
import { getSupabase } from '../client.js';
import type { ClientInput, ClientRow } from '../types/operator-studio.js';

export async function listClients(opts: { includeArchived?: boolean } = {}): Promise<ClientRow[]> {
  let q = getSupabase().from('clients').select('*');
  if (!opts.includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q.order('name', { ascending: true });
  if (error) throw new Error(`listClients: ${error.message}`);
  return (data ?? []) as ClientRow[];
}

export async function getClient(id: string): Promise<ClientRow | null> {
  const { data, error } = await getSupabase().from('clients').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getClient: ${error.message}`);
  return (data as ClientRow | null) ?? null;
}

export async function createClient(input: ClientInput): Promise<ClientRow> {
  const name = input.name?.trim();
  if (!name) throw new Error('createClient: name is required');
  const { data, error } = await getSupabase().from('clients').insert({ ...input, name }).select('*').single();
  if (error) throw new Error(`createClient: ${error.message}`);
  return data as ClientRow;
}

export async function updateClient(id: string, patch: Partial<ClientInput>): Promise<ClientRow> {
  const { data, error } = await getSupabase()
    .from('clients')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`updateClient: ${error.message}`);
  return data as ClientRow;
}

export async function archiveClient(id: string): Promise<ClientRow> {
  const { data, error } = await getSupabase()
    .from('clients')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`archiveClient: ${error.message}`);
  return data as ClientRow;
}
