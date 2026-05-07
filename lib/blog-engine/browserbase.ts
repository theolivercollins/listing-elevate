// lib/blog-engine/browserbase.ts
import Browserbase from '@browserbasehq/sdk';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });

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
  const ctx = await bb.contexts.create({ projectId: process.env.BROWSERBASE_PROJECT_ID! });
  return ctx.id;
}

export async function runInSession<T>(
  contextId: string,
  fn: (args: SessionRunArgs) => Promise<T>,
): Promise<RunInSessionResult<T>> {
  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserSettings: {
      context: { id: contextId, persist: true },
      viewport: { width: 1280, height: 800 },
    },
  });

  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const result = await fn({ browser, context, page, sessionId: session.id });
    return {
      result,
      sessionId: session.id,
      replayUrl: `https://browserbase.com/sessions/${session.id}`,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
