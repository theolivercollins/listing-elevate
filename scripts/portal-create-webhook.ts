// One-off: register a Stripe webhook endpoint for the portal payment flow.
// Usage:
//   tsx scripts/portal-create-webhook.ts <url>
//   tsx scripts/portal-create-webhook.ts https://portal.listingelevate.com/api/portal/stripe-webhook
//
// Reads STRIPE_SECRET_KEY from credentials.env.

import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load credentials.env manually (script may be run outside Vite/Vercel context).
const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", "credentials.env");
try {
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // Fall back to whatever's in the env already.
}

const url = process.argv[2];
if (!url) {
  console.error("Usage: tsx scripts/portal-create-webhook.ts <https://.../api/portal/stripe-webhook>");
  process.exit(1);
}

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY missing. Add it to credentials.env or export it.");
  process.exit(1);
}

const stripe = new Stripe(key);

const endpoint = await stripe.webhookEndpoints.create({
  url,
  enabled_events: [
    "payment_intent.succeeded",
    "checkout.session.completed",
    "invoice.paid",
  ],
  description: "LE portal — payment + invoice events",
});

console.log("\nWebhook endpoint created:");
console.log("  id:    ", endpoint.id);
console.log("  url:   ", endpoint.url);
console.log("  events:", endpoint.enabled_events.join(", "));
console.log("\nSigning secret (add to Vercel as STRIPE_WEBHOOK_SECRET):");
console.log("  " + endpoint.secret);
