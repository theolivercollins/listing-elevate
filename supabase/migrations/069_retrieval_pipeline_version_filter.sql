-- Migration 069 — pipeline_version filter on retrieval RPCs
--
-- Closes a v1 / v1.1 leakage gap: match_rated_examples and match_loser_examples
-- aggregate winners/losers across Lab iterations (prompt_lab_iterations),
-- production scene_ratings, and Listings-Lab iterations
-- (prompt_lab_listing_scene_iterations). Without a pipeline_version filter,
-- a v1.1 5★ Lab iteration becomes a "past winner exemplar" when directing
-- v1 production renders (and vice versa) — exactly what Oliver's
-- "things rendered in v1.1 shouldn't go into v1" rule forbids.
--
-- This migration adds an optional `p_pipeline_version TEXT` parameter to
-- both RPCs:
--   - NULL (default)  → backward-compatible; no filter, all versions returned.
--   - 'v1' | 'v1.1'   → only return exemplars/losers from that version.
--
-- Filter wiring per source branch:
--   - lab     → prompt_lab_iterations.pipeline_version
--   - prod    → properties.pipeline_mode (via JOIN on scene_ratings.property_id)
--   - listing → prompt_lab_listing_scene_iterations.pipeline_version
--
-- All three columns default 'v1' so backfilled rows behave correctly without
-- additional NULL-guarding.
--
-- Spec: closes gap audit 2026-05-24 — feedback isolation requirement.

-- Drop ALL existing overloads first — adding a new optional parameter changes
-- the signature and Postgres' CREATE OR REPLACE only matches by exact arg list.
-- Iterates pg_proc to find every overload (from migrations 009/010/011/029/035/036)
-- and drops them so the new single-source-of-truth definition below can land
-- without a "function name is not unique" 42725.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname IN ('match_rated_examples', 'match_loser_examples')
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

