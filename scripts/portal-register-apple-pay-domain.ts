// One-off: register a domain with Stripe for Apple Pay (and other wallets).
// Usage:
//   tsx scripts/portal-register-apple-pay-domain.ts <domain-name>
//   tsx scripts/portal-register-apple-pay-domain.ts portal.listingelevate.com
//
// Stripe expects the domain to host a verification file at
//   /.well-known/apple-developer-merchantid-domain-association
// with content that matches what Stripe expects. After we create the domain
// record, Stripe verifies by fetching that URL.

import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", "credentials.env");
try {
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // Use whatever's in env already.
}

const domain = process.argv[2];
if (!domain) {
  console.error("Usage: tsx scripts/portal-register-apple-pay-domain.ts <domain-name>");
  process.exit(1);
}

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY missing.");
  process.exit(1);
}

const stripe = new Stripe(key);

console.log(`Registering ${domain} with Stripe for Apple Pay…`);

try {
  const result = await stripe.paymentMethodDomains.create({ domain_name: domain });
  console.log("\nDomain record created:");
  console.log("  id:    ", result.id);
  console.log("  domain:", result.domain_name);
  console.log("  enabled:", result.enabled);
  console.log("\nVerification status by wallet:");
  console.log("  apple_pay:    ", result.apple_pay?.status, result.apple_pay?.status_details?.error_message ?? "");
  console.log("  google_pay:   ", result.google_pay?.status);
  console.log("  link:         ", result.link?.status);
  console.log("  paypal:       ", result.paypal?.status);

  if (result.apple_pay?.status !== "active") {
    console.log("\nApple Pay not yet active. Stripe will attempt verification by");
    console.log(`fetching https://${domain}/.well-known/apple-developer-merchantid-domain-association`);
    console.log("File contents Stripe expects:");
    console.log(`  ${(result as { apple_pay_certificate_url?: string }).apple_pay_certificate_url ?? "(not in response — see Stripe Dashboard → Settings → Payment methods → Apple Pay)"}`);
  }
} catch (e) {
  const err = e as { code?: string; message?: string; raw?: { message?: string } };
  console.error("Failed:", err.raw?.message ?? err.message ?? e);
  if (err.code === "resource_already_exists") {
    console.log("\nAlready registered — trying to retrieve and re-verify…");
    const list = await stripe.paymentMethodDomains.list({ domain_name: domain });
    const existing = list.data[0];
    if (existing) {
      console.log("  id:    ", existing.id);
      console.log("  apple_pay:", existing.apple_pay?.status, existing.apple_pay?.status_details?.error_message ?? "");
      const refreshed = await stripe.paymentMethodDomains.validate(existing.id);
      console.log("\nRe-validation result:");
      console.log("  apple_pay:", refreshed.apple_pay?.status, refreshed.apple_pay?.status_details?.error_message ?? "");
    }
  }
}
