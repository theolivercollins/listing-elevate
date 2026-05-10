// lib/blog-engine/publishers/sierra/index.ts
import type { Publisher, PublisherOpts, PublishResult, EditResult, TaxonomyResult } from "../types";
import type { BlogPost } from "../../types";
import { runInSession } from "../../browserbase";
import type { SierraCreds } from "./auth";
import { fetchTaxonomy } from "./taxonomy";
import { sierraPublish, type SierraPublishInput } from "./publish";
import { sierraEdit, type SierraEditInput, type EditableField } from "./edit";

export interface SierraPublisherDeps {
  loadImage: (post: BlogPost) => Promise<{ buffer: Buffer; filename: string } | null>;
  diffFields: (post: BlogPost) => Promise<Set<EditableField>>;
}

export interface SessionTrace {
  sessionId: string;
  replayUrl: string;
}

export type SierraPublisher = Publisher & { lastSession?: SessionTrace };

function toCreds(opts: PublisherOpts): SierraCreds {
  if (!opts.siteName) {
    throw new Error("Sierra publisher requires opts.siteName (the customer's public domain)");
  }
  return { siteName: opts.siteName, username: opts.username, password: opts.password };
}

export function createSierraPublisher(deps: SierraPublisherDeps): SierraPublisher {
  const trace: { last?: SessionTrace } = {};

  const publisher: SierraPublisher = {
    async publish(post: BlogPost, opts: PublisherOpts): Promise<PublishResult> {
      const image = await deps.loadImage(post);
      const input: SierraPublishInput = {
        baseUrl: opts.baseUrl,
        creds: toCreds(opts),
        post,
        imageBuffer: image?.buffer ?? null,
        imageFilename: image?.filename ?? null,
      };
      const { result, sessionId, replayUrl } = await runInSession(opts.contextId, async ({ page }) =>
        sierraPublish(page, input),
      );
      trace.last = { sessionId, replayUrl };
      publisher.lastSession = trace.last;
      return result;
    },

    async edit(post: BlogPost, opts: PublisherOpts): Promise<EditResult> {
      const fieldsChanged = await deps.diffFields(post);
      const input: SierraEditInput = {
        baseUrl: opts.baseUrl,
        creds: toCreds(opts),
        post,
        fieldsChanged,
      };
      const { result, sessionId, replayUrl } = await runInSession(opts.contextId, async ({ page }) =>
        sierraEdit(page, input),
      );
      trace.last = { sessionId, replayUrl };
      publisher.lastSession = trace.last;
      return result;
    },

    async fetchTaxonomy(opts: PublisherOpts): Promise<TaxonomyResult> {
      const creds = toCreds(opts);
      const { result, sessionId, replayUrl } = await runInSession(opts.contextId, async ({ page }) =>
        fetchTaxonomy(page, opts.baseUrl, creds),
      );
      trace.last = { sessionId, replayUrl };
      publisher.lastSession = trace.last;
      return result;
    },
  };
  return publisher;
}
