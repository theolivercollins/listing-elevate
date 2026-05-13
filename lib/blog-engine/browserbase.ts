// lib/blog-engine/browserbase.ts
import Browserbase from '@browserbasehq/sdk';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

// Lazy SDK init. Constructing Browserbase at module load with apiKey: undefined
// throws and crashes the entire cron function on cold start (FUNCTION_INVOCATION_FAILED)
// before any auth check runs. Defer until a method actually needs it.
let _bb: Browserbase | null = null;
function bbClient(): Browserbase {
  if (_bb) return _bb;
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error('BROWSERBASE_API_KEY not set');
  _bb = new Browserbase({ apiKey });
  return _bb;
}

export interface RunInSessionResult<T> {
  result: T;
  sessionId: string;
  replayUrl: string;
}

export interface SessionRunArgs {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  sessionId: string;
}

export async function getOrCreatePersistentContextId(
  existing: string | null,
): Promise<string> {
  if (existing) return existing;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!projectId) throw new Error('BROWSERBASE_PROJECT_ID not set');
  const ctx = await bbClient().contexts.create({ projectId });
  return ctx.id;
}

export async function runInSession<T>(
  contextId: string,
  fn: (args: SessionRunArgs) => Promise<T>,
): Promise<RunInSessionResult<T>> {
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!projectId) throw new Error('BROWSERBASE_PROJECT_ID not set');
  const session = await bbClient().sessions.create({
    projectId,
    browserSettings: {
      context: { id: contextId, persist: true },
      viewport: { width: 1280, height: 800 },
    },
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  const replayUrl = `https://browserbase.com/sessions/${session.id}`;
  try {
    const result = await fn({ browser, context, page, sessionId: session.id });
    return { result, sessionId: session.id, replayUrl };
  } catch (e: any) {
    // Re-throw with sessionId/replay attached so callers (job runner) can
    // surface the replay URL on failure for debugging.
    if (e && typeof e === "object") {
      e.browserbaseSessionId = session.id;
      e.browserbaseReplayUrl = replayUrl;
    }
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}
