import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "../../../../../../../lib/auth.js";
import { getSupabase } from "../../../../../../../lib/client.js";
import { computeClaudeCost } from "../../../../../../../lib/utils/claude-cost.js";
import { isNonProdEnv } from "../../../../../../../lib/env.js";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
  pinned?: boolean;
}

const SYSTEM = `You help the user iterate on a real-estate listing video clip rendered from a static photo using Kling 3.0 Pro or Wan 2.7. You will see the director prompt that produced the clip, the scene metadata, rating, user comment, and any existing future-render instructions.

You have TWO tools — use them proactively:

1. save_future_instruction(instruction) — append a concise directive to the scene's refinement notes. These get applied alongside the director prompt on the NEXT render. Use for small tweaks: "Use slower camera motion", "Emphasize the range-wall tile", "Keep the fireplace in frame longer".

2. update_director_prompt(new_prompt) — rewrite the scene's director prompt entirely. Use when the user wants a structural change: different subject, different camera movement, different framing, or when accumulated refinement notes have grown messy and should be folded cleanly into a single new prompt. Preserve the "LOCKED-OFF CAMERA..." stability preamble if it was there. Write the new prompt as a single paragraph of concrete visual language, not bullet points.

Be decisive. If the user says "make it slower," call save_future_instruction with "Use slower camera motion" — don't ask for confirmation. If the user says "rewrite the prompt to focus on the marble island," call update_director_prompt with a clean new prompt.

You can call multiple tools in one turn (e.g., save an instruction AND rewrite the prompt). After tool calls, add a brief 1-2 sentence confirmation of what you changed.

Keep replies tight. The user can see the video themselves — don't narrate what you can't see; focus on translating their intent into concrete prompt/instruction changes.`;

