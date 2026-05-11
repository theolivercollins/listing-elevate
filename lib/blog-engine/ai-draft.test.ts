// lib/blog-engine/ai-draft.test.ts
import { describe, it, expect, vi } from "vitest";
import { generateDraft, _testing } from "./ai-draft";

describe("generateDraft", () => {
  const mkAnthropic = (out: any, usage = { input_tokens: 500, output_tokens: 800 }) => {
    // out can be a JSON object → stringify; or already a string for negative tests.
    const text = typeof out === "string" ? out : JSON.stringify(out);
    return {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text }], usage }) },
    };
  };

  it("returns clean HTML + computed cost on happy path", async () => {
    const anthropic = mkAnthropic({ body_html: "<h2>Hello</h2><p>World</p>", meta_title: "Hello", meta_description: "World", meta_tags: ["test"] });
    const r = await generateDraft({ prompt: "Test", length: "standard", tone: "professional" }, { anthropic } as any);
    expect(r.body_html).toBe("<h2>Hello</h2><p>World</p>");
    expect(r.meta_title).toBe("Hello");
    expect(r.meta_tags).toEqual(["test"]);
    expect(r.html).toBe(r.body_html);  // backwards compat
    expect(r.cost_cents).toBeGreaterThan(0);
    expect(r.model).toMatch(/sonnet/);
    expect(r.usage).toEqual({ input_tokens: 500, output_tokens: 800 });
  });

  it("strips ```json fences", async () => {
    const anthropic = mkAnthropic("```json\n" + JSON.stringify({ body_html: "<p>Hi</p>", meta_title: "Hi", meta_description: "Hi", meta_tags: [] }) + "\n```");
    const r = await generateDraft({ prompt: "T", length: "short", tone: "casual" }, { anthropic } as any);
    expect(r.body_html).toBe("<p>Hi</p>");
  });

  it("strips <script> tags from body_html", async () => {
    const anthropic = mkAnthropic({ body_html: "<p>Real</p><script>alert(1)</script><p>More</p>", meta_title: "x", meta_description: "x", meta_tags: [] });
    const r = await generateDraft({ prompt: "T", length: "short", tone: "casual" }, { anthropic } as any);
    expect(r.body_html).not.toMatch(/<script/i);
    expect(r.body_html).toContain("Real");
    expect(r.body_html).toContain("More");
  });

  it("rejects non-JSON response", async () => {
    const anthropic = mkAnthropic("just some text");
    await expect(
      generateDraft({ prompt: "T", length: "short", tone: "casual" }, { anthropic } as any),
    ).rejects.toThrow(/JSON/i);
  });

  it("includes template HTML in the user message when provided", async () => {
    const anthropic = mkAnthropic({ body_html: "<p>filled</p>", meta_title: "t", meta_description: "d", meta_tags: [] });
    await generateDraft({
      prompt: "Test",
      template_id: "tpl-1",
      template_html: "<h2>{{title}}</h2>",
      length: "standard",
      tone: "professional",
    }, { anthropic } as any);
    const call = anthropic.messages.create.mock.calls[0][0];
    const content = call.messages[0].content;
    const firstText = typeof content === "string" ? content : content[0].text;
    expect(firstText).toContain("<h2>{{title}}</h2>");
  });

  it("computes cost from Sonnet 4.6 pricing", () => {
    // 1M input @ $3 + 1M output @ $15 → 1800¢
    expect(_testing.computeCostCents(1_000_000, 1_000_000)).toBe(1800);
    // 500 in + 800 out: (500*300 + 800*1500) / 1_000_000 = (150_000 + 1_200_000) / 1_000_000 = 1.35¢ → round up to 2
    expect(_testing.computeCostCents(500, 800)).toBe(2);
  });

  it("includes attachments as content blocks", async () => {
    const anthropic = mkAnthropic({ body_html: "<p>filled</p>", meta_title: "t", meta_description: "d", meta_tags: [] });
    await generateDraft({
      prompt: "Test",
      length: "short",
      tone: "professional",
      attachments: [
        { kind: "pdf", filename: "report.pdf", data: "BASE64DATA", media_type: "application/pdf" },
        { kind: "image", filename: "chart.png", data: "IMGDATA", media_type: "image/png" },
        { kind: "text", filename: "stats.csv", data: "median,385000\ndom,28" },
      ],
    }, { anthropic } as any);
    const call = anthropic.messages.create.mock.calls[0][0];
    const content = call.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    // First block is the main text
    expect(content[0].type).toBe("text");
    // Should include document + image + text blocks for attachments
    const types = content.map((b: any) => b.type);
    expect(types).toContain("document");
    expect(types).toContain("image");
    // CSV text attachment appears as a text block with filename header
    const lastText = content.filter((b: any) => b.type === "text").pop();
    expect(lastText.text).toContain("stats.csv");
    expect(lastText.text).toContain("median,385000");
  });

  it("includes paste_data in the user prompt", async () => {
    const anthropic = mkAnthropic({ body_html: "<p>x</p>", meta_title: "t", meta_description: "d", meta_tags: [] });
    await generateDraft({
      prompt: "Test",
      length: "short",
      tone: "professional",
      paste_data: "Median: $385K\nDOM: 28",
    }, { anthropic } as any);
    const call = anthropic.messages.create.mock.calls[0][0];
    const firstText = call.messages[0].content[0].text ?? call.messages[0].content;
    expect(firstText).toContain("Median: $385K");
  });
});
