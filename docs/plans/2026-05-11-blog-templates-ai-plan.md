# Blog — Editor + Templates + AI Generation — Implementation Plan

> Use superpowers:subagent-driven-development to execute. Checkboxes track progress.

**Spec:** [`docs/specs/2026-05-11-blog-templates-ai-design.md`](../specs/2026-05-11-blog-templates-ai-design.md)

**Goal:** Editor fix (Source-mode toggle + Tiptap extensions) + templates (CRUD page + .html upload + picker on compose) + AI generation (Claude Sonnet 4.6 modal).

**Architecture summary:**
- Migration 051 adds one new table (`blog_templates`)
- Pure-logic `lib/blog-engine/ai-draft.ts` with injected `anthropic` dep — unit-testable
- New API endpoints under `api/blog/templates/*` and `api/blog/ai/draft.ts`
- Three new frontend files (templates list + detail pages, AI modal); two modifications (PostEditor extended, BlogPostDetail rewired)

**Tech stack additions:** `@anthropic-ai/sdk` (already in `package.json` from prior LE work), `@tiptap/extension-underline`, `@tiptap/extension-text-align`, `@tiptap/extension-table`, `@tiptap/extension-table-row`, `@tiptap/extension-table-cell`, `@tiptap/extension-table-header`.

---

## Task 1: Migration 051 — `blog_templates`

**File:** `supabase/migrations/051_blog_templates.sql`

```sql
-- 051_blog_templates.sql
-- Templates that users save (HTML structure) and pick from when composing posts
-- or feed to the Claude AI draft endpoint as a structural skeleton.

create table blog_templates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references blog_sites(id),
  name text not null,
  description text,
  body_html text not null default '',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index blog_templates_site_active_idx
  on blog_templates(site_id, active)
  where active = true;
```

Controller applies via Supabase MCP or dashboard. Implementer just commits.

```bash
git add supabase/migrations/051_blog_templates.sql
git commit -m "feat(blog): migration 051 — blog_templates"
```

---

## Task 2: Frontend types + API client extensions

**Files:**
- `src/lib/blog/types.ts` (modify — append `BlogTemplate` + AI types)
- `src/lib/blog/api-client.ts` (modify — append templates + AI fns)

Append to `types.ts`:

```ts
export interface BlogTemplate {
  id: string;
  site_id: string | null;
  name: string;
  description: string | null;
  body_html: string;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AIDraftInput {
  prompt: string;
  template_id?: string | null;
  length: "short" | "standard" | "long";
  tone: "professional" | "casual" | "data_driven";
}

export interface AIDraftResult {
  html: string;
  cost_cents: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}
```

Append to `api-client.ts`:

```ts
import type {
  // existing imports above…
  BlogTemplate, AIDraftInput, AIDraftResult,
} from "./types";

// Templates
export async function listTemplates(): Promise<{ templates: BlogTemplate[] }> {
  const res = await fetch("/api/blog/templates", { headers: await authHeaders() });
  return asJson(res);
}
export async function getTemplate(id: string): Promise<{ template: BlogTemplate }> {
  const res = await fetch(`/api/blog/templates/${id}`, { headers: await authHeaders() });
  return asJson(res);
}
export async function createTemplate(input: { name: string; description?: string; body_html: string }): Promise<{ id: string }> {
  const res = await fetch("/api/blog/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
  });
  return asJson(res);
}
export async function updateTemplate(id: string, patch: Partial<{ name: string; description: string | null; body_html: string }>): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/templates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(patch),
  });
  return asJson(res);
}
export async function deleteTemplate(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/blog/templates/${id}`, { method: "DELETE", headers: await authHeaders() });
  return asJson(res);
}