function sse(res: VercelResponse, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const iterId = String(req.query.iterId ?? "");
  if (!iterId) return res.status(400).json({ error: "iterId required" });
  const body = (req.body ?? {}) as { message?: string };
  const userMessage = (body.message ?? "").trim();
  if (!userMessage) return res.status(400).json({ error: "message required" });

  const supabase = getSupabase();
  const { data: iter, error: iterErr } = await supabase
    .from("prompt_lab_listing_scene_iterations")
    .select("id, scene_id, director_prompt, model_used, rating, user_comment, clip_url, chat_messages, iteration_number")
    .eq("id", iterId)
    .single();
  if (iterErr || !iter) return res.status(404).json({ error: "iteration not found" });

  const { data: scene } = await supabase
    .from("prompt_lab_listing_scenes")
    .select("id, scene_number, room_type, camera_movement, refinement_notes")
    .eq("id", iter.scene_id)
    .single();
  if (!scene) return res.status(404).json({ error: "scene not found" });

  const prior = (iter.chat_messages as ChatMessage[] | null) ?? [];
  const now = new Date().toISOString();
  const userMsg: ChatMessage = { role: "user", content: userMessage, ts: now };

  const context = [
    `Scene ${scene.scene_number}: ${scene.room_type} / ${scene.camera_movement}`,
    `Model: ${iter.model_used}, iteration #${iter.iteration_number}`,
    `Director prompt: ${iter.director_prompt}`,
    iter.rating !== null ? `User rating: ${iter.rating}/5` : `Not rated yet`,
    iter.user_comment ? `User comment: ${iter.user_comment}` : null,
    scene.refinement_notes ? `Existing future-render instructions: ${scene.refinement_notes}` : null,
  ].filter(Boolean).join("\n");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const client = new Anthropic();
  const CHAT_MODEL = "claude-haiku-4-5-20251001";
  let assistantText = "";
  const savedInstructions: string[] = [];

  try {
    const stream = client.messages.stream({
      model: CHAT_MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [
        {
          name: "save_future_instruction",
          description: "Append a concise directive to the scene's refinement notes. Applied alongside the existing director prompt on the next render.",
          input_schema: {
            type: "object",
            properties: {
              instruction: { type: "string", description: "A short imperative like 'Use slower camera motion' or 'Keep more empty space in the frame'" },
            },
            required: ["instruction"],
          },
        },
        {
          name: "update_director_prompt",
          description: "Rewrite the scene's director prompt entirely. Use when the user wants a structural change or when refinement notes should be folded cleanly into a single new prompt.",
          input_schema: {
            type: "object",
            properties: {
              new_prompt: { type: "string", description: "The complete new director prompt. Preserve the 'LOCKED-OFF CAMERA...' stability preamble if present. Single paragraph of concrete visual language." },
            },
            required: ["new_prompt"],
          },
        },
      ],
      messages: [
        { role: "user", content: `Context for this iteration:\n${context}` },
        ...prior.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userMessage },
      ],
    });

    stream.on("text", (delta) => {
      assistantText += delta;
      sse(res, { type: "text", delta });
    });

    const final = await stream.finalMessage();

    // Record token cost for this chat turn (Haiku 4.5 — cheaper than Sonnet).
    // iter.scene_id targets prompt_lab_listing_scenes, not the prod `scenes`
    // table the cost_events FK references — keep it in metadata, leave
    // scene_id null.
    const cost = computeClaudeCost(final.usage, CHAT_MODEL);
    const { error: costErr } = await supabase.from("cost_events").insert({
      property_id: null,
      scene_id: null,
      stage: "chat",
      provider: "anthropic",
      units_consumed: cost.totalTokens,
      unit_type: "tokens",
      cost_cents: Math.round(cost.costCents),
      metadata: { scope: "lab_listing_iteration_chat", iteration_id: iterId, listing_scene_id: iter.scene_id, model: CHAT_MODEL },
      is_test: isNonProdEnv(),
    });
    if (costErr) console.error("[lab-listing-iteration-chat] cost_events insert failed:", costErr);

    let promptUpdated: string | null = null;
    for (const block of final.content) {
      if (block.type === "tool_use" && block.name === "save_future_instruction") {
        const input = block.input as { instruction?: string };
        if (input.instruction) {
          savedInstructions.push(input.instruction.trim());
          sse(res, { type: "saved_instruction", instruction: input.instruction.trim() });
        }
      }
      if (block.type === "tool_use" && block.name === "update_director_prompt") {
        const input = block.input as { new_prompt?: string };
        if (input.new_prompt) {
          promptUpdated = input.new_prompt.trim();
        }
      }
    }

    if (savedInstructions.length > 0) {
      const { data: latestScene } = await supabase
        .from("prompt_lab_listing_scenes")
        .select("refinement_notes")
        .eq("id", scene.id)
        .single();
      const existing = latestScene?.refinement_notes?.trim() ?? "";
      const joined = [existing, ...savedInstructions.map((s) => `- ${s}`)].filter(Boolean).join("\n");
      await supabase.from("prompt_lab_listing_scenes")
        .update({ refinement_notes: joined || null })
        .eq("id", scene.id);
    }

    if (promptUpdated) {
      await supabase.from("prompt_lab_listing_scenes")
        .update({ director_prompt: promptUpdated })
        .eq("id", scene.id);
      sse(res, { type: "prompt_updated", new_prompt: promptUpdated });
    }

    if (!assistantText) {
      const parts: string[] = [];
      if (promptUpdated) parts.push("Director prompt rewritten");
      if (savedInstructions.length > 0) parts.push(`saved: ${savedInstructions.join("; ")}`);
      assistantText = parts.length > 0 ? parts.join(". ") : "(no response)";
      sse(res, { type: "text", delta: assistantText });
    }

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: assistantText,
      ts: new Date().toISOString(),
    };
    const updated = [...prior, userMsg, assistantMsg];

    await supabase.from("prompt_lab_listing_scene_iterations")
      .update({ chat_messages: updated })
      .eq("id", iterId);

    sse(res, {
      type: "done",
      chat_messages: updated,
      saved_instructions: savedInstructions,
    });
    res.end();
  } catch (err) {
    sse(res, { type: "error", message: err instanceof Error ? err.message : String(err) });
    res.end();
  }
}
