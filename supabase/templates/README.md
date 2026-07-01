# Supabase auth email templates

Design source: the Claude Design project **"Supabase authentication emails"**
(component `AuthEmailD`) — light-only, Inter/system-font stack, no monospace,
no external CSS/JS/webfont links. Every file below is self-contained,
inline-styled, table-based HTML (max-width 600px) built to survive Gmail /
Outlook / Apple Mail clipping and stripped `<style>` blocks. Do not add
external CSS/JS or webfont `<link>` tags — the Inter/system-font stack is
intentional (no monospace, per project rule).

## The six Supabase Auth email templates

These six files map 1:1 to Supabase's built-in Auth email slots
(Dashboard → Authentication → Emails, or the `mailer_templates_*_content` /
`mailer_subjects_*` Management API fields). Subjects live in
[`subjects.json`](./subjects.json).

| File | Supabase slot | `mailer_*` type | Go-template vars used |
|---|---|---|---|
| `confirmation.html` | Confirm signup | `confirmation` | `{{ .ConfirmationURL }}`, `{{ .Token }}` |
| `invite.html` | Invite user | `invite` | `{{ .ConfirmationURL }}` |
| `magic-link.html` | Magic Link | `magic_link` | `{{ .ConfirmationURL }}`, `{{ .Token }}` |
| `email-change.html` | Change email address | `email_change` | `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}` |
| `recovery.html` | Reset password | `recovery` | `{{ .ConfirmationURL }}`, `{{ .Token }}` |
| `reauthentication.html` | Reauthentication | `reauthentication` | `{{ .Token }}` |

**`subjects.json`** is a flat manifest of `mailer_subjects_<type>` → subject
string for all six types above. It's read by both `supabase/config.toml`
(local dev / drift tracking) and `scripts/supabase-auth-emails.ts` (hosted
deploy), so it is the single source of truth for subject lines — edit it once
and both consumers pick it up.

## Deploying to the hosted project

The hosted Supabase project (ref `vrhmaeywqsohlztoouxu`, "listingelevate") is
shared across all three LE environments and is **not** managed by
`supabase db push` / `supabase config push` in CI. Template changes ship via
the Management API using `../../scripts/supabase-auth-emails.ts`:

```bash
# Assemble + sanity-check without sending (no token required)
pnpm exec tsx scripts/supabase-auth-emails.ts deploy --dry-run

# Push subjects + templates to the hosted project
SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm exec tsx scripts/supabase-auth-emails.ts deploy

# Confirm what's live (subjects + SMTP config)
SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm exec tsx scripts/supabase-auth-emails.ts verify

# Prove delivery end-to-end (real email, real SMTP)
SUPABASE_URL=... SUPABASE_ANON_KEY=... pnpm exec tsx scripts/supabase-auth-emails.ts test-send you@domain.com
```

`SUPABASE_ACCESS_TOKEN` must be a Supabase **personal access token**
(`sbp_...`) from https://supabase.com/dashboard/account/tokens — not the
service_role or anon key. `supabase/config.toml` documents the same six
templates for local dev / drift tracking (its `content_path`s point at these
files), since the shared hosted project isn't linked for `supabase db push`.

## Important caveats

- **`magic-link.html` supersedes `magic-link-otp.html`.** `magic-link.html`
  is the current, actively-deployed template for the Magic Link slot. It
  still renders both `{{ .ConfirmationURL }}` (sign-in button) and
  `{{ .Token }}` (6-digit code) — **do not remove either variable** — because
  the admin email-code 2FA step-up (`AdminEmailVerifyWall`) depends on the
  `{{ .Token }}` value reaching the user's inbox on this exact template.
  `magic-link-otp.html` is **retained in this directory for reference only**;
  it is not deployed anywhere and is not read by `scripts/supabase-auth-emails.ts`
  or `supabase/config.toml`. Do not delete or move it.
- **`welcome.html` is unchanged** — a separate transactional email (not a
  Supabase Auth template), wired via `lib/email/welcome-template.ts` (byte-for-byte
  inlined copy — see that file's header for why it isn't read off disk at
  runtime) and sent by `api/hooks/welcome-email.ts` via Resend on a Supabase
  Database Webhook (`auth.users` INSERT). Off by default
  (`WELCOME_EMAIL_ENABLED` unset); see that file's header for env vars +
  webhook config. If you edit the design here, copy the new markup into
  `lib/email/welcome-template.ts` in the same commit — there is no automated
  check keeping them in sync.
- **SMTP is Resend, not Supabase's built-in mailer.** Auth email (magic-link,
  2FA, recovery, etc.) sends via Resend SMTP. The From-domain **must** be a
  Resend-verified domain or every auth email 550-fails
  ("Error sending magic link email"). Verified sender as of 2026-07-01:
  `noreply@updates.recasi.com` (`@listingelevate.com` is blocked — Resend
  1-domain plan + GoDaddy DNS). `scripts/supabase-auth-emails.ts verify`
  warns loudly if `smtp_host` comes back empty, which means Supabase's
  built-in mailer (capped at 3 emails/hour) is in effect instead of Resend.
- All six files are self-contained, inline-styled, table-based HTML
  (max-width 600px) — do not add external CSS/JS or webfont `<link>` tags.
  No monospace UI text anywhere (project rule — see root `CLAUDE.md`).
- **Logo asset.** `public/brand/le-email-logo.png` (440x125 PNG) is the
  source file uploaded to the public `brand-assets` Supabase Storage bucket
  at `brand-assets/le-email-logo.png`, which is what all six templates
  reference via `https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/brand-assets/le-email-logo.png`.
  Re-upload/update it with:
  `curl -X POST "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/brand-assets/le-email-logo.png" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "x-upsert: true" -H "Content-Type: image/png" --data-binary @public/brand/le-email-logo.png`
