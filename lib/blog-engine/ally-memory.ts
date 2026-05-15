// lib/blog-engine/ally-memory.ts
//
// Persistent notes Ally has been told to remember. Scoped per blog_sites row.
// Soft-delete via active=false so we can audit history.

export interface AllyMemory {
  id: string;
  site_id: string;
  content: string;
  created_at: string;
  active: boolean;
}

const MAX_CONTENT_CHARS = 500;
const MAX_PER_SITE = 100;

export async function listMemories(supabase: any, siteId: string): Promise<AllyMemory[]> {
  const { data } = await supabase
    .from("ally_memories")
    .select("*")
    .eq("site_id", siteId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(MAX_PER_SITE);
  return Array.isArray(data) ? data : [];
}

export async function addMemory(supabase: any, siteId: string, content: string): Promise<AllyMemory | null> {
  const trimmed = content.trim().slice(0, MAX_CONTENT_CHARS);
  if (!trimmed) return null;
  // Dedupe — skip if an identical active memory already exists. Avoids the
  // user saying "remember X" twice and getting two rows.
  const { data: existing } = await supabase
    .from("ally_memories")
    .select("id")
    .eq("site_id", siteId)
    .eq("active", true)
    .eq("content", trimmed)
    .limit(1)
    .single();
  if (existing?.id) return null;

  const { data, error } = await supabase
    .from("ally_memories")
    .insert([{ site_id: siteId, content: trimmed }])
    .select("*")
    .single();
  if (error || !data) return null;
  return data as AllyMemory;
}

export async function deactivateMemory(supabase: any, id: string): Promise<boolean> {
  const { error } = await supabase
    .from("ally_memories")
    .update({ active: false })
    .eq("id", id);
  return !error;
}

export function memoriesAsPromptBlock(memories: AllyMemory[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map((m, i) => `- [${i + 1}] ${m.content}`).join("\n");
  return `=== ALLY'S NOTES (persistent — user has told you to remember these) ===

These are durable facts and preferences the user has explicitly asked you to remember. Honor them across every turn. If a note seems to conflict with the current request, flag the conflict in <reply> instead of silently overriding.

${lines}
`;
}
