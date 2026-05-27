// GET /api/gen2/lab/pair-queue?listingId=X&limit=20&mode=directors_cut|apprentice_review
// Auth-gated. Loads scene graph, generates candidates, optionally appends Apprentice predictions.
// Returns features_blob pre-computed server-side for each candidate so UI can pass it
// through on label submit (picker training data).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import { getPhotosForV21Listing } from "../../../lib/gen2-v21/photo-source.js";
import type { PairCandidate, PropertySceneGraph, PairLabel, PickerFeatures } from "../../../lib/gen2-v21/types.js";
import { generateCandidates } from "../../../lib/gen2-v21/candidates/index.js";
import { predictLabel } from "../../../lib/gen2-v21/apprentice/index.js";
import { extractFeatures } from "../../../lib/gen2-v21/picker/features.js";
import { embedImage, isEnabled as embeddingsEnabled } from "../../../lib/embeddings-image.js";
import { computePixelBrightness } from "../../../lib/gen2-v21/picker/feature-helpers.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.GEN2_V21_ENABLED !== "true") {
    return res.status(404).json({ error: "Not found" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const listingId = req.query.listingId as string | undefined;
  const limit = Math.min(parseInt((req.query.limit as string) ?? "20", 10) || 20, 100);
  const mode = (req.query.mode as string) ?? "directors_cut";

  if (!listingId) {
    return res.status(400).json({ error: "listingId is required" });
  }

  const supabase = getSupabase();

  try {
    // Load persisted scene graph and listing name in parallel
    const [sgResult, propertyResult] = await Promise.all([
      supabase
        .from("gen2_scene_graphs")
        .select("payload, model_version, extracted_at")
        .eq("listing_id", listingId)
        .single(),
      supabase
        .from("properties")
        .select("address")
        .eq("id", listingId)
        .maybeSingle(),
    ]);

    if (sgResult.error || !sgResult.data) {
      return res.status(404).json({ error: "Scene graph not found. Run extract-scene-graph first." });
    }

    const sgRow = sgResult.data;
    const listingName = (propertyResult.data as { address?: string } | null)?.address ?? "";
    const sceneGraph = sgRow.payload as unknown as PropertySceneGraph;

    // Build a photo-facts lookup from the scene graph (no extra DB round-trip)
    const factsMap = new Map(sceneGraph.photos.map((f) => [f.photo_id, f]));

    // Generate candidates (synchronous pure function)
    const allCandidates = generateCandidates(sceneGraph);

    // Fetch existing labels for this listing to filter already-labeled pairs
    const { data: existingLabels, count: labelCount } = await supabase
      .from("gen2_pair_labels")
      .select("photo_a_id, photo_b_id", { count: "exact" })
      .eq("listing_id", listingId);

    // Build a Set of canonical pair keys: sort both IDs and join with "|"
    // This makes the filter order-independent (A|B == B|A)
    const labeledPairKeys = new Set<string>(
      (existingLabels ?? []).map((l: { photo_a_id: string; photo_b_id: string }) => {
        const [first, second] = [l.photo_a_id, l.photo_b_id].sort();
        return `${first}|${second}`;
      })
    );

    // Filter out already-labeled pairs from all candidates
    const unlabeledCandidates = allCandidates.filter((c) => {
      const [first, second] = [c.photo_a_id, c.photo_b_id].sort();
      return !labeledPairKeys.has(`${first}|${second}`);
    });
    const alreadyLabeledCount = allCandidates.length - unlabeledCandidates.length;

    // Sort by heuristic_score desc, apply offset + limit
    const offset = Math.max(0, parseInt((req.query.offset as string) ?? "0", 10) || 0);
    const sorted = unlabeledCandidates.sort((a, b) => b.heuristic_score - a.heuristic_score);
    const ranked = sorted.slice(offset, offset + limit);

    // Batch-fetch photo URLs for all candidate photos in this page.
    // getPhotosForV21Listing resolves from photos (real listings) or
    // prompt_lab_listing_photos (lab listings) transparently.
    const listingPhotoRefs = await getPhotosForV21Listing(listingId);
    const photoUrlMap = new Map(listingPhotoRefs.map((p) => [p.id, p.url]));

    // ── Build per-photo feature caches ────────────────────────────────────────
    // Collect distinct photo IDs referenced by the current page of candidates.
    const pagePhotoIds = new Set<string>();
    for (const c of ranked) {
      pagePhotoIds.add(c.photo_a_id);
      pagePhotoIds.add(c.photo_b_id);
    }

    // 1. Embeddings: try to load from photos.image_embedding in bulk first.
    const embeddingCache = new Map<string, number[]>();

    // Check if this is a real-property listing (photos table) by seeing if any
    // photo ref appears in the photos table. If getPhotosForV21Listing returned
    // rows and they came from photos (not lab), we do a bulk select.
    const idsToFetch = [...pagePhotoIds];
    if (idsToFetch.length > 0) {
      const { data: photoEmbRows } = await supabase
        .from("photos")
        .select("id, image_embedding")
        .in("id", idsToFetch);

      if (photoEmbRows) {
        for (const row of photoEmbRows) {
          const emb = row.image_embedding;
          if (Array.isArray(emb) && emb.length > 0) {
            embeddingCache.set(row.id, emb as number[]);
          }
        }
      }
    }

    // For photos not resolved via the DB (lab photos, or photos table without
    // image_embedding populated), generate on demand if embeddings are enabled.
    // Cache per request to avoid redundant API calls for the same photo ID.
    async function getEmbedding(photoId: string): Promise<number[] | null> {
      if (embeddingCache.has(photoId)) return embeddingCache.get(photoId)!;
      const url = photoUrlMap.get(photoId);
      if (!url) return null;
      if (!embeddingsEnabled()) return null;
      try {
        const result = await embedImage({ imageUrl: url, photoId, surface: "lab" });
        embeddingCache.set(photoId, result.vector);
        return result.vector;
      } catch (err) {
        console.warn(`[pair-queue] embedding generation failed for photo ${photoId}:`, err instanceof Error ? err.message : String(err));
        return null;
      }
    }

    // 2. Pixel brightness: compute lazily per photo, cache in map.
    const brightnessCache = new Map<string, number | null>();
    async function getBrightness(photoId: string): Promise<number | null> {
      if (brightnessCache.has(photoId)) return brightnessCache.get(photoId)!;
      const url = photoUrlMap.get(photoId);
      if (!url) {
        brightnessCache.set(photoId, null);
        return null;
      }
      const brightness = await computePixelBrightness(url);
      brightnessCache.set(photoId, brightness);
      return brightness;
    }

    /**
     * Compute features_blob server-side for a candidate.
     * Returns null if scene facts are missing for either photo (cold-start / legacy SG).
     */
    async function computeFeatures(candidate: PairCandidate): Promise<PickerFeatures | null> {
      const factsA = factsMap.get(candidate.photo_a_id);
      const factsB = factsMap.get(candidate.photo_b_id);
      if (!factsA || !factsB) return null;

      const [embA, embB, brightnessA, brightnessB] = await Promise.all([
        getEmbedding(candidate.photo_a_id),
        getEmbedding(candidate.photo_b_id),
        getBrightness(candidate.photo_a_id),
        getBrightness(candidate.photo_b_id),
      ]);

      return extractFeatures(candidate, factsA, factsB, embA, embB, brightnessA, brightnessB);
    }

    // Build all_property_photos for filmstrip (all photos for this listing, not just queue)
    const allPropertyPhotos = listingPhotoRefs.map((p) => ({ id: p.id, url: p.url }));

    if (mode !== "apprentice_review") {
      // Directors Cut: return items with photo URLs + features_blob + picker predictions
      const items = await Promise.all(ranked.map(async (candidate) => ({
        candidate_id: candidate.candidate_id,
        listing_id: candidate.listing_id,
        photo_a_id: candidate.photo_a_id,
        photo_b_id: candidate.photo_b_id,
        photo_a_url: photoUrlMap.get(candidate.photo_a_id) ?? "",
        photo_b_url: photoUrlMap.get(candidate.photo_b_id) ?? "",
        candidate_type: candidate.candidate_type,
        heuristic_score: candidate.heuristic_score,
        reasoning: candidate.reasoning,
        portal_id: candidate.portal_id,
        picker_prediction: null as null,     // populated by separate picker endpoint if live
        apprentice_prediction: null as null,
        features_blob: await computeFeatures(candidate),
        scene_graph_version: sgRow.model_version,
      })));

      return res.status(200).json({
        items,
        total_remaining: Math.max(0, unlabeledCandidates.length - offset - ranked.length),
        listing_name: listingName,
        total_labels_for_property: labelCount ?? 0,
        already_labeled_count: alreadyLabeledCount,
        all_property_photos: allPropertyPhotos,
        offset: offset + ranked.length,
      });
    }

    // ── Apprentice Review mode ────────────────────────────────────────────────

    // Fetch recent operator labels for few-shot
    const { data: recentLabels } = await supabase
      .from("gen2_pair_labels")
      .select("*")
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false })
      .limit(10);

    const typedLabels = (recentLabels ?? []) as PairLabel[];

    // Fetch photo URLs for few-shot examples (all photo ids referenced by recent labels)
    const fewShotPhotoIds = [
      ...new Set(typedLabels.flatMap((l) => [l.photo_a_id, l.photo_b_id])),
    ];
    // photoUrlMap was built from getPhotosForV21Listing above (covers both sources).
    // All photo IDs for this listing are already in the map; no supplemental fetch needed.
    void fewShotPhotoIds; // referenced to avoid unused-var lint

    // Build few-shot examples for predictLabel (candidate + photos required per example)
    const fewShotExamples = typedLabels
      .map((label) => {
        const aUrl = photoUrlMap.get(label.photo_a_id);
        const bUrl = photoUrlMap.get(label.photo_b_id);
        if (!aUrl || !bUrl) return null;
        // Stub candidate — only fields consumed by buildFewShotText are used
        const stubCandidate: PairCandidate = {
          candidate_id: label.label_id,
          listing_id: label.listing_id,
          photo_a_id: label.photo_a_id,
          photo_b_id: label.photo_b_id,
          candidate_type: "same_room_different_angle",
          heuristic_score: label.model_prediction_at_time ?? 0,
          reasoning: "",
          portal_id: null,
        };
        return {
          candidate: stubCandidate,
          photoA: { url: aUrl },
          photoB: { url: bUrl },
          label,
        };
      })
      .filter((ex): ex is NonNullable<typeof ex> => ex !== null);

    // Run predictions in parallel (best-effort — predictLabel never throws)
    const items = await Promise.all(
      ranked.map(async (candidate) => {
        const photoA = { url: photoUrlMap.get(candidate.photo_a_id) ?? "" };
        const photoB = { url: photoUrlMap.get(candidate.photo_b_id) ?? "" };
        const prediction = await predictLabel(candidate, photoA, photoB, fewShotExamples);
        return {
          candidate,
          apprentice: prediction,
          picker: null as null,
          photo_a_url: photoA.url,
          photo_b_url: photoB.url,
          thumbnail_hash_a: "",
          thumbnail_hash_b: "",
          scene_graph_version: sgRow.model_version,
          features_blob: await computeFeatures(candidate),
        };
      })
    );

    return res.status(200).json({
      items,
      total_remaining: Math.max(0, unlabeledCandidates.length - offset - ranked.length),
      listing_name: listingName,
      total_labels_for_property: labelCount ?? 0,
      already_labeled_count: alreadyLabeledCount,
      all_property_photos: allPropertyPhotos,
      offset: offset + ranked.length,
    });
  } catch (err) {
    console.error("[pair-queue] error:", err);
    return res.status(500).json({ error: "Failed to generate pair queue", detail: String(err) });
  }
}
