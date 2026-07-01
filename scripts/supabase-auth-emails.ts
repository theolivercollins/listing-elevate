#!/usr/bin/env -S npx tsx
/**
 * scripts/supabase-auth-emails.ts
 *
 * Deploy + verify the six Supabase Auth email templates (confirmation, invite,
 * magic-link, email-change, recovery, reauthentication) living in
 * `supabase/templates/*.html` + `supabase/templates/subjects.json`, and prove
 * end-to-end delivery through the project's SMTP (Resend, verified sender
 * noreply@updates.recasi.com).
 *
 * The hosted Supabase project (ref vrhmaeywqsohlztoouxu, "listingelevate") is
 * shared across all three LE environments and is NOT managed by
 * `supabase db push` / `supabase config push` (no linked CLI project in CI).
 * This script pushes templates directly via the Supabase Management API
 * instead, so a human (or an agent holding a personal access token) can ship
 * template edits without a full CLI link.
 *
 * Required env vars:
 *   SUPABASE_ACCESS_TOKEN   Supabase personal access token ("sbp_...") from
 *                           https://supabase.com/dashboard/account/tokens
 *                           (Account -> Access Tokens). This is NOT the
 *                           service_role key or anon key — it's a personal
 *                           token scoped to your Supabase account, used to
 *                           call the Management API (api.supabase.com).
 *                           Required for `deploy` and `verify`.
 *   SUPABASE_URL            Project URL, e.g. https://vrhmaeywqsohlztoouxu.supabase.co
 *                           Required for `test-send`.
 *   SUPABASE_ANON_KEY       Project anon/publishable key. Required for `test-send`.
 *
 * Project ref defaults to vrhmaeywqsohlztoouxu ("listingelevate"). Override with
 * `--ref=<ref>` or `SUPABASE_PROJECT_REF`.
 *
 * Subcommands:
 *
 *   deploy (default)
 *     Reads the six template files + subjects.json, PATCHes
 *     https://api.supabase.com/v1/projects/<ref>/config/auth with the
 *     mailer_subjects_* and mailer_templates_*_content keys.
 *       SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm exec tsx scripts/supabase-auth-emails.ts deploy
 *
 *   deploy --dry-run
 *     Assembles the same request body but does NOT send it. Prints each key
 *     + its byte length and asserts every template file exists. No token
 *     required.
 *       pnpm exec tsx scripts/supabase-auth-emails.ts deploy --dry-run
 *
 *   verify
 *     GETs the current hosted auth config and prints the six
 *     mailer_subjects_* values plus the SMTP-relevant fields (smtp_host,
 *     smtp_admin_email, smtp_sender_name, external_email_enabled,
 *     mailer_autoconfirm). Warns loudly if smtp_host is empty — that means
 *     Supabase's built-in mailer (3 emails/hour cap) is in effect, not Resend.
 *       SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm exec tsx scripts/supabase-auth-emails.ts verify
 *
 *   test-send <email>
 *     POSTs to <SUPABASE_URL>/auth/v1/otp with { email, create_user: false }
 *     to trigger a REAL magic-link email through the deployed template + SMTP
 *     — the way to prove delivery end-to-end.
 *       SUPABASE_URL=https://vrhmaeywqsohlztoouxu.supabase.co \
 *       SUPABASE_ANON_KEY=xxx \
 *       pnpm exec tsx scripts/supabase-auth-emails.ts test-send you@domain.com
 *
 * Exit codes: 0 on success, 1 on failure (bad args, non-2xx response, etc).
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Load .env if present, without overriding already-set process.env vars
// (matches the convention used by scripts/cost-reconcile.ts).
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const DEFAULT_REF = "vrhmaeywqsohlztoouxu";
const TEMPLATES_DIR = path.join(process.cwd(), "supabase", "templates");
const MANAGEMENT_API = "https://api.supabase.com/v1";

// file basename (without .html) -> Supabase mailer_* type suffix
const TEMPLATE_FILE_TO_TYPE: Record<string, string> = {
  confirmation: "confirmation",
  invite: "invite",
  "magic-link": "magic_link",
  "email-change": "email_change",
  recovery: "recovery",
  reauthentication: "reauthentication",
};

interface Subjects {
  [key: string]: string;
}

function usage(): string {
  return `Usage: pnpm exec tsx scripts/supabase-auth-emails.ts <command> [options]

Commands:
  deploy [--dry-run]     Push the six auth email templates + subjects to the
                          hosted Supabase project via the Management API.
                          --dry-run assembles the body but does not send it.
  verify                 Fetch + print the current hosted auth email config.
  test-send <email>      Trigger a real magic-link email via /auth/v1/otp to
                          prove SMTP delivery end-to-end.

Options:
  --ref=<ref>             Project ref (default: ${DEFAULT_REF}, or $SUPABASE_PROJECT_REF)

Examples:
  SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm exec tsx scripts/supabase-auth-emails.ts deploy
  pnpm exec tsx scripts/supabase-auth-emails.ts deploy --dry-run
  SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm exec tsx scripts/supabase-auth-emails.ts verify
  SUPABASE_URL=... SUPABASE_ANON_KEY=... pnpm exec tsx scripts/supabase-auth-emails.ts test-send you@domain.com
`;
}

function parseFlag(flag: string): string | undefined {
  const prefix = `${flag}=`;
  const arg = process.argv.find((a) => a === flag || a.startsWith(prefix));
  if (!arg) return undefined;
  if (arg === flag) return "true";
  return arg.slice(prefix.length);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getRef(): string {
  return parseFlag("--ref") ?? process.env.SUPABASE_PROJECT_REF ?? DEFAULT_REF;
}

function readSubjects(): Subjects {
  const subjectsPath = path.join(TEMPLATES_DIR, "subjects.json");
  if (!fs.existsSync(subjectsPath)) {
    throw new Error(`Missing ${subjectsPath}`);
  }
  return JSON.parse(fs.readFileSync(subjectsPath, "utf8"));
}

function assembleBody(): { body: Record<string, string>; fileSizes: Record<string, number> } {
  const subjects = readSubjects();
  const body: Record<string, string> = {};
  const fileSizes: Record<string, number> = {};

  // Subjects — allowlist-guarded: only the six known mailer_subjects_<type>
  // keys may reach this PATCH body, since it writes directly to shared-prod
  // auth config. Anything else in subjects.json is a mistake, not a feature.
  const allowedSubjectKeys = new Set(
    Object.values(TEMPLATE_FILE_TO_TYPE).map((t) => `mailer_subjects_${t}`)
  );
  for (const [key, value] of Object.entries(subjects)) {
    if (!allowedSubjectKeys.has(key)) {
      throw new Error(`Refusing to deploy unexpected auth-config key from subjects.json: ${key}`);
    }
    body[key] = value;
  }

  // Template HTML content.
  for (const [fileBase, type] of Object.entries(TEMPLATE_FILE_TO_TYPE)) {
    const filePath = path.join(TEMPLATES_DIR, `${fileBase}.html`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing template file: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, "utf8");
    const key = `mailer_templates_${type}_content`;
    body[key] = content;
    fileSizes[key] = Buffer.byteLength(content, "utf8");
  }

  for (const [key, value] of Object.entries(subjects)) {
    fileSizes[key] = Buffer.byteLength(value, "utf8");
  }

  return { body, fileSizes };
}

async function cmdDeploy(): Promise<number> {
  const dryRun = hasFlag("--dry-run");
  const ref = getRef();

  let assembled: { body: Record<string, string>; fileSizes: Record<string, number> };
  try {
    assembled = assembleBody();
  } catch (e) {
    console.error("FAILED to assemble request body:", (e as Error).message);
    return 1;
  }
  const { body, fileSizes } = assembled;

  if (dryRun) {
    console.log(`[dry-run] Would PATCH ${MANAGEMENT_API}/projects/${ref}/config/auth with:`);
    for (const [key, size] of Object.entries(fileSizes)) {
      console.log(`  ${key}: ${size} bytes`);
    }
    console.log(`[dry-run] All ${Object.keys(TEMPLATE_FILE_TO_TYPE).length} template files exist. No request sent.`);
    return 0;
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error(
      "Missing SUPABASE_ACCESS_TOKEN. This must be a Supabase personal access token " +
        "(sbp_...) from https://supabase.com/dashboard/account/tokens — not the " +
        "service_role or anon key."
    );
    return 1;
  }

  console.log(`Deploying auth email templates to project ${ref}...`);
  const res = await fetch(`${MANAGEMENT_API}/projects/${ref}/config/auth`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`FAILED: PATCH returned HTTP ${res.status}`);
    console.error(text);
    return 1;
  }

  console.log(`Success: HTTP ${res.status}. Pushed:`);
  for (const [key, size] of Object.entries(fileSizes)) {
    console.log(`  ${key}: ${size} bytes`);
  }
  return 0;
}

async function cmdVerify(): Promise<number> {
  const ref = getRef();
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error(
      "Missing SUPABASE_ACCESS_TOKEN. This must be a Supabase personal access token " +
        "(sbp_...) from https://supabase.com/dashboard/account/tokens."
    );
    return 1;
  }

  const res = await fetch(`${MANAGEMENT_API}/projects/${ref}/config/auth`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`FAILED: GET returned HTTP ${res.status}`);
    console.error(text);
    return 1;
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(text);
  } catch {
    console.error("FAILED: response was not valid JSON:");
    console.error(text);
    return 1;
  }

  console.log(`Auth config for project ${ref}:\n`);
  console.log("Subjects:");
  const subjectKeys = [
    "mailer_subjects_confirmation",
    "mailer_subjects_invite",
    "mailer_subjects_magic_link",
    "mailer_subjects_email_change",
    "mailer_subjects_recovery",
    "mailer_subjects_reauthentication",
  ];
  for (const key of subjectKeys) {
    console.log(`  ${key}: ${JSON.stringify(config[key] ?? null)}`);
  }

  console.log("\nSMTP config:");
  const smtpKeys = [
    "smtp_host",
    "smtp_admin_email",
    "smtp_sender_name",
    "external_email_enabled",
    "mailer_autoconfirm",
  ];
  for (const key of smtpKeys) {
    console.log(`  ${key}: ${JSON.stringify(config[key] ?? null)}`);
  }

  if (!config.smtp_host) {
    console.warn(
      "\nWARNING: smtp_host is empty. This project is using Supabase's built-in " +
        "mailer, which is capped at 3 emails/hour and does NOT use Resend. " +
        "If real users are expected to receive auth emails, SMTP must be " +
        "configured (Resend, sender noreply@updates.recasi.com)."
    );
  }

  return 0;
}

async function cmdTestSend(email: string | undefined): Promise<number> {
  if (!email) {
    console.error("Usage: test-send <email>");
    return 1;
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("Missing SUPABASE_URL and/or SUPABASE_ANON_KEY.");
    return 1;
  }

  console.log(`Sending test magic-link OTP to ${email} via ${url}/auth/v1/otp ...`);
  const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/otp`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, create_user: false }),
  });

  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  console.log(text);

  if (!res.ok) {
    console.error(
      "\nFAILED. If the error indicates the user does not exist, this address " +
        "must belong to an EXISTING Supabase auth user when create_user is " +
        "false — either use an address that already has an account, or omit " +
        "create_user (defaults to true, which will create one)."
    );
    return 1;
  }

  console.log("\nRequest accepted. Check the inbox (and spam folder) for the magic-link email.");
  return 0;
}

async function main(): Promise<number> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    console.log(usage());
    return 0;
  }

  const args = rawArgs.filter((a) => !a.startsWith("--"));
  const command = args[0] ?? "deploy";

  switch (command) {
    case "deploy":
      return cmdDeploy();
    case "verify":
      return cmdVerify();
    case "test-send":
      return cmdTestSend(args[1]);
    case "--help":
    case "-h":
    case "help":
      console.log(usage());
      return 0;
    default:
      console.error(`Unknown command: "${command}"\n`);
      console.error(usage());
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  });
