import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "./client.js";
import { computeClaudeCost } from "./utils/claude-cost.js";
import {
  analyzeSingleImage,
  retrieveMatchingRecipes,
  retrieveSimilarIterations,
  retrieveSimilarLosers,
  renderRecipeBlock,
  renderExemplarBlock,
  renderLoserBlock,
  type RetrievedRecipe,
  type RetrievedExemplar,
} from "./prompt-lab.js";
import { parseDirectorIntent, type DirectorIntent } from "./prompts/director-intent.js";
import { DIRECTOR_SYSTEM, buildDirectorUserPrompt } from "./prompts/director.js";
import { rewritePromptForNewMotion } from "./prompts/rewrite-on-motion-override.js";
import { buildAnalysisText, embedTextSafe, fromPgVector, toPgVector } from "./embeddings.js";
import {
  analyzePhotoWithGemini,
  GeminiAnalysisError,
  type ExtendedPhotoAnalysis,
  type MotionHeadroom,
} from "./providers/gemini-analyzer.js";

// DA.3 — map a director camera_movement to the motion_headroom key it
// depends on. Returns null for movements that don't require headroom
// (feature_closeup, rack_focus: static-ish shots that are always safe).
// Exported for reuse by the prod pipeline validator.
export function mapCameraMovementToHeadroomKey(
  movement: string | null | undefined,
): keyof import("./providers/gemini-analyzer.js").MotionHeadroom | null {
  if (!movement) return null;
  switch (movement) {
    case "push_in":
    case "low_angle_glide":
      return "push_in";
    case "drone_push_in":
      // Drone needs forward clearance AND aerial/elevated framing. We
      // validate push_in here and let the director's aerial-camera-height
      // check (via motion_headroom.drone_push_in) layer on top via the
      // system prompt's hard rules. If you want both checks, extend the
      // return type to an array — for now push_in=false is the more
      // common failure on ground shots the director misroutes.
      return "drone_push_in";
    case "orbit":
      return "orbit";
    case "parallax":
    case "dolly_left_to_right":
    case "dolly_right_to_left":
    case "reveal":
      return "parallax";
    case "top_down":
      return "top_down";
    case "feature_closeup":
    case "rack_focus":
      return null;
    default:
      return null;
  }
}

export interface PairResolution {
  endImageUrl: string | null;
  pairingMode: "paired" | "none";
}

export interface ResolveSceneEndFrameInput {
  startPhotoUrl: string;
  endPhotoId: string | null;
  photoLookup: (id: string) => Promise<string | null>;
}

export async function resolveSceneEndFrame(input: ResolveSceneEndFrameInput): Promise<PairResolution> {
  if (!input.startPhotoUrl) throw new Error("resolveSceneEndFrame: startPhotoUrl is required");
  if (input.endPhotoId) {
    const url = await input.photoLookup(input.endPhotoId);
    if (url) return { endImageUrl: url, pairingMode: "paired" };
  }
  return { endImageUrl: null, pairingMode: "none" };
}

export async function createListingWithPhotos(input: {
  createdBy: string;
  name: string;
  modelName: string;
  photos: Array<{ imageUrl: string; imagePath: string }>;
  notes?: string | null;
}): Promise<string> {
  const supabase = getSupabase();
  const { data: listing, error } = await supabase
    .from("prompt_lab_listings")
    .insert({
      name: input.name,
      created_by: input.createdBy,
      model_name: input.modelName,
      notes: input.notes ?? null,
      status: "analyzing",
    })
    .select("id")
    .single();
  if (error || !listing) throw new Error(`Create listing failed: ${error?.message ?? "no row"}`);

  const rows = input.photos.map((p, i) => ({
    listing_id: listing.id,
    photo_index: i,
    image_url: p.imageUrl,
    image_path: p.imagePath,
  }));
  const { error: insertErr } = await supabase.from("prompt_lab_listing_photos").insert(rows);
  if (insertErr) throw new Error(`Insert photos failed: ${insertErr.message}`);

  return listing.id;
}

