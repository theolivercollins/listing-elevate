// lib/blog-engine/publishers/types.ts
import type { BlogPost, TaxonomyOption } from '../types';

export interface PublishResult {
  external_post_url: string;
  external_post_id: string | null;
}

export interface EditResult {
  external_post_url: string;
}

export interface UnpublishResult {
  removed: boolean;
}

export interface TaxonomyResult {
  authors: TaxonomyOption[];
  categories: TaxonomyOption[];
}

export interface Publisher {
  publish(post: BlogPost, opts: PublisherOpts): Promise<PublishResult>;
  edit(post: BlogPost, opts: PublisherOpts): Promise<EditResult>;
  unpublish(externalPostId: string, postTitle: string | null, opts: PublisherOpts): Promise<UnpublishResult>;
  fetchTaxonomy(opts: PublisherOpts): Promise<TaxonomyResult>;
}

export interface PublisherOpts {
  baseUrl: string;
  username: string;
  password: string;
  /**
   * Sierra-only: the customer's public domain (e.g. "thehelgemoteam.com").
   * Sierra requires it as a third login field. Ignored by non-Sierra publishers.
   */
  siteName?: string;
  contextId: string;
}
