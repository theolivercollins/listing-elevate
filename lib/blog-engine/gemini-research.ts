// lib/blog-engine/gemini-research.ts
//
// Lightweight web-grounded research helper for the blog chat. Wraps
// Gemini 2.5 Flash with the googleSearch tool — Gemini returns a synthesised
// answer + citations from real-time search results, which we then hand to
// Claude as a <research> block so the post body can reference current
// numbers without us building a separate scraping pipeline.
//
// Why Gemini and not Claude's web tool: as of 2026-05, the Anthropic web tool
// is paywalled per-call and rate-limited; Gemini's googleSearch grounding is
// free under the standard tier and the citation metadata comes back inline.

import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-2.5-flash";
const MAX_SOURCES = 6;
const MAX_SUMMARY_CHARS = 4000;

export interface ResearchSource {
  url: string;
  title: string;
  snippet?: string;
}

export interface ResearchResult {
  summary: string;
  sources: ResearchSource[];
  cost_cents: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export class GeminiResearchError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "GeminiResearchError";
  }
}

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_client) return _client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiResearchError("GEMINI_API_KEY not set");
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

const SYSTEM = `You are a research assistant for a Florida real-estate team. Use Google Search to gather CURRENT facts, statistics, and direct quotes relevant to the user's topic. Prioritise:
- Public market reports (NAR, FAR, Stellar MLS, Redfin, Zillow, Realtor.com)
- County / city government sources for permits, schools, demographics
- Recent (last 90 days when possible) news from established outlets
- Avoid hyper-local blogs, personal-agent posts, and content farms

Return a tight 200-400 word summary covering the most useful facts. Quote exact numbers where possible. Don't speculate — if you can't verify a stat, say so.`;

/**
 * Pull the citation URLs out of Gemini's groundingMetadata. Shape changed
 * between SDK versions; this is defensive to both `groundingChunks` (newer)
 * and `webSearchQueries`+`citationMetadata` (older).
 */
function extractSources(response: any): ResearchSource[] {
  const sources: ResearchSource[] = [];

  // Newer shape: candidates[0].groundingMetadata.groundingChunks[].web
  const candidates = response?.candidates ?? response?.response?.candidates;
  const meta = candidates?.[0]?.groundingMetadata;
  const chunks = meta?.groundingChunks ?? [];
  for (const c of chunks) {
    const web = c?.web;
    if (web?.uri) {
      sources.push({
        url: web.uri,
        title: web.title || web.uri,
      });
    }
  }

  // Older shape: citationMetadata.citationSources
  const citations = candidates?.[0]?.citationMetadata?.citationSources ?? [];
  for (const c of citations) {
    if (c?.uri && !sources.find((s) => s.url === c.uri)) {
      sources.push({ url: c.uri, title: c.title || c.uri });
    }
  }

  return sources.slice(0, MAX_SOURCES);
}

export async function researchTopic(query: string): Promise<ResearchResult> {
  if (!query.trim()) throw new GeminiResearchError("empty research query");
  const ai = client();

  let response: any;
  try {
    response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: query }] }],
      config: {
        systemInstruction: SYSTEM,
        tools: [{ googleSearch: {} }],
        // googleSearch grounding requires temperature ≤ 1, default 1 is fine.
      },
    });
  } catch (e: any) {
    throw new GeminiResearchError(`Gemini grounding failed: ${e?.message ?? e}`, e);
  }

  const candidates = response?.candidates ?? [];
  const text = candidates?.[0]?.content?.parts
    ?.map((p: any) => p?.text ?? "")
    .join("") ?? "";
  if (!text) throw new GeminiResearchError("Gemini returned no text");

  const summary = text.slice(0, MAX_SUMMARY_CHARS);
  const sources = extractSources(response);

  const usage = response?.usageMetadata ?? {};
  const inTok = usage?.promptTokenCount ?? 0;
  const outTok = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  // Gemini 2.5 Flash: $0.30/MTok input, $2.50/MTok output (with thinking).
  // Round up to whole cents.
  const costCents = Math.ceil((inTok / 1_000_000) * 30 + (outTok / 1_000_000) * 250);

  return {
    summary,
    sources,
    cost_cents: costCents,
    model: MODEL,
    usage: { input_tokens: inTok, output_tokens: outTok },
  };
}
