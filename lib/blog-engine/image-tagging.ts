// lib/blog-engine/image-tagging.ts

const VOCAB = [
  "aerial", "exterior", "interior", "team", "area", "lifestyle", "event",
  "seasonal_spring", "seasonal_summer", "seasonal_fall", "seasonal_winter",
  "data_chart",
] as const;

export type ImageTag = typeof VOCAB[number];

export interface TagImageInput {
  buffer: Buffer;
  filename: string;
  folderHint?: string;
}

export interface TagImageResult {
  tags: ImageTag[];
  caption: string;
  embedding: number[];
  costCents: number;
}

export interface TagImageDeps {
  vision: (args: { prompt: string; imageBase64: string; mime: string }) => Promise<{ text: string }>;
  embed: (text: string) => Promise<number[]>;
}

function buildPrompt(folderHint?: string): string {
  const vocabList = VOCAB.join(", ");
  const hintLine = folderHint ? `The file is in a folder named "${folderHint}", which may hint at category. ` : "";
  return (
    `${hintLine}` +
    `Categorize this image and write a short caption. Return ONLY JSON in this exact shape, no commentary: ` +
    `{"tags": [...], "caption": "..."}\n\n` +
    `Pick 1-4 tags from this exact list: [${vocabList}]. Use only tags from this list. ` +
    `Caption is one short sentence describing what's in the image.`
  );
}

export async function tagImage(input: TagImageInput, deps: TagImageDeps): Promise<TagImageResult> {
  const prompt = buildPrompt(input.folderHint);
  const imageBase64 = input.buffer.toString("base64");
  const mime = guessMimeFromFilename(input.filename);

  const visionResp = await deps.vision({ prompt, imageBase64, mime });
  let parsed: { tags: string[]; caption: string };
  try {
    const cleaned = visionResp.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (e: any) {
    throw new Error(`tagImage: failed to parse vision response: ${e?.message ?? e}; raw: ${visionResp.text.slice(0, 200)}`);
  }

  const validTags = (parsed.tags ?? []).filter((t): t is ImageTag => (VOCAB as readonly string[]).includes(t));
  const caption = String(parsed.caption ?? "");
  const embedding = await deps.embed(caption + " | " + validTags.join(", "));

  const costCents = 1;

  return { tags: validTags, caption, embedding, costCents };
}

function guessMimeFromFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export const _testing = { VOCAB };
