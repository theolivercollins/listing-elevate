# Session 2026-07-02 — Supabase auth email templates

Last updated: 2026-07-02

See also:
- [../HANDOFF.md](../HANDOFF.md) — current state (update shipping log when you push)
- [../state/PROJECT-STATE.md](../state/PROJECT-STATE.md) — authoritative state
- [../plans/back-on-track-plan.md](../plans/back-on-track-plan.md) — active roadmap

## What shipped

- Six Supabase Auth email templates imported from the Claude Design project
  "Supabase authentication emails" (component `AuthEmailD`), light-only,
  Inter/system-font stack, no monospace, no external CSS/JS/webfont links:
  `supabase/templates/confirmation.html`, `invite.html`, `magic-link.html`,
  `email-change.html`, `recovery.html`, `reauthentication.html`. Subjects
  manifest at `supabase/templates/subjects.json` (`mailer_subjects_<type>` →
  subject string) is the single source of truth for subject lines.
- `supabase/config.toml` — new file, documents the same six templates for
  local dev / drift tracking (`[auth.email.template.<type>]` blocks with
  `subject` + `content_path`). `project_id = "vrhmaeywqsohlztoouxu"`.
  Confirmed the `content_path`/`subject` TOML keys against the current
  Supabase docs (`customizing-email-templates` guide) before writing.
- `scripts/supabase-auth-emails.ts` — deploy/verify script against the
  Supabase **Management API** (the hosted project isn't linked for
  `supabase db push`). Subcommands: `deploy` (PATCH
  `/v1/projects/<ref>/config/auth` with the six `mailer_subjects_*` +
  `mailer_templates_*_content` keys), `deploy --dry-run` (assemble + print
  byte sizes, no network, no token required), `verify` (GET the live config,
  print subjects + SMTP fields, warn if `smtp_host` is empty), `test-send
  <email>` (POST `/auth/v1/otp` to trigger a real magic-link email end to
  end). Parses with `tsx` (verified via `--dry-run` run, no network).
- `supabase/templates/README.md` — rewritten to document the full set: the
  table of file → Supabase slot → Go-template vars, the `subjects.json`
  manifest, the deploy path, and the caveats below.

## Deployed — LIVE (2026-07-02)

All six templates + subjects were pushed to the hosted (shared dev/staging/prod)
Supabase project `vrhmaeywqsohlztoouxu` via the Management API (`deploy` → HTTP 200).
`verify` confirmed SMTP is healthy: `smtp.resend.com`, sender
`noreply@updates.recasi.com`, sender name `Listing Elevate`,
`external_email_enabled: true`, `mailer_autoconfirm: false`. A live `test-send`
magic-link to `oliver@recasi.com` returned HTTP 200 and the GoTrue auth logs show
the `/otp` request with `error: null` (no SMTP/send failure) — end-to-end delivery
proven. Fresh `sbp_` personal token was stored in `~/credentials-general.md`.

Because Supabase is shared across envs, these templates are live for prod auth
emails immediately (independent of this branch merging — the repo copy is the
source of truth / re-deploy path).

## Reproduce the deploy

Token lives in `~/credentials-general.md` (Supabase access token, personal):

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm exec tsx scripts/supabase-auth-emails.ts deploy
SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm exec tsx scripts/supabase-auth-emails.ts verify
SUPABASE_URL=https://vrhmaeywqsohlztoouxu.supabase.co \
  SUPABASE_ANON_KEY=xxx \
  pnpm exec tsx scripts/supabase-auth-emails.ts test-send you@domain.com
```

`verify` should be run right after `deploy` to confirm the six subjects took,
and to confirm `smtp_host` is non-empty (Resend, not Supabase's 3/hour
built-in mailer). `test-send` is the end-to-end proof: it fires a real
magic-link email through the newly-deployed `magic-link.html` template and
the live SMTP config — check the target inbox (and spam folder).

## SMTP requirement

Auth email (magic-link, 2FA, recovery, invite, confirmation, email-change,
reauthentication) sends via **Resend SMTP**. The From-domain must be a
Resend-verified domain or every auth email 550-fails ("Error sending magic
link email"). Verified sender: `noreply@updates.recasi.com`
(`@listingelevate.com` is blocked — Resend 1-domain plan + GoDaddy DNS; see
memory `project-auth-email-smtp-resend.md`).

## Admin 2FA dependency

The admin email-code 2FA step-up (`AdminEmailVerifyWall`) proves email
possession via the JWT `amr` claim and needs the Magic Link email to render
`{{ .Token }}`. `magic-link.html` keeps both `{{ .ConfirmationURL }}` and
`{{ .Token }}` — removing either would silently break that flow. This
template **supersedes** `magic-link-otp.html`, which is retained on disk for
reference only (not deployed, not read by the new script or config.toml).

## What was tried + failed (if any)

None — no failed approaches this session.

## Questions answered this session

- Confirmed via Supabase docs (`search_docs`) that the config.toml auth email
  template keys are `[auth.email.template.<type>]` with `subject` +
  `content_path`, and that the six auth types are `invite`, `confirmation`,
  `recovery`, `magic_link`, `email_change`, `reauthentication` — matches the
  six templates already on disk.
- Decided the hosted (shared) Supabase project should be managed via the
  Management API script rather than `supabase db push`, since it isn't a
  CLI-linked project and is shared across all three LE environments.

## Cost snapshot

No paid API calls this session (Supabase docs search + local file work only;
deploy/verify/test-send were not run against the live network per this
worktree's "no network/deploy commands" constraint).