export async function analyzeListingPhotos(listingId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: photos } = await supabase
    .from("prompt_lab_listing_photos")
    .select("*")
    .eq("listing_id", listingId)
    .is("analysis_json", null);
  if (!photos || photos.length === 0) {
    await supabase.from("prompt_lab_listings").update({ status: "directing" }).eq("id", listingId);
    return;
  }

  // DA.1 — per-photo analysis now runs through Gemini 3 Flash as the
  // "eyes" of the director. Claude stays as the fallback if Gemini errors.
  // We preserve the full ExtendedPhotoAnalysis shape (which is a superset
  // of PhotoAnalysisResult) in analysis_json; downstream readers get the
  // original fields plus the new camera-state fields additively.
  await Promise.all(
    photos.map(async (p) => {
      let analysis: ExtendedPhotoAnalysis;
      let analysisProvider: "google" | "anthropic";
      let geminiUsage: { inputTokens: number; outputTokens: number; costCents: number } | null =
        null;
      let geminiModel: string | null = null;

      try {
        const res = await analyzePhotoWithGemini(p.image_url);
        analysis = res.analysis;
        analysisProvider = "google";
        geminiUsage = res.usage;
        geminiModel = res.model;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[analyzeListingPhotos] Gemini failed for photo ${p.id}; falling back to Claude: ${msg}`,
        );
        const claudeRes = await analyzeSingleImage(p.image_url);
        // Claude path doesn't emit motion_headroom / camera-state. Use
        // permissive defaults so the director doesn't block every
        // movement on fallback photos — the validator (DA.3) will still
        // catch genuinely incompatible choices once a proper Gemini run
        // populates motion_headroom on re-analysis. Cost for the Claude
        // path is already logged inside analyzeSingleImage's caller pattern
        // — but Lab previously never logged it; we log it here now for
        // parity with the Gemini path.
        const permissiveHeadroom: MotionHeadroom = {
          push_in: true,
          pull_out: true,
          orbit: true,
          parallax: true,
          drone_push_in: true,
          top_down: true,
        };
        analysis = {
          ...claudeRes.analysis,
          camera_height: "eye_level",
          camera_tilt: "level",
          frame_coverage: "medium",
          motion_headroom: permissiveHeadroom,
          motion_headroom_rationale: {
            note: "gemini failed; claude fallback; motion_headroom defaulted to permissive",
          },
        } as ExtendedPhotoAnalysis;
        analysisProvider = "anthropic";
        // Log the Claude-fallback cost. analyzeSingleImage returns costCents
        // but not the full usage breakdown — we still record enough for
        // reconciliation (scope marks the fallback path).
        const { error: costErr } = await supabase.from("cost_events").insert({
          property_id: null,
          scene_id: null,
          stage: "analysis",
          provider: "anthropic",
          units_consumed: 0, // analyzeSingleImage doesn't surface tokens; cost_cents is the ground truth
          unit_type: "tokens",
          cost_cents: Math.round(claudeRes.costCents),
          metadata: {
            scope: "lab_listing_photo_eyes_fallback",
            model: "claude-sonnet-4-6",
            listing_id: listingId,
            photo_id: p.id,
            reason: "gemini_failure",
            gemini_error: msg,
          },
        });
        if (costErr) console.error("[analyzeListingPhotos] claude fallback cost_events insert failed:", costErr);
      }

      const embedded = await embedTextSafe(
        buildAnalysisText({
          roomType: analysis.room_type,
          keyFeatures: analysis.key_features ?? [],
          composition: analysis.composition,
          suggestedMotion: analysis.suggested_motion,
          cameraMovement: null,
        }),
      );
      await supabase
        .from("prompt_lab_listing_photos")
        .update({
          analysis_json: analysis,
          embedding: embedded ? toPgVector(embedded.vector) : null,
        })
        .eq("id", p.id);

      // Cost event for the Gemini path (Claude path logged inline above).
      if (analysisProvider === "google" && geminiUsage && geminiModel) {
        const { error: costErr } = await supabase.from("cost_events").insert({
          property_id: null,
          scene_id: null,
          stage: "analysis",
          provider: "google",
          units_consumed: geminiUsage.inputTokens + geminiUsage.outputTokens,
          unit_type: "tokens",
          cost_cents: Math.round(geminiUsage.costCents),
          metadata: {
            scope: "lab_listing_photo_eyes",
            model: geminiModel,
            listing_id: listingId,
            photo_id: p.id,
            input_tokens: geminiUsage.inputTokens,
            output_tokens: geminiUsage.outputTokens,
          },
        });
        if (costErr) console.error("[analyzeListingPhotos] gemini cost_events insert failed:", costErr);
      }

      if (embedded) {
        const { error: costErr } = await supabase.from("cost_events").insert({
          property_id: null,
          scene_id: null,
          stage: "embedding",
          provider: "openai",
          units_consumed: embedded.usage.totalTokens,
          unit_type: "tokens",
          cost_cents: Math.round(embedded.usage.costCents),
          metadata: {
            scope: "lab_listing_photo_embedding",
            model: embedded.model,
            tokens: embedded.usage.totalTokens,
            listing_id: listingId,
            photo_id: p.id,
          },
        });
        if (costErr) console.error("[embeddings] cost_events insert failed:", costErr);
      }
    }),
  );

  await supabase.from("prompt_lab_listings").update({ status: "directing" }).eq("id", listingId);
}

export async function directListingScenes(listingId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: listing } = await supabase
    .from("prompt_lab_listings")
    .select("id, pipeline_version")
    .eq("id", listingId)
    .single();
  if (!listing) throw new Error(`Listing ${listingId} not found`);
  // pipeline_version scopes recipe retrieval so that v1.1 renders don't
  // see v1 recipes and vice versa. Falls back to 'v1' for rows created
  // before migration 063.
  const listingPipelineVersion = (listing as { id: string; pipeline_version?: string | null }).pipeline_version ?? "v1";

  const { data: photosRaw } = await supabase
    .from("prompt_lab_listing_photos")
    .select("id, photo_index, image_url, analysis_json, embedding")
    .eq("listing_id", listingId)
    .order("photo_index");
  // Supabase select() returns `unknown[]` without a generic; cast once so the
  // downstream Maps/Records don't fight TS over `.analysis_json` etc.
  const photos = (photosRaw ?? []) as Array<{
    id: string;
    photo_index: number;
    image_url: string;
    analysis_json: Record<string, unknown> | null;
    embedding: unknown;
  }>;
  if (photos.length === 0) throw new Error(`Listing ${listingId} has no photos`);

  // Map each photo's analysis_json into the shape buildDirectorUserPrompt
  // expects. The production director is trained on this exact layout —
  // room / aesthetic / depth / key_features / composition / motion hint
  // per photo, not raw JSON dumps. Mismatched user-prompt format was
  // making the director return non-JSON or malformed output on Lab
  // listings, dropping the listing into status='failed'.
  type DirectorUserPhoto = Parameters<typeof buildDirectorUserPrompt>[0][number];
  const photoData: DirectorUserPhoto[] = photos.map((p) => {
    const a = (p.analysis_json ?? {}) as {
      room_type?: string;
      aesthetic_score?: number;
      depth_rating?: string;
      key_features?: string[];
      composition?: string | null;
      suggested_motion?: string | null;
      motion_rationale?: string | null;
      // DA.2 — camera-state fields from Gemini analyzer (optional for
      // photos analyzed pre-DA.1 or via Claude fallback).
      camera_height?: string | null;
      camera_tilt?: string | null;
      frame_coverage?: string | null;
      motion_headroom?: Record<string, boolean> | null;
      motion_headroom_rationale?: Record<string, string> | null;
    };
    return {
      id: p.id,
      file_name: `photo_${p.photo_index}`,
      room_type: a.room_type ?? "other",
      aesthetic_score: typeof a.aesthetic_score === "number" ? a.aesthetic_score : 5,
      depth_rating: a.depth_rating ?? "medium",
      key_features: Array.isArray(a.key_features) ? a.key_features : [],
      composition: a.composition ?? null,
      suggested_motion: a.suggested_motion ?? null,
      motion_rationale: a.motion_rationale ?? null,
      camera_height: a.camera_height ?? null,
      camera_tilt: a.camera_tilt ?? null,
      frame_coverage: a.frame_coverage ?? null,
      motion_headroom: a.motion_headroom ?? null,
      motion_headroom_rationale: a.motion_headroom_rationale ?? null,
    };
  });

  // Retrieve promoted recipes + past winners + past losers per photo,
  // dedupe across photos, and inject as in-context examples. Restores
  // the legacy recipe-driven director behavior that Lab sessions have
  // always used. End-frame pairing is unaffected — the director still
  // returns end_photo_id per scene and that flows through the same
  // resolver below.
  const recipeDedupe = new Map<string, RetrievedRecipe>();
  const exemplarDedupe = new Map<string, RetrievedExemplar>();
  const loserDedupe = new Map<string, RetrievedExemplar>();
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const pdata = photoData[i];
    const vec = fromPgVector(p.embedding as string | null);
    if (!vec) continue;
    try {
      const [recipes, winners, losers] = await Promise.all([
        retrieveMatchingRecipes(vec, pdata.room_type, { limit: 1, pipelineVersion: listingPipelineVersion }),
        // v1/v1.1 isolation — scope winners + losers to this listing's pipeline_version.
        retrieveSimilarIterations(vec, { minRating: 4, limit: 3, pipelineVersion: listingPipelineVersion }),
        retrieveSimilarLosers(vec, { maxRating: 2, limit: 2, pipelineVersion: listingPipelineVersion }),
      ]);
      for (const r of recipes) if (!recipeDedupe.has(r.archetype)) recipeDedupe.set(r.archetype, r);
      for (const w of winners) if (!exemplarDedupe.has(w.id)) exemplarDedupe.set(w.id, w);
      for (const l of losers) if (!loserDedupe.has(l.id)) loserDedupe.set(l.id, l);
    } catch (err) {
      // Retrieval is best-effort — a failing RPC must not block the
      // director. The rulebook alone still produces valid output.
      console.warn(`[directListingScenes] retrieval for photo ${p.id}:`, err);
    }
  }
  const recipes = [...recipeDedupe.values()].slice(0, 5);
  const exemplars = [...exemplarDedupe.values()].slice(0, 5);
  const losers = [...loserDedupe.values()].slice(0, 3);

  const userPrompt =
    buildDirectorUserPrompt(photoData) +
    renderRecipeBlock(recipes) +
    renderExemplarBlock(exemplars) +
    renderLoserBlock(losers);

  const LISTING_DIRECTOR_MODEL = "claude-sonnet-4-6";
  const client = new Anthropic();
  const response = await client.messages.create({
    model: LISTING_DIRECTOR_MODEL,
    max_tokens: 8192,
    system: DIRECTOR_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });

  // Record token cost for listing director (Sonnet 4.6).
  const supabaseForCost = getSupabase();
  const cost = computeClaudeCost(response.usage as never, LISTING_DIRECTOR_MODEL);
  const { error: costErr } = await supabaseForCost.from("cost_events").insert({
    property_id: null,
    scene_id: null,
    stage: "director",
    provider: "anthropic",
    units_consumed: cost.totalTokens,
    unit_type: "tokens",
    cost_cents: Math.round(cost.costCents),
    metadata: { scope: "lab_listing_director", listing_id: listingId, model: LISTING_DIRECTOR_MODEL },
  });
  if (costErr) console.error("[directListingScenes] cost_events insert failed:", costErr);

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Director emitted no JSON. First 200 chars: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]) as {
    scenes: Array<{
      scene_number: number;
      photo_id: string;
      end_photo_id?: string | null;
      room_type: string;
      camera_movement: string;
      prompt: string;
      director_intent: unknown;
    }>;
  };

  // DA.3 — validate each planned scene against the source photo's
  // motion_headroom. On violation, override camera_movement to the
  // analyzer's suggested_motion if that's in-headroom, else
  // feature_closeup (safest fallback — no camera motion through space).
  // This is the cheap, deterministic fix: no re-prompt round-trip,
  // constant latency. See DA.3 notes in docs/HANDOFF.md.
  const photoById = new Map(photos.map((p) => [p.id, p]));
  let violationCount = 0;
  for (const scene of parsed.scenes) {
    const p = photoById.get(scene.photo_id);
    if (!p) continue;
    const a = (p.analysis_json ?? {}) as {
      motion_headroom?: Record<string, boolean>;
      suggested_motion?: string | null;
    };
    const hr = a.motion_headroom;
    if (!hr) continue; // Claude-fallback photo — permissive defaults, nothing to validate
    const movement = scene.camera_movement;
    const key = mapCameraMovementToHeadroomKey(movement);
    if (key && hr[key] === false) {
      violationCount++;
      const originalMovement = movement;
      const suggested = a.suggested_motion ?? null;
      const suggestedKey = suggested ? mapCameraMovementToHeadroomKey(suggested) : null;
      const suggestedInHeadroom =
        suggested && (!suggestedKey || hr[suggestedKey] !== false);
      const replacement = suggestedInHeadroom && suggested ? suggested : "feature_closeup";
      // Rewrite prompt text to match the replacement motion verb. The
      // director_intent here is still raw JSON (parseDirectorIntent
      // hasn't run yet), so extract subject defensively.
      const intentRaw = scene.director_intent as { subject?: unknown } | null | undefined;
      const subjectFromIntent =
        typeof intentRaw?.subject === "string" ? intentRaw.subject : undefined;
      const rewrittenPrompt = rewritePromptForNewMotion(
        scene.prompt,
        replacement,
        subjectFromIntent,
      );
      console.warn(
        `[directListingScenes] DA.3 override: scene ${scene.scene_number} picked ${originalMovement} but photo.motion_headroom.${key}=false; overriding to ${replacement}; prompt rewritten`,
      );
      scene.prompt = rewrittenPrompt;
      scene.camera_movement = replacement;
    }
  }
  if (violationCount > 0) {
    console.log(
      `[directListingScenes] DA.3 validator overrode ${violationCount} scene(s) on listing ${listingId}`,
    );
  }

  const photoUrlById = new Map(photos.map((p) => [p.id, p.image_url]));
  // Accumulate rows so we can do one bulk insert instead of N serial round-trips.
  const sceneRows: Array<{
    listing_id: string;
    scene_number: number;
    photo_id: string;
    end_photo_id: string | null;
    end_image_url: string | null;
    room_type: string;
    camera_movement: string;
    director_prompt: string;
    director_intent: DirectorIntent;
  }> = [];
  for (const scene of parsed.scenes) {
    const startUrl = photoUrlById.get(scene.photo_id);
    if (!startUrl) continue;
    // resolveSceneEndFrame is async (network lookup) — must stay inside the loop.
    const resolution = await resolveSceneEndFrame({
      startPhotoUrl: startUrl,
      endPhotoId: scene.end_photo_id ?? null,
      photoLookup: async (id) => photoUrlById.get(id) ?? null,
    });
    let intent: DirectorIntent;
    try {
      intent = parseDirectorIntent(scene.director_intent);
    } catch {
      // If director omitted intent, synthesize a minimal one from the
      // other scene fields so persistence doesn't fail.
      intent = parseDirectorIntent({
        room_type: scene.room_type,
        motion: scene.camera_movement,
        subject: scene.prompt.slice(0, 80),
      });
    }
    sceneRows.push({
      listing_id: listingId,
      scene_number: scene.scene_number,
      photo_id: scene.photo_id,
      end_photo_id: scene.end_photo_id ?? null,
      end_image_url: resolution.endImageUrl,
      room_type: scene.room_type,
      camera_movement: scene.camera_movement,
      director_prompt: scene.prompt,
      director_intent: intent,
    });
  }
  // Single bulk insert — scene_number ordering preserved by array order.
  if (sceneRows.length > 0) {
    const { error: scenesInsertErr } = await supabase
      .from("prompt_lab_listing_scenes")
      .insert(sceneRows);
    if (scenesInsertErr) throw new Error(`Insert scenes failed: ${scenesInsertErr.message}`);
  }

  await supabase.from("prompt_lab_listings").update({ status: "ready_to_render" }).eq("id", listingId);
}
