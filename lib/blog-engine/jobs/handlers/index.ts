// lib/blog-engine/jobs/handlers/index.ts
import type { Handlers } from "../runner.js";
import { fetchTaxonomyHandler } from "./fetch-taxonomy.js";
import { publishHandler } from "./publish.js";
import { editHandler } from "./edit.js";
import { imageTagHandler } from "./image-tag.js";
import { imageMatchHandler } from "./image-match.js";
import { unpublishHandler } from "./unpublish.js";

export const handlers: Handlers = {
  fetch_taxonomy: fetchTaxonomyHandler,
  publish: publishHandler,
  edit: editHandler,
  unpublish: unpublishHandler,
  image_tag: imageTagHandler,
  image_match: imageMatchHandler,
};
