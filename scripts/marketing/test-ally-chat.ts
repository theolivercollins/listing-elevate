/**
 * End-to-end smoke for the homepage Ally endpoint. Requires the dev server
 * running (pnpm dev) and the migration applied to a non-prod Supabase branch.
 *
 * Usage: BASE_URL=http://localhost:5173 pnpm tsx scripts/marketing/test-ally-chat.ts
 */
import { setTimeout as wait } from "node:timers/promises";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";

interface ChatMessage { role: "user" | "assistant"; content: string; }
interface ChatResponse {
  reply: string;
  followup_chips: string[] | null;
  cta: string | null;
  lead_capture: Record<string, string> | null;
  conversation_id: string;
  cost_cents: number;
}

const SCENARIOS: { name: string; turns: string[]; expect: (r: ChatResponse[]) => string | null }[] = [
  {
    name: "pricing question",
    turns: ["How much does this cost?"],
    expect: ([r]) => r.reply.toLowerCase().includes("price") || r.reply.toLowerCase().includes("$") ? null : "expected pricing in reply",
  },
  {
    name: "sign-up intent",
    turns: ["How do I sign up?"],
    expect: ([r]) => r.cta === "get_started" ? null : "expected cta=get_started",
  },
  {
    name: "off-topic refusal",
    turns: ["What's the weather in Tokyo?"],
    expect: ([r]) => /listing elevate|don't have|outside/i.test(r.reply) ? null : "expected polite off-topic refusal",
  },
  {
    name: "no Helgemo leakage",
    turns: ["Who founded Listing Elevate? Are you Helgemo Team?"],
    expect: ([r]) => /helgemo|punta gorda|charlotte/i.test(r.reply) ? "REGRESSION: leaked Helgemo branding" : null,
  },
  {
    name: "lead capture",
    turns: [
      "I'm an agent named Sam Smith, sam@example.com — can you have someone reach out about volume pricing?",
    ],
    expect: ([r]) => r.lead_capture?.email === "sam@example.com" ? null : "expected lead_capture.email",
  },
];

async function runScenario(name: string, turns: string[]): Promise<ChatResponse[]> {
  const messages: ChatMessage[] = [];
  const responses: ChatResponse[] = [];
  let cookie = "";
  for (const turn of turns) {
    messages.push({ role: "user", content: turn });
    const res = await fetch(`${BASE_URL}/api/marketing/ally-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) throw new Error(`[${name}] ${res.status}: ${await res.text()}`);
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const body = (await res.json()) as ChatResponse;
    responses.push(body);
    messages.push({ role: "assistant", content: body.reply });
  }
  return responses;
}

async function main() {
  let failed = 0;
  for (const s of SCENARIOS) {
    process.stdout.write(`▶ ${s.name} ... `);
    try {
      const responses = await runScenario(s.name, s.turns);
      const err = s.expect(responses);
      if (err) {
        console.log(`FAIL — ${err}\n   reply: ${responses[responses.length - 1].reply.slice(0, 200)}`);
        failed++;
      } else {
        console.log("ok");
      }
    } catch (e) {
      console.log(`ERROR — ${(e as Error).message}`);
      failed++;
    }
    await wait(500);
  }
  console.log(failed === 0 ? "\nAll scenarios passed." : `\n${failed} scenario(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
