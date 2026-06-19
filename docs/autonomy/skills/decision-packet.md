# decision-packet — orchestrator decision routing to Telegram

Last updated: 2026-06-19

Collects pending decisions from `<stateDir>/decisions/`, deduplicates them, formats a single plain-English numbered list with lettered options (A/B/C…), and posts the packet to the configured Telegram chat. Posted files are moved to `<stateDir>/decisions/posted/` so re-runs are safe and idempotent.

---

## How the orchestrator emits a decision

Write a JSON file to `<stateDir>/decisions/` (default: `.autonomy/state/decisions/`). Filename must end in `.json`. The `id` should be a short slug that names the decision — it is used only for traceability, not for deduplication (dedup is by content: `question + context`).

### Decision schema

```ts
interface Decision {
  /** Stable slug: "feat-xyz-model-choice" */
  id: string;
  /** The question Oliver needs to answer — one focused sentence. */
  question: string;
  /** Ordered list of options; rendered as A, B, C, … */
  options: string[];
  /** Optional: extra context that frames the question. */
  context?: string;
  /** Optional: cost/reversibility/timeline at stake. */
  impact?: string;
  /** Optional: what is blocked until this is answered. */
  blocks?: string;
}
```

### Example file — `.autonomy/state/decisions/model-choice.json`

```json
{
  "id": "scene-scorer-model-choice",
  "question": "Which model should the scene scorer use?",
  "options": [
    "gpt-4o-mini — cheapest, good JSON reliability",
    "claude-haiku — slightly more expensive, stronger reasoning"
  ],
  "context": "The scorer runs once per scene per property (~8 calls/listing). Cost dominates at scale.",
  "impact": "~$0.002 vs ~$0.004 per scene; either is reversible in config.",
  "blocks": "scene-scorer subagent dispatch (wave 2)"
}
```

### Writing the file in TypeScript

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../scripts/autonomy/config.js";
import type { Decision } from "../scripts/autonomy/decision-packet.js";

const config = loadConfig();
const decisionsDir = path.join(config.stateDir, "decisions");
fs.mkdirSync(decisionsDir, { recursive: true });

const decision: Decision = {
  id: "scene-scorer-model-choice",
  question: "Which model should the scene scorer use?",
  options: ["gpt-4o-mini", "claude-haiku"],
  context: "Cost dominates at scale — ~8 calls per listing.",
  impact: "~$0.002 vs ~$0.004 per scene; reversible.",
  blocks: "scene-scorer subagent dispatch (wave 2)",
};

fs.writeFileSync(
  path.join(decisionsDir, `${decision.id}.json`),
  JSON.stringify(decision, null, 2),
);
```

---

## Sending the daily packet

After emitting all decision files for a planning session, run:

```bash
pnpm exec tsx scripts/autonomy/decision-packet.ts
```

This collects every `*.json` in `<stateDir>/decisions/` (files already in `posted/` are not re-read), deduplicates by `question + context`, formats one Telegram message (chunked at 4096 chars if needed), and moves each posted file to `<stateDir>/decisions/posted/`.

Re-running with no new files is a no-op — nothing is sent and nothing is moved.

---

## Telegram output format

```
[Listing Elevate] 2 pending decisions — please reply with your choices.

1. Which model should the scene scorer use?
   Context: Cost dominates at scale — ~8 calls per listing.
   Impact: ~$0.002 vs ~$0.004 per scene; reversible.
   Blocks: scene-scorer subagent dispatch (wave 2).
   A) gpt-4o-mini — cheapest, good JSON reliability
   B) claude-haiku — slightly more expensive, stronger reasoning

2. Pin Shotstack SDK version?
   A) Yes, pin to 1.7.0
   B) No, use latest
```

---

## Deduplication guarantee

Two decisions with the same `question` and `context` are treated as the same, regardless of `id`, `options`, or file name. The first file (alphabetically) is sent; subsequent duplicates are silently moved to `posted/`. This makes it safe for multiple waves of the orchestrator loop to emit the same question without double-posting.

---

## State directory layout

```
.autonomy/state/decisions/
  model-choice.json        ← pending, emitted by orchestrator
  sdk-version.json         ← pending
  posted/
    earlier-decision.json  ← already sent; never re-read
```

`stateDir` is configured in `.autonomy/config.json` (defaults to `.autonomy/state`). The `decisions/` and `decisions/posted/` subdirectories are created on first use.

---

## Configuration dependency

Both `decision-packet.ts` and the underlying `notify.ts` use `loadConfig()` from `scripts/autonomy/config.ts`. The relevant fields:

| Field | Effect |
|---|---|
| `stateDir` | Root for the `decisions/` directory. |
| `telegram.chatId` | Telegram chat or channel to post to. |
| `telegram.envFile` | Path to a `.env` file containing `TELEGRAM_BOT_TOKEN`. |
| `project` | Project name shown in the Telegram header line. |

See `docs/autonomy/config.md` for the full config reference.
