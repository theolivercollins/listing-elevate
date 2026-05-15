import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Property,
  PropertyStatus,
  Photo,
  Scene,
  SceneStatus,
  RoomType,
  DepthRating,
  VideoProvider,
  CameraMovement,
  LogStage,
  LogLevel,
  UserProfile,
} from "./types.js";
import { buildAnalysisText, embedTextSafe, toPgVector } from "./embeddings.js";

export type {
  Property,
  PropertyStatus,
  Photo,
  Scene,
  SceneStatus,
  RoomType,
  DepthRating,
  VideoProvider,
  CameraMovement,
  LogStage,
  LogLevel,
  UserProfile,
};

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    client = createClient(url, key);
  }
  return client;
}

// ── Properties ──

export async function createProperty(data: {
  address: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  listing_agent: string;
  brokerage?: string;
  selected_package?: string | null;
  selected_duration?: number | null;
  selected_orientation?: string | null;
  add_voiceover?: boolean;
  add_voice_clone?: boolean;
  add_custom_request?: boolean;
  custom_request_text?: string | null;
  days_on_market?: number | null;
  sold_price?: number | null;
  // Stripe billing — migration 058
  status?: string;
  stripe_payment_status?: string;
  // Auth — populated on POST /api/properties when user is signed in.
  submitted_by?: string;
}): Promise<Property> {
  const { data: row, error } = await getSupabase()
    .from("properties")
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return row as Property;
}

export async function updatePropertyStatus(
  id: string,
  status: PropertyStatus,
  extra?: Partial<Property>
): Promise<void> {
  const { error } = await getSupabase()
    .from("properties")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id);
  if (error) throw error;
}

export async function getProperty(id: string): Promise<Property> {
  const { data, error } = await getSupabase()
    .from("properties")
    .select()
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Property;
}