-- =========================================================================
-- match_rated_examples — winners (rating >= min_rating)
-- =========================================================================
CREATE FUNCTION public.match_rated_examples(
  query_embedding       vector(1536),
  min_rating            int     DEFAULT 4,
  match_count           int     DEFAULT 5,
  query_image_embedding vector(768) DEFAULT NULL,
  text_weight           float   DEFAULT 0.4,
  image_weight          float   DEFAULT 0.6,
  p_pipeline_version    text    DEFAULT NULL
)
RETURNS TABLE(
  source               text,
  example_id           uuid,
  rating               int,
  analysis_json        jsonb,
  director_output_json jsonb,
  prompt               text,
  camera_movement      text,
  model_used           text,
  clip_url             text,
  tags                 text[],
  comment              text,
  refinement           text,
  distance             float
) AS $$
  WITH norm AS (
    SELECT
      CASE WHEN NULLIF(text_weight + image_weight, 0) IS NULL THEN 1.0
           ELSE text_weight / (text_weight + image_weight) END AS w_text,
      CASE WHEN NULLIF(text_weight + image_weight, 0) IS NULL THEN 0.0
           ELSE image_weight / (text_weight + image_weight) END AS w_image
  ),
  lab AS (
    SELECT
      'lab'::text AS source,
      i.id AS example_id,
      i.rating,
      i.analysis_json,
      i.director_output_json,
      NULL::text AS prompt,
      NULL::text AS camera_movement,
      CASE i.provider
        WHEN 'kling'   THEN 'kling-v2-native'
        WHEN 'runway'  THEN 'runway'
        WHEN 'luma'    THEN 'luma'
        ELSE NULL
      END AS model_used,
      i.clip_url,
      i.tags,
      i.user_comment AS comment,
      i.refinement_instruction AS refinement,
      (
        CASE
          WHEN query_image_embedding IS NULL OR s.image_embedding IS NULL
            THEN (i.embedding <=> query_embedding)
          ELSE (SELECT w_text FROM norm) * (i.embedding <=> query_embedding)
             + (SELECT w_image FROM norm) * (s.image_embedding <=> query_image_embedding)
        END
      ) * CASE WHEN i.rating = 5 THEN 0.85 ELSE 1.0 END AS distance
    FROM public.prompt_lab_iterations i
    LEFT JOIN public.prompt_lab_sessions s ON s.id = i.session_id
    WHERE i.embedding IS NOT NULL
      AND i.rating IS NOT NULL
      AND i.rating >= min_rating
      AND (p_pipeline_version IS NULL OR i.pipeline_version = p_pipeline_version)
  ),
  prod AS (
    SELECT
      'prod'::text AS source,
      r.id AS example_id,
      r.rating,
      jsonb_build_object(
        'room_type',        COALESCE(r.rated_room_type,          p.room_type),
        'key_features',     COALESCE(r.rated_photo_key_features, p.key_features),
        'composition',      COALESCE(r.rated_composition,        p.composition),
        'aesthetic_score',  COALESCE(r.rated_aesthetic_score,    p.aesthetic_score),
        'depth_rating',     COALESCE(r.rated_depth_rating,       p.depth_rating),
        'suggested_motion', p.suggested_motion,
        'motion_rationale', p.motion_rationale,
        'video_viable',     p.video_viable
      ) AS analysis_json,
      jsonb_build_object(
        'scene_number',       s.scene_number,
        'camera_movement',    COALESCE(r.rated_camera_movement, s.camera_movement::text),
        'prompt',             COALESCE(r.rated_prompt,          s.prompt),
        'duration_seconds',   COALESCE(r.rated_duration_seconds, s.duration_seconds),
        'provider_preference', COALESCE(r.rated_provider,       s.provider)
      ) AS director_output_json,
      COALESCE(r.rated_prompt,         s.prompt)             AS prompt,
      COALESCE(r.rated_camera_movement, s.camera_movement::text) AS camera_movement,
      CASE COALESCE(r.rated_provider, s.provider)
        WHEN 'kling'  THEN 'kling-v2-native'
        WHEN 'runway' THEN 'runway'
        WHEN 'luma'   THEN 'luma'
        ELSE NULL
      END AS model_used,
      COALESCE(r.rated_clip_url, s.clip_url) AS clip_url,
      r.tags,
      r.comment,
      NULL::text AS refinement,
      (
        CASE
          WHEN query_image_embedding IS NULL OR p.image_embedding IS NULL
            THEN (COALESCE(r.rated_embedding, s.embedding) <=> query_embedding)
          ELSE (SELECT w_text FROM norm) * (COALESCE(r.rated_embedding, s.embedding) <=> query_embedding)
             + (SELECT w_image FROM norm) * (p.image_embedding <=> query_image_embedding)
        END
      ) * CASE WHEN r.rating = 5 THEN 0.85 ELSE 1.0 END AS distance
    FROM public.scene_ratings r
    LEFT JOIN public.scenes s ON s.id = r.scene_id
    LEFT JOIN public.photos p ON p.id = s.photo_id
    LEFT JOIN public.properties prop ON prop.id = r.property_id
    WHERE r.rating >= min_rating
      AND COALESCE(r.rated_embedding, s.embedding) IS NOT NULL
      AND (p_pipeline_version IS NULL OR COALESCE(prop.pipeline_mode, 'v1') = p_pipeline_version)
  ),
  listing AS (
    SELECT
      'listing'::text AS source,
      i.id AS example_id,
      i.rating,
      NULL::jsonb AS analysis_json,
      NULL::jsonb AS director_output_json,
      i.director_prompt AS prompt,
      sc.camera_movement::text AS camera_movement,
      i.model_used,
      i.clip_url,
      i.tags,
      i.user_comment AS comment,
      NULL::text AS refinement,
      (i.embedding <=> query_embedding)
        * CASE WHEN i.rating = 5 THEN 0.85 ELSE 1.0 END AS distance
    FROM public.prompt_lab_listing_scene_iterations i
    JOIN public.prompt_lab_listing_scenes sc ON sc.id = i.scene_id
    WHERE i.embedding IS NOT NULL
      AND i.rating IS NOT NULL
      AND i.rating >= min_rating
      AND NOT COALESCE(i.archived, false)
      AND (p_pipeline_version IS NULL OR i.pipeline_version = p_pipeline_version)
  )
  SELECT * FROM lab
  UNION ALL SELECT * FROM prod
  UNION ALL SELECT * FROM listing
  ORDER BY distance ASC
  LIMIT match_count;
$$ LANGUAGE sql STABLE;

