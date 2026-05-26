/**
 * Public surface of the scene-graph module.
 * Only these exports should be imported by other gen2-v21 modules.
 */

export { extractSceneGraph } from "./extractor.js";
export { validateSceneGraph, SCENE_GRAPH_JSON_SCHEMA } from "./schema.js";
export { detectPortalsForPhoto } from "./portal-detector.js";
export { inferBearingForPhoto } from "./bearing-vector.js";
export { runConsistencyPass } from "./consistency-pass.js";