// AI draft
export async function generateAIDraft(input: AIDraftInput): Promise<AIDraftResult> {
  const res = await fetch("/api/blog/ai/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
  });
  return asJson(res);
}
```

Verify: `npx tsc --noEmit` clean.

```bash
git add src/lib/blog/types.ts src/lib/blog/api-client.ts
git commit -m "feat(blog/ui): types + api-client for templates + AI draft"
```

---

## Task 3: Templates API endpoints

**Files:**
- `api/blog/templates/index.ts` — GET list + POST create
- `api/blog/templates/[id].ts` — GET + PATCH + DELETE

`requireAdmin(req, res)` from `../../../lib/auth.js`, `getSupabase()` from `../../../lib/client.js`. Match the pattern in `api/blog/posts/index.ts`.

```ts
// api/blog/templates/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("blog_templates").select("*")
      .eq("active", true)
      .order("updated_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ templates: data ?? [] });
  }

  if (req.method === "POST") {
    const b = req.body ?? {};
    if (!b.name || typeof b.body_html !== "string") {
      return res.status(400).json({ error: "name and body_html required" });
    }
    const { data: site } = await supabase.from("blog_sites").select("id").eq("host_kind", "sierra").single();
    const { data, error } = await supabase.from("blog_templates").insert([{
      site_id: site?.id ?? null,
      name: b.name,
      description: b.description ?? null,
      body_html: b.body_html,
    }]).select("id").single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ id: data!.id });
  }

  return res.status(405).end();
}
```

```ts
// api/blog/templates/[id].ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

const EDITABLE = ["name", "description", "body_html"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();
  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  if (req.method === "GET") {
    const { data, error } = await supabase.from("blog_templates").select("*").eq("id", id).single();
    if (error || !data) return res.status(404).json({ error: "not found" });
    return res.status(200).json({ template: data });
  }

  if (req.method === "PATCH") {
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) if (k in (req.body ?? {})) patch[k] = (req.body as any)[k];
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no editable fields" });
    patch.updated_at = new Date().toISOString();
    const { error } = await supabase.from("blog_templates").update(patch).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { error } = await supabase.from("blog_templates").update({ active: false }).eq("id", id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
```

Verify: `npx tsc --noEmit` clean.

```bash
git add api/blog/templates/
git commit -m "feat(blog/api): templates CRUD endpoints"
```

---

## Task 4: AI draft module + tests (TDD)

**Files:**
- `lib/blog-engine/ai-draft.ts`
- `lib/blog-engine/ai-draft.test.ts`

Pure-logic module with injected Anthropic client. Same dependency-injection pattern as `lib/blog-engine/image-tagging.ts`.

**Step 1: Write tests first.**

```ts
// lib/blog-engine/ai-draft.test.ts
import { describe, it, expect, vi } from "vitest";
import { generateDraft, _testing } from "./ai-draft";

describe("generateDraft", () => {
  const mkAnthropic = (text: string, usage = { input_tokens: 500, output_tokens: 800 }) => ({
    messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text }], usage }) },
  });

  it("returns clean HTML + computed cost on happy path", async () => {
    const anthropic = mkAnthropic("<h2>Hello</h2><p>World</p>");
    const r = await generateDraft({ prompt: "Test", length: "standard", tone: "professional" }, { anthropic } as any);
    expect(r.html).toBe("<h2>Hello</h2><p>World</p>");
    expect(r.cost_cents).toBeGreaterThan(0);
    expect(r.model).toMatch(/sonnet/);
    expect(r.usage).toEqual({ input_tokens: 500, output_tokens: 800 });
  });

  it("strips ```html fences", async () => {
    const anthropic = mkAnthropic("```html\n<p>Hi</p>\n```");
    const r = await generateDraft({ prompt: "Test", length: "short", tone: "casual" }, { anthropic } as any);
    expect(r.html).toBe("<p>Hi</p>");
  });

  it("strips <script> tags from output", async () => {
    const anthropic = mkAnthropic("<p>Real content</p><script>alert(1)</script><p>More</p>");
    const r = await generateDraft({ prompt: "Test", length: "short", tone: "casual" }, { anthropic } as any);
    expect(r.html).not.toMatch(/<script/i);
    expect(r.html).toContain("Real content");
    expect(r.html).toContain("More");
  });

  it("includes template HTML in the user message when provided", async () => {
    const anthropic = mkAnthropic("<p>filled</p>");
    await generateDraft({
      prompt: "Test",
      template_id: "tpl-1",
      template_html: "<h2>{{title}}</h2>",
      length: "standard",
      tone: "professional",
    }, { anthropic } as any);
    const call = anthropic.messages.create.mock.calls[0][0];
    const userMsg = call.messages[0].content;
    expect(userMsg).toContain("<h2>{{title}}</h2>");
  });

  it("computes cost from Sonnet 4.6 pricing", () => {
    // 1M input @ $3 + 1M output @ $15 → 1800¢
    expect(_testing.computeCostCents(1_000_000, 1_000_000)).toBe(1800);
    // 500 in + 800 out: (500*300 + 800*1500) / 1_000_000 = (150_000 + 1_200_000) / 1_000_000 = 1.35¢ → round up to 2
    expect(_testing.computeCostCents(500, 800)).toBe(2);
  });
});
```

`npx vitest run lib/blog-engine/ai-draft.test.ts` — expect FAIL.

**Step 2: Implement.**

```ts
// lib/blog-engine/ai-draft.ts

