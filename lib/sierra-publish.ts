// Publish a custom listing landing page to a client's Sierra Interactive site.
// Drives Sierra admin via Stagehand v3 (Browserbase + Claude as the action LLM).
// Stagehand's `act()` lets us describe each step in natural language, which
// sidesteps Sierra's unlabeled inputs and randomized CKEditor IDs.
//
// Required env (Vercel preview/prod + local credentials.env):
//   BROWSERBASE_API_KEY
//   BROWSERBASE_PROJECT_ID
//   ANTHROPIC_API_KEY  (already set for the judge)

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

const zErrorMessage = z.object({ message: z.string() });

// Stagehand v3 requires the provider/model format (e.g. anthropic/claude-sonnet-4-5).
const STAGEHAND_MODEL = process.env.STAGEHAND_MODEL || "anthropic/claude-sonnet-4-5";

export interface SierraPublishInput {
  sierraAdminUrl: string;
  sierraSiteName: string;
  sierraAdminUsername: string;
  sierraAdminPassword: string;
  sierraPublicBaseUrl: string;
  /** Sierra section to file the page under (e.g. "Featured"). */
  sierraSection?: string;
  pageSlug: string;
  pageTitle: string;
  /** Full rendered HTML (with inline <style>). We split it server-side. */
  pageHtml: string;
}

/** Split a rendered page into body (no <style>) and the inline CSS contents. */
function splitHtmlAndCss(rendered: string): { htmlBody: string; cssOnly: string } {
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const cssBlocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = styleRegex.exec(rendered)) !== null) {
    cssBlocks.push(match[1].trim());
  }
  const htmlBody = rendered.replace(styleRegex, "").trim();
  const cssOnly = cssBlocks.join("\n\n").trim();
  return { htmlBody, cssOnly };
}

export interface SierraPublishResult {
  ok: boolean;
  sierra_page_url?: string;
  session_url?: string;
  error?: string;
}

