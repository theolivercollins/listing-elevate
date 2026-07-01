/**
 * "Welcome to Listing Elevate" transactional email template.
 *
 * This is a literal, byte-for-byte copy of supabase/templates/welcome.html,
 * inlined as a string constant so it ships inside the Vercel serverless
 * function bundle. Reading the .html file off disk at runtime is NOT used
 * here on purpose — Vercel's Node function bundler (`@vercel/nft`) traces
 * `import`/`require` statements to decide which files to include in the
 * lambda; a `fs.readFileSync` call on a path string is not reliably traced,
 * so the template could 404-equivalent (ENOENT) in production even though
 * local dev/tests (which run against the real filesystem) would pass.
 *
 * supabase/templates/welcome.html remains the source of truth for design
 * review (see supabase/templates/README.md). If the design changes there,
 * copy the new markup into WELCOME_EMAIL_HTML below in the same commit —
 * a mismatch between the two is a silent design regression, not a build
 * error, so there is no automated check enforcing they stay in sync.
 */

export const WELCOME_EMAIL_SUBJECT = "Welcome to Listing Elevate";

export const WELCOME_EMAIL_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>Welcome to Listing Elevate</title>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
<o:AllowPNG/>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<![endif]-->
<style>
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; }
  body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; }
</style>
</head>
<body style="margin:0; padding:0; background-color:#eeeef2;">

  <!-- Preheader (hidden preview text) -->
  <div style="display:none; visibility:hidden; max-height:0; max-width:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#eeeef2; opacity:0;">
    Your account is ready — upload listing photos and get a cinematic video back, fully automated.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eeeef2;">
    <tr>
      <td align="center" style="padding: 40px 16px;">

        <!--[if mso]>
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td>
        <![endif]-->

        <!-- Main card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; margin:0 auto; background-color:#ffffff; border:1px solid #dddde0; border-radius:14px;">

          <!-- Wordmark -->
          <tr>
            <td align="center" style="padding: 32px 32px 24px 32px;">
              <span style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:20px; font-weight:700; letter-spacing:-0.02em; color:#07080c;">Listing&nbsp;Elevate</span>
            </td>
          </tr>

          <!-- Hairline divider -->
          <tr>
            <td style="padding: 0 32px;">
              <div style="height:1px; line-height:1px; font-size:1px; background-color:#dddde0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td align="center" style="padding: 32px 32px 16px 32px;">
              <p style="margin:0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:28px; font-weight:600; letter-spacing:-0.02em; line-height:1.2; color:#07080c;">
                Welcome to Listing Elevate
              </p>
            </td>
          </tr>

          <!-- Body copy -->
          <tr>
            <td align="center" style="padding: 0 32px 28px 32px;">
              <p style="margin:0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.6; color:#78797e;">
                Hi there,<br /><br />
                Listing Elevate turns your listing photos into a directed, edited, cinematic listing video — fully automated, no editing required. Upload photos for a property and our pipeline handles scene direction, voiceover, and music, then delivers a polished video straight to your dashboard.
              </p>
            </td>
          </tr>

          <!-- Primary CTA button -->
          <tr>
            <td align="center" style="padding: 0 32px 32px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="#07080c" style="border-radius:999px; background-color:#07080c;">
                    <a href="https://listingelevate.com/dashboard" target="_blank" style="display:inline-block; padding:16px 40px; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; font-weight:500; letter-spacing:-0.01em; color:#ffffff; text-decoration:none; border-radius:999px;">
                      Go to your dashboard
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Hairline divider -->
          <tr>
            <td style="padding: 0 32px;">
              <div style="height:1px; line-height:1px; font-size:1px; background-color:#dddde0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Value bullets -->
          <tr>
            <td style="padding: 28px 32px 32px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding: 0 0 16px 0; vertical-align:top; width:22px;">
                    <span style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; font-weight:700; color:#2f6df0;">&#10003;</span>
                  </td>
                  <td style="padding: 0 0 16px 0; vertical-align:top;">
                    <p style="margin:0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:1.5; color:#07080c;">
                      Upload your listing photos — we handle the rest, zero editing required.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0 0 16px 0; vertical-align:top; width:22px;">
                    <span style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; font-weight:700; color:#2f6df0;">&#10003;</span>
                  </td>
                  <td style="padding: 0 0 16px 0; vertical-align:top;">
                    <p style="margin:0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:1.5; color:#07080c;">
                      Cinematic scenes, voiceover, and music generated automatically for every listing.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0; vertical-align:top; width:22px;">
                    <span style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; font-weight:700; color:#2f6df0;">&#10003;</span>
                  </td>
                  <td style="padding:0; vertical-align:top;">
                    <p style="margin:0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:1.5; color:#07080c;">
                      A polished, ready-to-share video delivered straight to your dashboard.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

        <!-- Brand footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; margin:0 auto;">
          <tr>
            <td align="center" style="padding: 24px 16px 0 16px;">
              <p style="margin:0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; color:#9a9ba3;">
                Listing Elevate &middot; Autonomous listing videos
              </p>
              <p style="margin:6px 0 0 0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; color:#b6b6b9;">
                &copy; 2026 Listing Elevate. All rights reserved. Sent because you created a Listing Elevate account.
              </p>
            </td>
          </tr>
        </table>

        <!--[if mso]>
        </td></tr></table>
        <![endif]-->

      </td>
    </tr>
  </table>

</body>
</html>
`;