-- =========================================================================
-- match_loser_examples — losers (rating <= max_rating)
-- =========================================================================
CREATE FUNCTION public.match_loser_examples(
  query_embedding       vector(1536),
  max_rating            int     DEFAULT 2,
  match_count           int     DEFAULT 3,
  query_image_embedding vector(768) DEFAULT NULL,
  text_weight           float   DEFAULT 0.4,
  image_weight          float   DEFAULT 0.6,
  p_pipeline_version    text    DEFAULT NULL
)
RETURNS TABLE(
  source               text,
  example_id           uuid,
  rating               int,
  analysis_json        jsonb,
  director_output_json jsonb,
  prompt               text,
  camera_movement      text,
  model_used           text,
  clip_url             text,
  tags                 text[],
  comment              text,
  refinement           text,
  distance             float
) AS $$
  WITH norm AS (
    SELECT
      CASE WHEN NULLIF(text_weight + image_weight, 0) IS NULL THEN 1.0
           ELSE text_weight / (text_weight + image_weight) END AS w_text,
      CASE WHEN NULLIF(text_weight + image_weight, 0) IS NULL THEN 0.0
           ELSE image_weight / (text_weight + image_weight) END AS w_image
  ),
  lab AS (
    SELECT
      'lab'::text AS source,
      i.id AS example_id,
      i.rating,
      i.analysis_json,
      i.director_output_json,
      NULL::text AS prompt,
      NULL::text AS camera_movement,
      CASE i.provider
        WHEN 'kling'   THEN 'kling-v2-native'
        WHEN 'runway'  THEN 'runway'
        WHEN 'luma'    THEN 'luma'
        ELSE NULL
      END AS model_used,
      i.clip_url,
      i.tags,
      i.user_comment AS comment,
      i.refinement_instruction AS refinement,
      CASE
        WHEN query_image_embedding IS NULL OR s.image_embedding IS NULL
          THEN (i.embedding <=> query_embedding)
        ELSE (SELECT w_text FROM norm) * (i.embedding <=> query_embedding)
           + (SELECT w_image FROM norm) * (s.image_embedding <=> query_image_embedding)
      END AS distance
    FROM public.prompt_lab_iterations i
    LEFT JOIN public.prompt_lab_sessions s ON s.id = i.session_id
    WHERE i.embedding IS NOT NULL
      AND i.rating IS NOT NULL
      AND i.rating <= max_rating
      AND (p_pipeline_version IS NULL OR i.pipeline_version = p_pipeline_version)
  ),
  prod AS (
    SELECT
      'prod'::text AS source,
      r.id AS example_id,
      r.rating,
      jsonb_build_object(
        'room_type',        COALESCE(r.rated_room_type,          p.room_type),
        'key_features',     COALESCE(r.rated_photo_key_features, p.key_features),
        'composition',      COALESCE(r.rated_composition,        p.composition),
        'aesthetic_score',  COALESCE(r.rated_aesthetic_score,    p.aesthetic_score),
        'depth_rating',     COALESCE(r.rated_depth_rating,       p.depth_rating),
        'suggested_motion', p.suggested_motion,
        'motion_rationale', p.motion_rationale,
        'video_viable',     p.video_viable
      ) AS analysis_json,
      jsonb_build_object(
        'scene_number',       s.scene_number,
        'camera_movement',    COALESCE(r.rated_camera_movement, s.camera_movement::text),
        'prompt',             COALESCE(r.rated_prompt,          s.prompt),
        'duration_seconds',   COALESCE(r.rated_duration_seconds, s.duration_seconds),
        'provider_preference', COALESCE(r.rated_provider,       s.provider)
      ) AS director_output_json,
      COALESCE(r.rated_prompt,          s.prompt)                  AS prompt,
      COALESCE(r.rated_camera_movement, s.camera_movement::text)   AS camera_movement,
      CASE COALESCE(r.rated_provider, s.provider)
        WHEN 'kling'  THEN 'kling-v2-native'
        WHEN 'runway' THEN 'runway'
        WHEN 'luma'   THEN 'luma'
        ELSE NULL
      END AS model_used,
      COALESCE(r.rated_clip_url, s.clip_url) AS clip_url,
      r.tags,
      r.comment,
      NULL::text AS refinement,
      CASE
        WHEN query_image_embedding IS NULL OR p.image_embedding IS NULL
          THEN (COALESCE(r.rated_embedding, s.embedding) <=> query_embedding)
        ELSE (SELECT w_text FROM norm) * (COALESCE(r.rated_embedding, s.embedding) <=> query_embedding)
           + (SELECT w_image FROM norm) * (p.image_embedding <=> query_image_embedding)
      END AS distance
    FROM public.scene_ratings r
    LEFT JOIN public.scenes s ON s.id = r.scene_id
    LEFT JOIN public.photos p ON p.id = s.photo_id
    LEFT JOIN public.properties prop ON prop.id = r.property_id
    WHERE r.rating <= max_rating
      AND COALESCE(r.rated_embedding, s.embedding) IS NOT NULL
      AND (p_pipeline_version IS NULL OR COALESCE(prop.pipeline_mode, 'v1') = p_pipeline_version)
  ),
  listing AS (
    SELECT
      'listing'::text AS source,
      i.id AS example_id,
      i.rating,
      NULL::jsonb AS analysis_json,
      NULL::jsonb AS director_output_json,
      i.director_prompt AS prompt,
      sc.camera_movement::text AS camera_movement,
      i.model_used,
      i.clip_url,
      i.tags,
      i.user_comment AS comment,
      NULL::text AS refinement,
      (i.embedding <=> query_embedding) AS distance
    FROM public.prompt_lab_listing_scene_iterations i
    JOIN public.prompt_lab_listing_scenes sc ON sc.id = i.scene_id
    WHERE i.embedding IS NOT NULL
      AND i.rating IS NOT NULL
      AND i.rating <= max_rating
      AND NOT COALESCE(i.archived, false)
      AND (p_pipeline_version IS NULL OR i.pipeline_version = p_pipeline_version)
  )
  SELECT * FROM lab
  UNION ALL SELECT * FROM prod
  UNION ALL SELECT * FROM listing
  ORDER BY distance ASC
  LIMIT match_count;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION public.match_rated_examples IS
  'Winner-exemplar retrieval across Lab + prod + Listings-Lab sources. Optional p_pipeline_version filter scopes the join to one pipeline version so v1 and v1.1 training signals stay isolated. NULL = legacy unscoped behavior.';

COMMENT ON FUNCTION public.match_loser_examples IS
  'Loser-exemplar retrieval mirror of match_rated_examples. Same p_pipeline_version filter semantics.';