export async function publishToSierra(
  input: SierraPublishInput
): Promise<SierraPublishResult> {
  if (!process.env.BROWSERBASE_API_KEY) return { ok: false, error: "BROWSERBASE_API_KEY not set" };
  if (!process.env.BROWSERBASE_PROJECT_ID) return { ok: false, error: "BROWSERBASE_PROJECT_ID not set" };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY not set" };

  const adminUrl = input.sierraAdminUrl.replace(/\/+$/, "");
  const publicBase = input.sierraPublicBaseUrl.replace(/\/+$/, "");
  const slug = `walkthrough/${input.pageSlug.replace(/^\/+/, "")}`;

  let stagehand: Stagehand;
  try {
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      model: {
        modelName: STAGEHAND_MODEL,
        apiKey: process.env.ANTHROPIC_API_KEY,
        provider: "anthropic",
      },
      // Pino's worker-thread logger breaks in Vercel serverless.
      disablePino: true,
      verbose: 0,
      // Retry act() with refined instructions if the first attempt doesn't
      // change page state (silent failures kill us otherwise).
      selfHeal: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sierra-publish] Stagehand constructor failed:", message);
    return { ok: false, error: `Stagehand init: ${message}` };
  }

  let sessionUrl: string | undefined;
  try {
    await stagehand.init();
    sessionUrl = stagehand.browserbaseSessionURL;

    const page = stagehand.context.activePage();
    if (!page) throw new Error("Stagehand: no active page after init");

    // 1) Login.
    await page.goto(`${adminUrl}/login.aspx`, { waitUntil: "networkidle", timeoutMs: 60_000 });
    await stagehand.act(`Type "${input.sierraSiteName}" into the Site Name field`);
    await stagehand.act(`Type "${input.sierraAdminUsername}" into the Username field`);
    await stagehand.act(`Type "${input.sierraAdminPassword}" into the Password field`);
    await stagehand.act("Click the Login button");
    await sleep(2000);

    if (/\/login\.aspx/i.test(page.url())) {
      throw new Error(`Sierra login failed (still on /login.aspx). Watch session: ${sessionUrl}`);
    }

    // 2) Navigate to content-pages list, then click the "Add" action.
    await page.goto(`${adminUrl}/content-pages.aspx`, { waitUntil: "networkidle", timeoutMs: 60_000 });
    await stagehand.act("Click the button or link to add a new content page");
    await sleep(2000);

    // 3) Fill Title + URL slug + Section.
    await stagehand.act(`Set the page Title field to "${input.pageTitle}"`);
    await stagehand.act(`Set the page URL slug field to "${slug}"`);
    const section = input.sierraSection || "Featured";
    await stagehand.act(`Select "${section}" from the page Section dropdown`);

    // 4) Save the initial page (creates the page record so we can add widgets).
    await stagehand.act("Click the Save button to save this content page");
    await sleep(3500);

    // 5) Add Shared HTML Widget #1 with the HTML body.
    const { htmlBody, cssOnly } = splitHtmlAndCss(input.pageHtml);
    const cssWrapped = cssOnly ? `<style>\n${cssOnly}\n</style>` : "";

    if (htmlBody) {
      await stagehand.act("Click 'Add New Page Component' to add a new component to this page");
      await sleep(1500);
      await stagehand.act("Choose 'Shared HTML Widget' from the component type list");
      await sleep(2000);
      // Configure the new widget — Sierra prompts for a name, then HTML.
      await stagehand.act(
        `Set the widget Name to "${input.pageTitle} — HTML"`
      );
      // Paste the HTML body into the widget's HTML editor (source/code view).
      const htmlPasted = await page.evaluate((body: string) => {
        const w = globalThis as unknown as {
          CKEDITOR?: { instances?: Record<string, { setData: (s: string) => void }> };
          document?: { querySelectorAll: (sel: string) => ArrayLike<unknown> };
        };
        if (w.CKEDITOR?.instances) {
          const keys = Object.keys(w.CKEDITOR.instances);
          if (keys.length > 0) {
            w.CKEDITOR.instances[keys[0]].setData(body);
            return `ckeditor:${keys[0]}`;
          }
        }
        const tas = (w.document?.querySelectorAll("textarea") || []) as ArrayLike<unknown>;
        for (let i = 0; i < tas.length; i++) {
          const ta = tas[i] as {
            offsetWidth?: number;
            offsetHeight?: number;
            id?: string;
            value: string;
            dispatchEvent: (e: unknown) => void;
          };
          // Pick the largest visible textarea on the page (the widget editor).
          if ((ta.offsetWidth || 0) * (ta.offsetHeight || 0) > 50_000) {
            ta.value = body;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const Event = (globalThis as any).Event as new (n: string, o?: unknown) => unknown;
            ta.dispatchEvent(new Event("input", { bubbles: true }));
            ta.dispatchEvent(new Event("change", { bubbles: true }));
            return `textarea:${ta.id || "(no-id)"}`;
          }
        }
        return "none";
      }, htmlBody);
      if (htmlPasted === "none") {
        throw new Error(`Could not paste HTML body into widget editor. Watch: ${sessionUrl}`);
      }
      await stagehand.act("Click the Save button on this widget configuration");
      await sleep(2500);
    }

    // 6) Add Shared HTML Widget #2 with the CSS.
    if (cssWrapped) {
      await stagehand.act("Click 'Add New Page Component' to add another component");
      await sleep(1500);
      await stagehand.act("Choose 'Shared HTML Widget' from the component type list");
      await sleep(2000);
      await stagehand.act(
        `Set the widget Name to "${input.pageTitle} — CSS"`
      );
      const cssPasted = await page.evaluate((css: string) => {
        const w = globalThis as unknown as {
          CKEDITOR?: { instances?: Record<string, { setData: (s: string) => void }> };
          document?: { querySelectorAll: (sel: string) => ArrayLike<unknown> };
        };
        if (w.CKEDITOR?.instances) {
          const keys = Object.keys(w.CKEDITOR.instances);
          if (keys.length > 0) {
            w.CKEDITOR.instances[keys[0]].setData(css);
            return `ckeditor:${keys[0]}`;
          }
        }
        const tas = (w.document?.querySelectorAll("textarea") || []) as ArrayLike<unknown>;
        for (let i = 0; i < tas.length; i++) {
          const ta = tas[i] as {
            offsetWidth?: number;
            offsetHeight?: number;
            id?: string;
            value: string;
            dispatchEvent: (e: unknown) => void;
          };
          if ((ta.offsetWidth || 0) * (ta.offsetHeight || 0) > 50_000) {
            ta.value = css;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const Event = (globalThis as any).Event as new (n: string, o?: unknown) => unknown;
            ta.dispatchEvent(new Event("input", { bubbles: true }));
            ta.dispatchEvent(new Event("change", { bubbles: true }));
            return `textarea:${ta.id || "(no-id)"}`;
          }
        }
        return "none";
      }, cssWrapped);
      if (cssPasted === "none") {
        throw new Error(`Could not paste CSS into widget editor. Watch: ${sessionUrl}`);
      }
      await stagehand.act("Click the Save button on this widget configuration");
      await sleep(2500);
    }

    // 7) Final save of the content page (after both widgets are attached).
    await stagehand.act("Click the Save button to save the content page with all its components");
    await sleep(3500);

    // 6) Verify the page was actually created. Sierra silently rejects
    // duplicate slugs / missing fields / etc. — without this check we'd lie
    // about success when nothing landed.
    const sierra_page_url = `${publicBase}/${slug.replace(/^\/+/, "")}`;
    let verifyStatus = 0;
    try {
      const verifyResp = await fetch(sierra_page_url, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (LE publish-verify)" },
      });
      verifyStatus = verifyResp.status;
    } catch (e) {
      verifyStatus = -1;
    }
    if (verifyStatus !== 200) {
      // Best-effort: capture what's on the admin page so we can debug.
      const adminUrlNow = page.url();
      const visibleErr = await stagehand
        .extract(
          "Find any visible error message, validation warning, or notice on the page that explains why the save didn't complete. If none, return 'no visible error'.",
          zErrorMessage
        )
        .then((r) => r.message)
        .catch(() => "extract failed");
      throw new Error(
        `Page not live after save (GET ${sierra_page_url} returned ${verifyStatus}). ` +
          `Admin page is now at ${adminUrlNow}. Sierra error text: "${visibleErr}". ` +
          `Watch the recording: ${sessionUrl}`
      );
    }

    return { ok: true, sierra_page_url, session_url: sessionUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("[sierra-publish] error:", message, "\n", stack);
    return { ok: false, error: message, session_url: sessionUrl };
  } finally {
    await stagehand.close().catch(() => null);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