export async function addPropertyCost(id: string, costCents: number): Promise<void> {
  const prop = await getProperty(id);
  const { error } = await getSupabase()
    .from("properties")
    .update({
      total_cost_cents: prop.total_cost_cents + costCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

// ── Scene ratings (feedback loop) ──

export interface SceneRating {
  id: string;
  scene_id: string;
  property_id: string;
  rating: number;
  comment: string | null;
  tags: string[] | null;
  rated_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function upsertSceneRating(input: {
  scene_id: string;
  property_id: string;
  rating: number;
  comment?: string | null;
  tags?: string[] | null;
  rated_by?: string | null;
}): Promise<SceneRating> {
  const supabase = getSupabase();

  // Snapshot the scene + photo context into the denormalized rating
  // columns so the rating survives a cascade delete when the property
  // is rerun. migration 014 flipped the FK to ON DELETE SET NULL; the
  // unified retrieval RPCs (match_rated_examples / match_loser_examples)
  // read the denorm columns first, falling back to the live join only
  // when they're null.
  const { data: sceneRow } = await supabase
    .from("scenes")
    .select("prompt, camera_movement, duration_seconds, provider, clip_url, embedding, embedding_model, photo_id")
    .eq("id", input.scene_id)
    .maybeSingle();
  let photoRow: {
    room_type: string | null;
    key_features: string[] | null;
    composition: string | null;
    aesthetic_score: number | null;
    depth_rating: string | null;
  } | null = null;
  if (sceneRow?.photo_id) {
    const { data } = await supabase
      .from("photos")
      .select("room_type, key_features, composition, aesthetic_score, depth_rating")
      .eq("id", sceneRow.photo_id)
      .maybeSingle();
    photoRow = (data as typeof photoRow) ?? null;
  }

  const denorm: Record<string, unknown> = sceneRow
    ? {
        rated_prompt: sceneRow.prompt ?? null,
        rated_camera_movement: sceneRow.camera_movement ?? null,
        rated_duration_seconds: sceneRow.duration_seconds ?? null,
        rated_provider: sceneRow.provider ?? null,
        rated_clip_url: sceneRow.clip_url ?? null,
        rated_embedding: sceneRow.embedding ?? null,
        rated_embedding_model: sceneRow.embedding_model ?? null,
        rated_room_type: photoRow?.room_type ?? null,
        rated_photo_key_features: photoRow?.key_features ?? null,
        rated_composition: photoRow?.composition ?? null,
        rated_aesthetic_score: photoRow?.aesthetic_score ?? null,
        rated_depth_rating: photoRow?.depth_rating ?? null,
        rated_snapshot_at: new Date().toISOString(),
      }
    : {};

  const { data, error } = await supabase
    .from("scene_ratings")
    .upsert(
      {
        scene_id: input.scene_id,
        property_id: input.property_id,
        rating: input.rating,
        comment: input.comment ?? null,
        tags: input.tags ?? null,
        rated_by: input.rated_by ?? null,
        updated_at: new Date().toISOString(),
        ...denorm,
      },
      { onConflict: "scene_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data as SceneRating;
}

export async function getRatingsForProperty(propertyId: string): Promise<SceneRating[]> {
  const { data, error } = await getSupabase()
    .from("scene_ratings")
    .select()
    .eq("property_id", propertyId);
  if (error) throw error;
  return (data ?? []) as SceneRating[];
}

// Pull recent good + bad scene ratings across all properties for
// in-context director learning. Each returned row includes the joined
// scene fields the director needs to render an example line.
export interface RatedSceneExample {
  rating: number;
  comment: string | null;
  tags: string[] | null;
  scene: {
    room_type: string;
    camera_movement: string;
    prompt: string;
    provider: string | null;
  };
}

export async function fetchRatedExamples(params: {
  minRating?: number;
  maxRating?: number;
  limit?: number;
  sinceDays?: number;
}): Promise<RatedSceneExample[]> {
  const sinceDays = params.sinceDays ?? 30;
  const sinceIso = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const supabase = getSupabase();

  // After migration 014 scene_ratings carries denormalized copies of the
  // prompt/camera_movement/room_type/provider so a rerun that deletes
  // the scene does not lose the training signal. We pull those denorm
  // columns first and only fall back to the live scene + photo join
  // when the denorm columns are null (legacy pre-backfill rows).
  let ratingsQuery = supabase
    .from("scene_ratings")
    .select(
      "rating, comment, tags, scene_id, created_at, rated_prompt, rated_camera_movement, rated_room_type, rated_provider",
    )
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 20);
  if (params.minRating !== undefined) ratingsQuery = ratingsQuery.gte("rating", params.minRating);
  if (params.maxRating !== undefined) ratingsQuery = ratingsQuery.lte("rating", params.maxRating);
  const { data: ratingRows, error: ratingsErr } = await ratingsQuery;
  if (ratingsErr) throw ratingsErr;
  const ratings = (ratingRows ?? []) as Array<{
    rating: number;
    comment: string | null;
    tags: string[] | null;
    scene_id: string | null;
    created_at: string;
    rated_prompt: string | null;
    rated_camera_movement: string | null;
    rated_room_type: string | null;
    rated_provider: string | null;
  }>;
  if (ratings.length === 0) return [];

  // Rows that still need a live join (denorm columns are null AND the
  // scene still exists). Legacy rows pre-migration-014 fall through to
  // this path; new rows carry all needed fields inline.
  const needsJoin = ratings.filter(
    (r) => r.scene_id && (!r.rated_prompt || !r.rated_camera_movement),
  );
  let sceneMap = new Map<string, { camera_movement: string; prompt: string; provider: string | null; photo_id: string }>();
  let photoMap = new Map<string, string>();
  if (needsJoin.length > 0) {
    const sceneIds = Array.from(new Set(needsJoin.map((r) => r.scene_id as string)));
    const { data: sceneRows } = await supabase
      .from("scenes")
      .select("id, camera_movement, prompt, provider, photo_id")
      .in("id", sceneIds);
    sceneMap = new Map(
      (sceneRows ?? []).map(
        (s: { id: string } & Record<string, unknown>) => [
          s.id,
          s as unknown as { camera_movement: string; prompt: string; provider: string | null; photo_id: string },
        ],
      ),
    );

    const photoIds = Array.from(
      new Set(
        (sceneRows ?? [])
          .map((s: { photo_id: string }) => s.photo_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (photoIds.length > 0) {
      const { data: photoRows } = await supabase
        .from("photos")
        .select("id, room_type")
        .in("id", photoIds);
      photoMap = new Map(
        (photoRows ?? []).map((p: { id: string; room_type: string }) => [p.id, p.room_type]),
      );
    }
  }

  return ratings.flatMap((r) => {
    // Prefer denormalized columns — they survive cascade delete.
    let prompt = r.rated_prompt;
    let cameraMovement = r.rated_camera_movement;
    let roomType = r.rated_room_type;
    let provider = r.rated_provider;
    if ((!prompt || !cameraMovement) && r.scene_id) {
      const scene = sceneMap.get(r.scene_id);
      if (scene) {
        prompt = prompt ?? scene.prompt;
        cameraMovement = cameraMovement ?? scene.camera_movement;
        provider = provider ?? scene.provider;
        roomType = roomType ?? photoMap.get(scene.photo_id) ?? null;
      }
    }
    // Row is unusable if there's still no prompt after falling back.
    if (!prompt || !cameraMovement) return [];
    return [
      {
        rating: r.rating,
        comment: r.comment,
        tags: r.tags,
        scene: {
          room_type: roomType ?? "other",
          camera_movement: cameraMovement,
          prompt,
          provider: provider ?? null,
        },
      },
    ];
  });
}

// ── Prompt revisions (changelog) ──

export async function recordPromptRevisionIfChanged(
  promptName: string,
  body: string,
  note: string | null = null,
): Promise<void> {
  const bodyHash = hashString(body);
  const supabase = getSupabase();
  const { data: latest } = await supabase
    .from("prompt_revisions")
    .select("version, body_hash")
    .eq("prompt_name", promptName)
    .order("version", { ascending: false })
    .limit(1);
  const latestRow = latest?.[0] as { version: number; body_hash: string } | undefined;
  if (latestRow && latestRow.body_hash === bodyHash) return;
  const nextVersion = (latestRow?.version ?? 0) + 1;
  const { error } = await supabase.from("prompt_revisions").insert({
    prompt_name: promptName,
    version: nextVersion,
    body,
    note,
    body_hash: bodyHash,
  });
  if (error && !error.message?.includes("duplicate key")) throw error;
}

function hashString(s: string): string {
  // Simple FNV-1a 64-bit hash — good enough to detect prompt body changes.
  // Not cryptographic; we just need "did the text change since last run."
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16);
}

// ── User Profiles ──

/**
 * Return the voice-clone state for a given user. Returns null values when
 * the user has no profile row (shouldn't happen after first login, but
 * callers must handle it).
 */
export async function getUserVoiceClone(
  userId: string
): Promise<{ voice_id: string | null; status: string }> {
  const { data, error } = await getSupabase()
    .from("user_profiles")
    .select("elevenlabs_voice_id, voice_clone_status")
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  return {
    voice_id: (data as Pick<UserProfile, "elevenlabs_voice_id">).elevenlabs_voice_id,
    status: (data as Pick<UserProfile, "voice_clone_status">).voice_clone_status,
  };
}

/**
 * Write voice-clone fields on user_profiles. Uses the service-role client
 * (same as all other db.ts helpers) so this can be called from pipeline
 * workers that run outside the browser auth context.
 */
export async function setUserVoiceClone(
  userId: string,
  fields: {
    voice_id?: string;
    status: UserProfile["voice_clone_status"];
    sample_url?: string;
    paid_cents?: number;
  }
): Promise<void> {
  const update: Record<string, unknown> = {
    voice_clone_status: fields.status,
    updated_at: new Date().toISOString(),
  };
  if (fields.voice_id !== undefined) update.elevenlabs_voice_id = fields.voice_id;
  if (fields.sample_url !== undefined) update.voice_clone_sample_url = fields.sample_url;
  if (fields.paid_cents !== undefined) {
    update.voice_clone_paid_cents = fields.paid_cents;
    update.voice_clone_paid_at = new Date().toISOString();
  }
  if (fields.status === "enrolling" || fields.status === "ready") {
    // Set created_at on first transition into an active clone lifecycle state.
    update.voice_clone_created_at = new Date().toISOString();
  }
  const { error } = await getSupabase()
    .from("user_profiles")
    .update(update)
    .eq("user_id", userId);
  if (error) throw error;
}

// Detailed cost event captured from a real API response (tokens, credits,
// provider units). Sum of cost_events.cost_cents for a property should
// exactly match properties.total_cost_cents.
export async function recordCostEvent(event: {
  /**
   * Owning property. Pass null for Lab-only API calls (judge, prompt mining,
   * etc.) that aren't tied to a real property — the prior sentinel UUID
   * pattern violates the property_id FK and silently dropped every Lab cost
   * row from 2026-04-30 to 2026-05-06.
   */
  propertyId: string | null;
  sceneId?: string | null;
  stage: "analysis" | "scripting" | "generation" | "qc" | "assembly" | "revision" | "voiceover";
  provider: "anthropic" | "google" | "runway" | "kling" | "luma" | "higgsfield" | "shotstack" | "creatomate" | "openai" | "atlas" | "elevenlabs";
  unitsConsumed?: number;
  unitType?: "tokens" | "credits" | "kling_units" | "renders" | null;
  costCents: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabase();
  const { error: insertErr } = await supabase.from("cost_events").insert({
    property_id: event.propertyId,
    scene_id: event.sceneId ?? null,
    stage: event.stage,
    provider: event.provider,
    units_consumed: event.unitsConsumed ?? null,
    unit_type: event.unitType ?? null,
    cost_cents: Math.round(event.costCents),
    metadata: event.metadata ?? null,
  });
  if (insertErr) throw insertErr;
  // properties.total_cost_cents only updates when the cost actually attributes
  // to a property. Lab calls (propertyId=null) are still tracked in cost_events.
  if (event.propertyId && event.costCents > 0) {
    await addPropertyCost(event.propertyId, Math.round(event.costCents));
  }
}

// ── Photos ──

export async function insertPhotos(
  photos: Array<{ property_id: string; file_url: string; file_name: string }>
): Promise<Photo[]> {
  const { data, error } = await getSupabase().from("photos").insert(photos).select();
  if (error) throw error;
  return data as Photo[];
}

export async function getPhotosForProperty(propertyId: string): Promise<Photo[]> {
  const { data, error } = await getSupabase()
    .from("photos")
    .select()
    .eq("property_id", propertyId)
    .order("created_at");
  if (error) throw error;
  return data as Photo[];
}

export async function updatePhotoAnalysis(
  id: string,
  analysis: {
    room_type: RoomType;
    quality_score: number;
    aesthetic_score: number;
    depth_rating: DepthRating;
    key_features: string[];
    composition?: string | null;
    selected: boolean;
    discard_reason: string | null;
    video_viable?: boolean | null;
    suggested_motion?: string | null;
    motion_rationale?: string | null;
    // DA.1 — migration 030 added analysis_json + analysis_provider on the
    // photos table so the director can read motion_headroom + camera
    // state without forcing another migration every time the analyzer
    // schema grows. Typed columns above stay populated for ergonomic
    // queries.
    analysis_json?: Record<string, unknown> | null;
    analysis_provider?: "google" | "anthropic" | null;
  }
): Promise<void> {
  const { error } = await getSupabase().from("photos").update(analysis).eq("id", id);
  if (error) throw error;
}

export async function getSelectedPhotos(propertyId: string): Promise<Photo[]> {
  const { data, error } = await getSupabase()
    .from("photos")
    .select()
    .eq("property_id", propertyId)
    .eq("selected", true)
    .order("aesthetic_score", { ascending: false });
  if (error) throw error;
  return data as Photo[];
}

// ── Scenes ──

export async function insertScenes(
  scenes: Array<{
    property_id: string;
    photo_id: string;
    scene_number: number;
    camera_movement: string;
    prompt: string;
    duration_seconds: number;
    provider?: VideoProvider;
    end_photo_id?: string | null;
    end_image_url?: string | null;
  }>
): Promise<Scene[]> {
  const { data, error } = await getSupabase().from("scenes").insert(scenes).select();
  if (error) throw error;
  return data as Scene[];
}

export async function embedScene(sceneId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: scene, error } = await supabase
    .from("scenes")
    .select(
      "id, property_id, camera_movement, prompt, photo:photos(room_type, key_features, composition, suggested_motion)",
    )
    .eq("id", sceneId)
    .single();
  if (error || !scene || !scene.photo) return;
  // PostgREST types a FK-joined relation as an array at compile time even
  // when the relationship is to-one; at runtime it's a single object here
  // because photos.id is a unique PK. Normalize via unknown to keep the
  // local shape tight without widening the Photo type.
  const photoRaw = scene.photo as unknown;
  const photo = (Array.isArray(photoRaw) ? photoRaw[0] : photoRaw) as {
    room_type: string | null;
    key_features: string[] | null;
    composition: string | null;
    suggested_motion: string | null;
  } | undefined;
  if (!photo) return;
  const text = buildAnalysisText({
    roomType: photo.room_type ?? "",
    keyFeatures: photo.key_features ?? [],
    composition: photo.composition ?? undefined,
    suggestedMotion: photo.suggested_motion ?? undefined,
    cameraMovement: (scene.camera_movement as string | null) ?? "",
  });
  const embedded = await embedTextSafe(text);
  if (!embedded) return;
  const { error: updateError } = await supabase
    .from("scenes")
    .update({ embedding: toPgVector(embedded.vector), embedding_model: embedded.model })
    .eq("id", sceneId);
  if (updateError) throw updateError;
  const { error: costErr } = await supabase.from("cost_events").insert({
    property_id: (scene.property_id as string | null) ?? null,
    scene_id: sceneId,
    stage: "embedding",
    provider: "openai",
    units_consumed: embedded.usage.totalTokens,
    unit_type: "tokens",
    cost_cents: Math.round(embedded.usage.costCents),
    metadata: {
      scope: "prod_scene_embedding",
      model: embedded.model,
      tokens: embedded.usage.totalTokens,
    },
  });
  if (costErr) {
    console.error("[embeddings] cost_events insert failed:", costErr);
  }
}

export async function getScenesForProperty(propertyId: string): Promise<Scene[]> {
  const { data, error } = await getSupabase()
    .from("scenes")
    .select()
    .eq("property_id", propertyId)
    .order("scene_number");
  if (error) throw error;
  return data as Scene[];
}

export async function updateScene(id: string, updates: Partial<Scene>): Promise<void> {
  const { error } = await getSupabase().from("scenes").update(updates).eq("id", id);
  if (error) throw error;
}

export async function updateSceneStatus(
  id: string,
  status: SceneStatus,
  extra?: Partial<Scene>
): Promise<void> {
  const { error } = await getSupabase()
    .from("scenes")
    .update({ status, ...extra })
    .eq("id", id);
  if (error) throw error;
}

// ── Pipeline Logs ──

export async function log(
  propertyId: string,
  stage: LogStage,
  level: LogLevel,
  message: string,
  metadata?: Record<string, unknown>,
  sceneId?: string
): Promise<void> {
  const { error } = await getSupabase().from("pipeline_logs").insert({
    property_id: propertyId,
    scene_id: sceneId ?? null,
    stage,
    level,
    message,
    metadata: metadata ?? null,
  });
  if (error) console.error("Failed to write log:", error);
}
