// Verify the OPERATOR/client → 15s template path end-to-end through the real
// pipeline functions: buildTemplateModifications (operator-derived fields) +
// mergeBrandVars (client brand kit). Proves the client's headshot + phone reach
// the template's Image-Headshot / Text-Phone-Number elements, overriding the
// operator's own profile phone. Run: npx tsx scripts/verify-operator-15s.ts

import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

import { CreatomateProvider } from "../lib/providers/creatomate.js";
import { pollAssemblyJob } from "../lib/providers/assembly-router.js";
import { buildTemplateModifications } from "../lib/assembly/template-modifications.js";
import { brandKitFromClient, mergeBrandVars } from "../lib/operator-studio/brand-kit.js";
import type { ClientRow } from "../lib/types/operator-studio.js";

const TEMPLATE_ID = "075d3024-b727-4dde-bdc1-cd15a4929882";
const SAMPLE_VIDEO = "https://mdn.github.io/shared-assets/videos/flower.mp4";

// A client (operator listing). agent details + phone + headshot live here.
const client: ClientRow = {
  id: "client-1", name: "The Helgemo Team | Compass",
  contact_email: null, phone: "c: 941.205.9011", monthly_rate_cents: null, notes: null,
  brand_logo_url: null, brand_primary_hex: null, brand_secondary_hex: null,
  agent_name: "Abby Helgemo, Realtor", agent_headshot_url: "https://i.pravatar.cc/600?img=45",
  voice_id: null, archived_at: null, created_at: "", updated_at: "",
};

async function main() {
  const provider = new CreatomateProvider();

  // 1. Operator-derived mods. agentName/brokerage come from property
  //    (listing_agent = client.agent_name, brokerage = client.name).
  //    agentPhone here is the OPERATOR's profile phone — must be overridden.
  let mods = buildTemplateModifications({
    address: "2750 Palm Tree Dr, Punta Gorda, FL",
    selectedPackage: "just_listed",
    agentName: client.agent_name!,
    brokerageName: client.name,
    agentPhone: "OPERATOR-PROFILE-PHONE-555",
    clips: Array.from({ length: 5 }, () => ({ url: SAMPLE_VIDEO, durationSeconds: 3 })),
  });

  // 2. Client brand injection (the real operator path).
  mods = mergeBrandVars(mods, brandKitFromClient(client, { brokerage: client.name }));

  console.log("Text-Phone-Number.text:", mods["Text-Phone-Number.text"], "(expect client phone, NOT operator)");
  console.log("Image-Headshot.source:", mods["Image-Headshot.source"], "(expect client headshot)");
  if (mods["Text-Phone-Number.text"] === "OPERATOR-PROFILE-PHONE-555") {
    throw new Error("FAIL: operator phone was NOT overridden by client phone");
  }

  console.log("\nSubmitting render…");
  const job = await provider.assembleFromTemplate(TEMPLATE_ID, { modifications: mods, renderScale: 1 });
  const result = await pollAssemblyJob(provider, job);
  console.log("status:", result.status);
  console.log("video URL:", result.videoUrl);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
