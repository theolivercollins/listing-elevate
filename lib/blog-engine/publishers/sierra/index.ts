// lib/blog-engine/publishers/sierra/index.ts
import type { Publisher, PublisherOpts, PublishResult, EditResult, TaxonomyResult } from '../types';
import type { BlogPost } from '../../types';
import { runInSession } from '../../browserbase';
import { fetchTaxonomy } from './taxonomy';
import { sierraPublish, type SierraPublishInput } from './publish';
import { sierraEdit, type SierraEditInput, type EditableField } from './edit';

export interface SierraPublisherDeps {
  loadImage: (post: BlogPost) => Promise<{ buffer: Buffer; filename: string } | null>;
  diffFields: (post: BlogPost) => Promise<Set<EditableField>>;
}

export function createSierraPublisher(deps: SierraPublisherDeps): Publisher & {
  lastSession?: { sessionId: string; replayUrl: string };
} {
  const publisher: any = {
    async publish(post: BlogPost, opts: PublisherOpts): Promise<PublishResult> {
      const image = await deps.loadImage(post);
      const input: SierraPublishInput = {
        baseUrl: opts.baseUrl,
        username: opts.username,
        password: opts.password,
        post,
        imageBuffer: image?.buffer ?? null,
        imageFilename: image?.filename ?? null,
      };
      const { result, sessionId, replayUrl } = await runInSession(opts.contextId, async ({ page }) =>
        sierraPublish(page, input),
      );
      publisher.lastSession = { sessionId, replayUrl };
      return result;
    },

    async edit(post: BlogPost, opts: PublisherOpts): Promise<EditResult> {
      const fieldsChanged = await deps.diffFields(post);
      const input: SierraEditInput = {
        baseUrl: opts.baseUrl,
        username: opts.username,
        password: opts.password,
        post,
        fieldsChanged,
      };
      const { result, sessionId, replayUrl } = await runInSession(opts.contextId, async ({ page }) =>
        sierraEdit(page, input),
      );
      publisher.lastSession = { sessionId, replayUrl };
      return result;
    },

    async fetchTaxonomy(opts: PublisherOpts): Promise<TaxonomyResult> {
      const { result, sessionId, replayUrl } = await runInSession(opts.contextId, async ({ page }) =>
        fetchTaxonomy(page, opts.baseUrl, opts.username, opts.password),
      );
      publisher.lastSession = { sessionId, replayUrl };
      return result;
    },
  };
  return publisher;
}