export type AILength = "short" | "standard" | "long";
export type AITone = "professional" | "casual" | "data_driven";

export interface GenerateDraftInput {
  prompt: string;
  template_id?: string | null;
  template_html?: string | null;
  length: AILength;
  tone: AITone;
}

export interface GenerateDraftResult {
  html: string;
  cost_cents: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface AnthropicLike {
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: "user"; content: string }[];
    }) => Promise<{
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS_BY_LENGTH: Record<AILength, number> = {
  short: 1024, standard: 2048, long: 4096,
};
const WORDS_BY_LENGTH: Record<AILength, string> = {
  short: "around 300 words", standard: "around 600 words", long: "around 1000 words",
};
const TONE_TEXT: Record<AITone, string> = {
  professional: "warm and professional",
  casual: "warm and conversational, light and friendly",
  data_driven: "warm but data-led, leading with stats and trends",
};

const SYSTEM_PROMPT = `You write real-estate blog posts for The Helgemo Team in Punta Gorda, FL.

Output requirements:
- Return ONLY clean HTML, no markdown, no commentary, no <html>/<head>/<body> wrappers.
- Use these tags only: h2, h3, p, ul, ol, li, strong, em, a, blockquote,
  table, thead, tbody, tr, th, td, br.
- NEVER include <script>, <iframe>, <style>, inline event handlers, or javascript: URLs.
- No emojis unless asked.
- Use The Helgemo Team's voice: warm, knowledgeable, locally-grounded.
  Speak as "we" not "I". Mention Punta Gorda / Charlotte County by name when relevant.
- Always end with a soft CTA inviting the reader to reach out about a tour or market consult.

If a template is provided, treat it as the structural skeleton and fill it in.
Match its tone, headings, and section count unless the prompt explicitly asks otherwise.`;

function buildUserMessage(input: GenerateDraftInput): string {
  const parts: string[] = [];
  parts.push(`Topic / request: ${input.prompt.trim()}`);
  parts.push(`Target length: ${WORDS_BY_LENGTH[input.length]}.`);
  parts.push(`Tone: ${TONE_TEXT[input.tone]}.`);
  if (input.template_html?.trim()) {
    parts.push("");
    parts.push("Use this HTML as the structural template. Match its sections and headings:");
    parts.push("```html");
    parts.push(input.template_html.trim());
    parts.push("```");
  }
  parts.push("");
  parts.push("Return the post HTML now. No preamble.");
  return parts.join("\n");
}

function stripFences(text: string): string {
  return text.replace(/^```(?:html)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

function stripDangerousTags(html: string): string {
  // Remove <script>...</script> blocks and <iframe>...</iframe> blocks (and their content).
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    // Strip on* event handlers and javascript: URLs in attributes
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\sjavascript\s*:\s*[^"'\s>]*/gi, "");
}

// Sonnet 4.6 pricing (2026-05): $3/M input, $15/M output. Stored as integers
// in tenths of a cent for headroom against rounding, then rounded UP to whole cents.
function computeCostCents(inputTokens: number, outputTokens: number): number {
  // 300 = $3/M expressed as cents per token × 1e-4 (i.e. 3 cents / 10k tokens, scaled)
  // Equivalent direct math: cents = (input * 3 + output * 15) / 10000
  const cents = (inputTokens * 3 + outputTokens * 15) / 10000;
  return Math.max(1, Math.ceil(cents));
}

export async function generateDraft(
  input: GenerateDraftInput,
  deps: { anthropic: AnthropicLike },
): Promise<GenerateDraftResult> {
  const userMsg = buildUserMessage(input);
  const resp = await deps.anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_BY_LENGTH[input.length],
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });
  const text = (resp.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const cleaned = stripDangerousTags(stripFences(text));
  return {
    html: cleaned,
    cost_cents: computeCostCents(resp.usage.input_tokens, resp.usage.output_tokens),
    model: MODEL,
    usage: { input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens },
  };
}

export const _testing = { computeCostCents, stripFences, stripDangerousTags, SYSTEM_PROMPT };
```

`npx vitest run lib/blog-engine/ai-draft.test.ts` — expect PASS, 5 tests.

```bash
git add lib/blog-engine/ai-draft.ts lib/blog-engine/ai-draft.test.ts
git commit -m "feat(blog): ai-draft pure-logic module with TDD"
```

---

## Task 5: AI draft API endpoint + cost stage

**Files:**
- `lib/blog-engine/cost.ts` (modify — add `'blog_ai_draft'` to `BlogCostStage` union)
- `api/blog/ai/draft.ts`

**Modify `lib/blog-engine/cost.ts`:** find the `BlogCostStage` type and add `"blog_ai_draft"` as an additional union member.

**Create `api/blog/ai/draft.ts`:**

```ts
// api/blog/ai/draft.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { recordBlogCost } from "../../../lib/blog-engine/cost.js";
import { generateDraft } from "../../../lib/blog-engine/ai-draft.js";

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  const b = req.body ?? {};
  if (!b.prompt || typeof b.prompt !== "string" || b.prompt.length < 3) {
    return res.status(400).json({ error: "prompt required (min 3 chars)" });
  }
  const length = (b.length as "short" | "standard" | "long" | undefined) ?? "standard";
  const tone = (b.tone as "professional" | "casual" | "data_driven" | undefined) ?? "professional";
  if (!["short", "standard", "long"].includes(length)) return res.status(400).json({ error: "bad length" });
  if (!["professional", "casual", "data_driven"].includes(tone)) return res.status(400).json({ error: "bad tone" });

  // Load template if provided
  let templateHtml: string | null = null;
  if (b.template_id) {
    const { data: tpl } = await supabase.from("blog_templates").select("body_html").eq("id", b.template_id).single();
    templateHtml = tpl?.body_html ?? null;
  }

  // Find the site row (single-site for v1)
  const { data: site } = await supabase.from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) return res.status(500).json({ error: "no Sierra site" });

  try {
    const result = await generateDraft(
      { prompt: b.prompt, template_id: b.template_id ?? null, template_html: templateHtml, length, tone },
      { anthropic: anthropic() as any },
    );

    await recordBlogCost(supabase, {
      stage: "blog_ai_draft",
      cost_cents: result.cost_cents,
      post_id: null,
      site_id: site.id,
      provider: "anthropic",
      metadata: {
        model: result.model,
        prompt_snippet: b.prompt.slice(0, 200),
        template_id: b.template_id ?? null,
        length, tone,
        usage: result.usage,
      },
    });

    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(502).json({ error: `AI draft failed: ${e?.message ?? String(e)}` });
  }
}
```

Verify: `npx tsc --noEmit` clean.

```bash
git add lib/blog-engine/cost.ts api/blog/ai/
git commit -m "feat(blog/api): ai/draft endpoint + blog_ai_draft cost stage"
```

---

## Task 6: PostEditor — source toggle + new extensions

**Files:**
- `src/components/blog/PostEditor.tsx` (rewrite)

**Step 1: Install new Tiptap extensions.**

```bash
npm install @tiptap/extension-underline @tiptap/extension-text-align @tiptap/extension-table @tiptap/extension-table-row @tiptap/extension-table-cell @tiptap/extension-table-header
```

**Step 2: Rewrite `src/components/blog/PostEditor.tsx`.**

The new signature accepts a `mode` prop with parent control, plus a callback when the user clicks the toggle. The component renders Tiptap or a textarea based on mode.

```tsx
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExt from "@tiptap/extension-link";
import ImageExt from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold, Italic, Underline as UIcon, Heading2, Heading3,
  Link2, Image as ImageIcon, List, ListOrdered, Quote,
  Undo, Redo, Code2, AlignLeft, AlignCenter, AlignRight,
  Table as TableIcon,
} from "lucide-react";

export type EditorMode = "rich" | "source";

interface PostEditorProps {
  value: string;
  onChange: (html: string) => void;
  onInsertImageClick: () => void;
  mode?: EditorMode;
  onModeChange?: (m: EditorMode) => void;
  minHeight?: number;
}

export function PostEditor({
  value, onChange, onInsertImageClick,
  mode = "rich", onModeChange,
  minHeight = 500,
}: PostEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      LinkExt.configure({ openOnClick: false }),
      ImageExt,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow, TableHeader, TableCell,
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none focus:outline-none" },
    },
  });

  // When the parent flips mode rich→source, sync the latest Tiptap HTML out
  // first; when flipping source→rich, push the textarea value into Tiptap.
  useEffect(() => {
    if (!editor) return;
    if (mode === "rich" && editor.getHTML() !== value) {
      editor.commands.setContent(value, false, { preserveWhitespace: "full" });
    }
  }, [mode, value, editor]);

  if (!editor) return null;

  const flip = () => onModeChange?.(mode === "rich" ? "source" : "rich");

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b p-2">
        {mode === "rich" ? (
          <>
            <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} icon={Bold} />
            <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} icon={Italic} />
            <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} icon={UIcon} />
            <Sep />
            <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} icon={Heading2} />
            <ToolbarButton active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} icon={Heading3} />
            <Sep />
            <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} icon={List} />
            <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={ListOrdered} />
            <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} icon={Quote} />
            <Sep />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().setTextAlign("left").run()} icon={AlignLeft} />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().setTextAlign("center").run()} icon={AlignCenter} />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().setTextAlign("right").run()} icon={AlignRight} />
            <Sep />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} icon={TableIcon} />
            <ToolbarButton active={false} onClick={() => {
              const url = window.prompt("Link URL");
              if (url) editor.chain().focus().setLink({ href: url }).run();
            }} icon={Link2} />
            <ToolbarButton active={false} onClick={onInsertImageClick} icon={ImageIcon} />
            <Sep />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().undo().run()} icon={Undo} />
            <ToolbarButton active={false} onClick={() => editor.chain().focus().redo().run()} icon={Redo} />
            <div className="ml-auto" />
            <Button type="button" size="sm" variant="ghost" onClick={flip} className="h-7 px-2 text-xs">
              <Code2 className="mr-1 h-3.5 w-3.5" /> Source
            </Button>
          </>
        ) : (
          <>
            <span className="px-2 text-xs text-muted-foreground">HTML source</span>
            <div className="ml-auto" />
            <Button type="button" size="sm" variant="ghost" onClick={flip} className="h-7 px-2 text-xs">
              ← Back to rich
            </Button>
          </>
        )}
      </div>

      {mode === "rich" ? (
        <EditorContent
          editor={editor}
          className="p-4 prose prose-sm max-w-none focus-within:outline-none"
          style={{ minHeight }}
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full resize-y border-0 bg-background p-4 font-mono text-xs leading-relaxed focus:outline-none"
          spellCheck={false}
          style={{ minHeight }}
        />
      )}
    </div>
  );
}

function ToolbarButton({ active, onClick, icon: Icon }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Button type="button" variant={active ? "secondary" : "ghost"} size="sm" onClick={onClick} className="h-7 w-7 p-0">
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}
function Sep() { return <span className="mx-1 h-5 w-px bg-border" />; }
```

Verify: `npx tsc --noEmit` clean.

```bash
git add src/components/blog/PostEditor.tsx package.json package-lock.json
git commit -m "feat(blog/ui): PostEditor — source-mode toggle + tables + underline + text-align"
```

---

## Task 7: Templates pages + HtmlPreview component

**Files:**
- `src/components/blog/HtmlPreview.tsx`
- `src/pages/dashboard/BlogTemplates.tsx`
- `src/pages/dashboard/BlogTemplateDetail.tsx`

**`HtmlPreview.tsx` — sandboxed iframe preview:**

```tsx
import { useMemo } from "react";

interface Props {
  html: string;
  className?: string;
  style?: React.CSSProperties;
}

export function HtmlPreview({ html, className, style }: Props) {
  const srcDoc = useMemo(() => `<!DOCTYPE html><html><head><base target="_blank" /><style>
body { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; line-height: 1.5; color: #1f2937; padding: 12px; margin: 0; }
h2 { font-size: 18px; margin: 12px 0 6px; }
h3 { font-size: 15px; margin: 10px 0 5px; }
p { margin: 6px 0; }
table { border-collapse: collapse; margin: 8px 0; width: 100%; }
th, td { border: 1px solid #e5e7eb; padding: 4px 6px; text-align: left; }
th { background: #f3f4f6; }
ul, ol { padding-left: 20px; }
a { color: #2563eb; text-decoration: underline; }
img { max-width: 100%; height: auto; }
</style></head><body>${html}</body></html>`, [html]);

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox=""
      className={className}
      style={style}
      title="Preview"
    />
  );
}
```

**`BlogTemplates.tsx` — list page:**

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { deleteTemplate, listTemplates } from "@/lib/blog/api-client";
import { HtmlPreview } from "@/components/blog/HtmlPreview";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function BlogTemplates() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["blog-templates"],
    queryFn: () => listTemplates(),
  });
  const templates = data?.templates ?? [];

  const del = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => { toast.success("Archived"); qc.invalidateQueries({ queryKey: ["blog-templates"] }); },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Templates <span className="ml-2 text-sm font-normal text-muted-foreground">{templates.length}</span></h1>
        <Link to="/dashboard/blog/templates/new"><Button><Plus className="mr-1 h-4 w-4" /> New template</Button></Link>
      </div>
      {isLoading ? <div>Loading…</div> : templates.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No templates yet. <Link to="/dashboard/blog/templates/new" className="underline">Create one</Link>.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map(t => (
            <div key={t.id} className="overflow-hidden rounded-md border bg-card">
              <HtmlPreview html={t.body_html} style={{ width: "100%", height: 180, border: "none", display: "block" }} />
              <div className="space-y-1 p-3">
                <div className="font-medium">{t.name}</div>
                {t.description && <div className="text-xs text-muted-foreground">{t.description}</div>}
                <div className="flex gap-2 pt-2">
                  <Link to={`/dashboard/blog/templates/${t.id}`}>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs"><Pencil className="mr-1 h-3 w-3" /> Edit</Button>
                  </Link>
                  <Link to={`/dashboard/blog/posts/new?template=${t.id}`}>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">Use in new post</Button>
                  </Link>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs ml-auto" onClick={() => del.mutate(t.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**`BlogTemplateDetail.tsx` — create/edit page:**

```tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PostEditor, type EditorMode } from "@/components/blog/PostEditor";
import { createTemplate, getTemplate, updateTemplate } from "@/lib/blog/api-client";
import { toast } from "sonner";
import { Upload } from "lucide-react";

export default function BlogTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["blog-template", id],
    queryFn: () => getTemplate(id!),
    enabled: !isNew,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body_html, setBodyHtml] = useState("");
  const [mode, setMode] = useState<EditorMode>("source");

  useEffect(() => {
    if (data?.template) {
      setName(data.template.name);
      setDescription(data.template.description ?? "");
      setBodyHtml(data.template.body_html);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createTemplate({ name, description: description || undefined, body_html });
      await updateTemplate(id!, { name, description: description || null, body_html });
      return { id: id! };
    },
    onSuccess: (r) => {
      toast.success(isNew ? "Created" : "Saved");
      qc.invalidateQueries({ queryKey: ["blog-templates"] });
      navigate(`/dashboard/blog/templates`);
    },
    onError: (e: any) => toast.error(`Save failed: ${e?.message ?? e}`),
  });

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { toast.error("File > 1MB"); return; }
    file.text().then((text) => { setBodyHtml(text); toast.success(`Loaded ${file.name}`); });
  }

  if (!isNew && isLoading) return <div>Loading…</div>;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{isNew ? "New template" : `Edit: ${name}`}</h1>
      <div className="space-y-4">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly Market Update" />
        </div>
        <div>
          <Label>Description (optional)</Label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="When to use this template" />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Body HTML</Label>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-3.5 w-3.5" /> Upload .html
            </Button>
            <input ref={fileRef} type="file" accept=".html,text/html" className="hidden" onChange={onUpload} />
          </div>
          <PostEditor
            value={body_html}
            onChange={setBodyHtml}
            onInsertImageClick={() => toast.info("Image insert: use Post editor; templates should stay text-only for now")}
            mode={mode}
            onModeChange={setMode}
            minHeight={400}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={!name || !body_html || save.isPending}>Save</Button>
          <Button variant="outline" onClick={() => navigate("/dashboard/blog/templates")}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
```

Verify: `npx tsc --noEmit` clean.

```bash
git add src/components/blog/HtmlPreview.tsx src/pages/dashboard/BlogTemplates.tsx src/pages/dashboard/BlogTemplateDetail.tsx
git commit -m "feat(blog/ui): Templates list + create/edit pages + HTML preview"
```

---

## Task 8: AI Draft Modal + wire onto BlogPostDetail compose

**Files:**
- `src/components/blog/AIDraftModal.tsx`
- `src/pages/dashboard/BlogPostDetail.tsx` (modify)

**`AIDraftModal.tsx`:**

```tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { generateAIDraft, listTemplates } from "@/lib/blog/api-client";
import type { AIDraftResult } from "@/lib/blog/types";
import { HtmlPreview } from "./HtmlPreview";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  onAccept: (html: string) => void;
  currentHtml: string;
}

export function AIDraftModal({ open, onClose, onAccept, currentHtml }: Props) {
  const [prompt, setPrompt] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [length, setLength] = useState<"short" | "standard" | "long">("standard");
  const [tone, setTone] = useState<"professional" | "casual" | "data_driven">("professional");
  const [result, setResult] = useState<AIDraftResult | null>(null);

  const { data: tplData } = useQuery({
    queryKey: ["blog-templates"], queryFn: () => listTemplates(), enabled: open,
  });
  const templates = tplData?.templates ?? [];

  const gen = useMutation({
    mutationFn: () => generateAIDraft({
      prompt, template_id: templateId || null, length, tone,
    }),
    onSuccess: (r) => setResult(r),
    onError: (e: any) => toast.error(`Generation failed: ${e?.message ?? e}`),
  });

  function reset() { setResult(null); setPrompt(""); setTemplateId(""); }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Generate post with AI</DialogTitle></DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div>
              <Label>Template (optional)</Label>
              <select
                value={templateId}
                onChange={e => setTemplateId(e.target.value)}
                className="block w-full rounded-md border bg-background p-2 text-sm"
              >
                <option value="">— None —</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">Provides structural HTML the AI fills in.</p>
            </div>
            <div>
              <Label>What should this post be about? *</Label>
              <Textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder='e.g. "Punta Gorda May 2026 market update — median price up, inventory tightening, mortgage rates at 6.5%."'
                rows={5}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Length</Label>
                <div className="flex gap-1 pt-1">
                  {(["short", "standard", "long"] as const).map(l => (
                    <Button key={l} size="sm" variant={length === l ? "default" : "outline"} onClick={() => setLength(l)} type="button">{l}</Button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Tone</Label>
                <div className="flex gap-1 pt-1">
                  {(["professional", "casual", "data_driven"] as const).map(t => (
                    <Button key={t} size="sm" variant={tone === t ? "default" : "outline"} onClick={() => setTone(t)} type="button">{t.replace("_", " ")}</Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => gen.mutate()} disabled={prompt.length < 3 || gen.isPending}>
                {gen.isPending ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Generating…</> : "Generate"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Original</div>
                <HtmlPreview html={currentHtml || "<p style='color:#9ca3af'>(empty)</p>"} style={{ width: "100%", height: 320, border: "1px solid #e5e7eb", borderRadius: 4 }} />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Generated</div>
                <HtmlPreview html={result.html} style={{ width: "100%", height: 320, border: "1px solid #e5e7eb", borderRadius: 4 }} />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Cost: ${(result.cost_cents / 100).toFixed(2)} · Model: {result.model} · {result.usage.input_tokens} in / {result.usage.output_tokens} out tokens
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setResult(null)}>Regenerate</Button>
              <Button variant="ghost" onClick={onClose}>Discard</Button>
              <Button onClick={() => { onAccept(result.html); reset(); onClose(); }}>Use this</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Modify `BlogPostDetail.tsx`:**

1. Add `useSearchParams` import to read the `?template=ID` query param.
2. Add `mode` state for editor: `const [editorMode, setEditorMode] = useState<EditorMode>("rich");`.
3. Add `templateId` query-param prefill on mount: if URL has `?template=…`, call `getTemplate(id)` → setForm body_html + setEditorMode("source").
4. Above the title input on compose mode, render a row with `[ Start from template ▾ ]  [ ✨ Generate with AI ]`.
5. Wire AIDraftModal as a child; onAccept → setForm body_html + setEditorMode("source").
6. Pass `mode={editorMode} onModeChange={setEditorMode}` to PostEditor.

A condensed patch in unified-diff form is shown in the plan comments — implementer should apply the spirit, keeping all existing behavior intact.

Verify: `npx tsc --noEmit` clean. `npx vitest run lib/blog-engine` — 17/17 expected (12 existing + 5 ai-draft).

```bash
git add src/components/blog/AIDraftModal.tsx src/pages/dashboard/BlogPostDetail.tsx
git commit -m "feat(blog/ui): AI draft modal + wire template picker + AI button onto compose"
```

---

## Task 9: Routes + TopNav

**Files:**
- `src/App.tsx` (modify — add routes for `blog/templates`, `blog/templates/new`, `blog/templates/:id`)
- `src/components/TopNav.tsx` (modify — add "Templates" item to Blog dropdown)

Routes inside the existing Dashboard children:

```tsx
<Route path="blog/templates" element={<BlogTemplates />} />
<Route path="blog/templates/new" element={<BlogTemplateDetail />} />
<Route path="blog/templates/:id" element={<BlogTemplateDetail />} />
```

TopNav: in the `BlogNav` dropdown, add a third `DropdownMenuItem`:

```tsx
<DropdownMenuItem asChild>
  <Link to="/dashboard/blog/templates" className="cursor-pointer">
    <LayoutTemplate className="mr-2 h-3.5 w-3.5" /> Templates
  </Link>
</DropdownMenuItem>
```

Import `LayoutTemplate` from `lucide-react`.

`npx tsc --noEmit` clean.

```bash
git add src/App.tsx src/components/TopNav.tsx
git commit -m "feat(blog/ui): mount templates routes + TopNav link"
```

---

## Task 10: Local smoke + promotion (controller, not subagent)

- [ ] Apply migration 051 via Supabase dashboard SQL editor (or MCP if reconnected)
- [ ] `npm run build` succeeds
- [ ] `/dashboard/blog/templates` loads (empty state)
- [ ] Create a template by pasting HTML + verify it shows up in the list with preview
- [ ] Upload a .html file → fills body → save → preview matches
- [ ] On `/posts/new`, pick the template → body fills + editor flips to Source
- [ ] AI generation: prompt "Punta Gorda May 2026 market update" → modal returns HTML → Use this → editor populated → Publish to Sierra works
- [ ] Cost row appears in `cost_events` with `stage='blog_ai_draft'`
- [ ] HANDOFF.md updated
- [ ] PR feat/blog-templates-ai → dev → staging → main

---

## Definition of Done

1. ✅ Migration 051 applied
2. ✅ PostEditor Source toggle round-trips HTML cleanly
3. ✅ Tables / underline / text-align buttons appear and work
4. ✅ `/dashboard/blog/templates` lists, creates, edits, deletes templates
5. ✅ .html upload populates the source field
6. ✅ Compose page shows "Start from template" picker — picking pre-fills body
7. ✅ "Generate with AI" produces HTML; preview + accept wires into editor
8. ✅ `cost_events` row written for every AI draft (stage `blog_ai_draft`)
9. ✅ `<script>` / `<iframe>` / `<style>` stripped server-side from AI output
10. ✅ tsc clean; vitest 17/17 pass
11. ✅ Promoted feat/blog-templates-ai → dev → staging → main
