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
