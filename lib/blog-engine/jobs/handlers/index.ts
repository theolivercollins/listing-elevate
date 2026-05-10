// lib/blog-engine/jobs/handlers/index.ts
import type { Handlers } from "../runner";
import { fetchTaxonomyHandler } from "./fetch-taxonomy";
import { publishHandler } from "./publish";
import { editHandler } from "./edit";
import { imageTagHandler } from "./image-tag";
import { imageMatchHandler } from "./image-match";

export const handlers: Handlers = {
  fetch_taxonomy: fetchTaxonomyHandler,
  publish: publishHandler,
  edit: editHandler,
  image_tag: imageTagHandler,
  image_match: imageMatchHandler,
};
