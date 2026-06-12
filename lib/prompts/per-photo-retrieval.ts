// Per-photo retrieval bundle for production.
//
// Each photo gets its own recipes + exemplars + losers fetched against
// its image embedding (scoped to its room_type), then recipes are
// compatibility-filtered against the photo's motion_headroom so the
// director never sees recipes that DA.2 would later ban. Result is
// rendered as a per-photo block in the director's user message.
//
// Why per-photo, not per-listing: the previous "PAST GENERATIONS" block
// in runScripting was global (top-5 winners across all properties, date-
// ranked). This blurred signal across rooms and biased the director
// toward repeating whatever recently rated highly, regardless of
// composition fit. Per-photo retrieval scopes the signal correctly.

import {
  retrieveMatchingRecipes,
  retrieveSimilarIterations,
  retrieveSimilarLosers,
  retrieveRecentModelFeedback,
  renderRecipeBlock,
  renderExemplarBlock,
  renderLoserBlock,
  type RetrievedRecipe,
  type RetrievedExemplar,
} from "../prompt-lab.js";
import { getSupabase } from "../db.js";

type HeadroomKey =
  | "push_in"
  | "pull_out"
  | "orbit"
  | "parallax"
  | "drone_push_in"
  | "top_down";

interface MotionRequirement {
  // ALL of these headroom keys must be true.
  requires?: HeadroomKey[];
  // ANY of these headroom keys must be true (used for reveal).
  requiresAny?: HeadroomKey[];
  // No headroom required (feature_closeup, rack_focus — static-ish).
  always?: true;
}

// Mirrors lib/prompts/director.ts:316-367 ("HARD MOVEMENT BANS FROM
// MOTION HEADROOM"). Kept local because the existing
// mapCameraMovementToHeadroomKey in lib/prompt-lab-listings.ts returns
// only a single key and doesn't model the AND/OR/always semantics this
// filter needs.
const MOTION_HEADROOM_REQUIREMENTS: Record<string, MotionRequirement> = {
  push_in: { requires: ["push_in"] },
  orbit: { requires: ["orbit"] },
  parallax: { requires: ["parallax"] },
  dolly_left_to_right: { requires: ["parallax"] },
  dolly_right_to_left: { requires: ["parallax"] },
  reveal: { requiresAny: ["parallax", "push_in"] },
  drone_push_in: { requires: ["push_in", "drone_push_in"] },
  top_down: { requires: ["top_down"] },
  low_angle_glide: { requires: ["push_in"] },
  feature_closeup: { always: true },
  rack_focus: { always: true },
};

export function filterRecipesByMotionHeadroom(
  recipes: RetrievedRecipe[],
  headroom: Record<string, boolean> | null,
): RetrievedRecipe[] {
  // Claude-fallback photo or pre-DA.2 row — permissive, keep all.
  if (!headroom) return recipes;
  return recipes.filter((r) => {
    const req = MOTION_HEADROOM_REQUIREMENTS[r.camera_movement];
    // Unknown movement — defer to the director, don't drop it.
    if (!req) return true;
    if (req.always) return true;
    if (req.requires) {
      return req.requires.every((k) => headroom[k] === true);
    }
    if (req.requiresAny) {
      return req.requiresAny.some((k) => headroom[k] === true);
    }
    return true;
  });
}

export interface PerPhotoBundle {
  recipes: RetrievedRecipe[];
  exemplars: RetrievedExemplar[];
  losers: RetrievedExemplar[];
  /** Recent operator feedback on the specific model SKU (up to 3), newest first.
   *  Only populated when `modelSku` is passed to fetchPerPhotoRetrievalBundle. */
  feedback: Array<{ comment: string; created_at: string }>;
}

interface FetchOpts {
  recipeLimit?: number;
  exemplarLimit?: number;
  loserLimit?: number;
  distanceThreshold?: number;
}

export async function fetchPerPhotoRetrievalBundle(params: {
  photoId: string;
  roomType: string;
  motionHeadroom: Record<string, boolean> | null;
  /** pipeline_version of the property being rendered. When supplied, recipe
   *  retrieval is scoped to recipes tagged with the same version so that
   *  v1.1 push-in recipes don't bleed into v1 renders and vice versa.
   *  Defaults to 'v1' when absent for backward compat with existing callers. */
  pipelineVersion?: string;
  /** SKU (model) used for this render. When provided, up to 3 recent operator
   *  feedback comments for that SKU + pipelineVersion are fetched and included
   *  in the bundle so the director can see qualitative notes about this model. */
  modelSku?: string;
  opts?: FetchOpts;
}): Promise<PerPhotoBundle> {
  const { photoId, roomType, motionHeadroom, pipelineVersion, modelSku, opts = {} } = params;
  const supabase = getSupabase();

  // Fetch the photo's image_embedding. If null, retrieval degrades to
  // an empty bundle — the per-photo block won't render and the director
  // runs without exemplar guidance for that photo (same as pre-fix
  // behaviour).
  const { data: photoRow } = await supabase
    .from("photos")
    .select("image_embedding")
    .eq("id", photoId)
    .maybeSingle();
  const raw = (photoRow as { image_embedding?: unknown } | null)?.image_embedding;
  let embedding: number[] | null = null;
  if (Array.isArray(raw)) embedding = raw as number[];
  else if (typeof raw === "string" && raw.startsWith("[")) {
    try {
      embedding = JSON.parse(raw) as number[];
    } catch {
      embedding = null;
    }
  }
  if (!embedding) {
    return { recipes: [], exemplars: [], losers: [], feedback: [] };
  }

  const [recipesRaw, exemplars, losers, feedback] = await Promise.all([
    retrieveMatchingRecipes(embedding, roomType, {
      distanceThreshold: opts.distanceThreshold ?? 0.35,
      limit: opts.recipeLimit ?? 3,
      ...(pipelineVersion ? { pipelineVersion } : {}),
    }),
    retrieveSimilarIterations(embedding, {
      minRating: 4,
      limit: opts.exemplarLimit ?? 5,
      // v1/v1.1 isolation — scope winner exemplars to the requesting
      // pipeline so v1.1 5★ Lab iterations don't leak into v1 director
      // prompts (and vice versa).
      ...(pipelineVersion ? { pipelineVersion } : {}),
    }),
    retrieveSimilarLosers(embedding, {
      maxRating: 2,
      limit: opts.loserLimit ?? 3,
      ...(pipelineVersion ? { pipelineVersion } : {}),
    }),
    // Fetch up to 3 recent operator feedback comments for this SKU + pipeline.
    // Degraded gracefully to [] when modelSku is not provided or fetch fails.
    modelSku && pipelineVersion
      ? retrieveRecentModelFeedback(modelSku, {
          pipelineVersion,
          limit: 3,
        }).catch(() => [] as Array<{ comment: string; created_at: string }>)
      : Promise.resolve([] as Array<{ comment: string; created_at: string }>),
  ]);

  const recipes = filterRecipesByMotionHeadroom(recipesRaw, motionHeadroom);
  return { recipes, exemplars, losers, feedback };
}

function renderFeedbackBlock(
  feedback: Array<{ comment: string; created_at: string }>,
  modelSku: string,
): string {
  if (feedback.length === 0) return "";
  const lines = feedback.map((f) => {
    const dateStr = f.created_at.slice(0, 10); // "2026-05-23"
    return `- [${dateStr}] "${f.comment}"`;
  });
  return `\n\nRECENT OPERATOR FEEDBACK ON ${modelSku}:\n${lines.join("\n")}`;
}

export function renderPerPhotoBlock(
  photoId: string,
  bundle: PerPhotoBundle,
  modelSku?: string,
): string {
  const { recipes, exemplars, losers, feedback } = bundle;
  const hasFeedback = modelSku && feedback.length > 0;
  if (recipes.length === 0 && exemplars.length === 0 && losers.length === 0 && !hasFeedback) {
    return "";
  }
  const sections = [
    renderRecipeBlock(recipes),
    renderExemplarBlock(exemplars),
    renderLoserBlock(losers),
    hasFeedback ? renderFeedbackBlock(feedback, modelSku) : "",
  ]
    .filter(Boolean)
    .join("");
  return `\n\n══════ RETRIEVAL FOR PHOTO ${photoId} ══════${sections}\n══════ END RETRIEVAL FOR PHOTO ${photoId} ══════`;
}
