import { getSupabase } from '../client.js';
import { getRun } from './runs.js';

export type PhotoSelectionCandidate = {
  id: string;
  file_url: string;
  file_name: string | null;
  selected: boolean | null;
  room_type: string | null;
  aesthetic_score: number | null;
  quality_score: number | null;
  analysis_provider: string | null;
  discard_reason: string | null;
  analysis_json: Record<string, unknown> | null;
  photo_selection_rank?: number | null;
};

export type PhotoSelectionRejected = {
  photo_id: string;
  category?: PhotoFeedbackCategory | null;
  reason?: string | null;
};

export type PhotoSelectionAccepted = {
  photo_id: string;
  category?: PhotoFeedbackCategory | null;
  note?: string | null;
};

export type PhotoSelectionApproval = {
  photo_order: string[];
  accepted?: PhotoSelectionAccepted[];
  rejected?: PhotoSelectionRejected[];
};

export const PHOTO_FEEDBACK_CATEGORIES = [
  'low_value_room',
  'duplicate_or_redundant',
  'weak_video_potential',
  'poor_quality',
  'bad_composition',
  'not_representative',
  'hero_exterior',
  'primary_room',
  'feature_room',
  'strong_motion_potential',
  'necessary_coverage',
  'other',
] as const;

export type PhotoFeedbackCategory = typeof PHOTO_FEEDBACK_CATEGORIES[number];

const PHOTO_FEEDBACK_CATEGORY_SET = new Set<string>(PHOTO_FEEDBACK_CATEGORIES);

export function normalizePhotoFeedbackCategory(value: unknown): PhotoFeedbackCategory | null {
  return typeof value === 'string' && PHOTO_FEEDBACK_CATEGORY_SET.has(value)
    ? value as PhotoFeedbackCategory
    : null;
}

type OperatorFeedback = {
  category: PhotoFeedbackCategory | null;
  note?: string | null;
  reason?: string | null;
};

type PhotoSignal = {
  id: string;
  room_type: string | null;
  aesthetic_score: number | null;
  quality_score: number | null;
  analysis_provider: string | null;
  discard_reason: string | null;
  operator_reason?: string | null;
  operator_feedback?: OperatorFeedback | null;
  analysis_summary: {
    suggested_motion?: unknown;
    motion_headroom?: unknown;
    key_features?: unknown;
  };
};

export function buildPhotoSelectionEventPayload(input: {
  before: string[];
  after: string[];
  photos: PhotoSelectionCandidate[];
  accepted?: PhotoSelectionAccepted[];
  rejected?: PhotoSelectionRejected[];
}): {
  before: string[];
  after: string[];
  kept: PhotoSignal[];
  added: PhotoSignal[];
  removed: PhotoSignal[];
} {
  const photoById = new Map(input.photos.map((p) => [p.id, p]));
  const rejectedById = new Map((input.rejected ?? []).map((r) => [r.photo_id, {
    category: normalizePhotoFeedbackCategory(r.category),
    reason: r.reason ?? null,
  }]));
  const acceptedById = new Map((input.accepted ?? []).map((a) => [a.photo_id, {
    category: normalizePhotoFeedbackCategory(a.category),
    note: a.note ?? null,
  }]));
  const before = input.before;
  const after = input.after;
  const beforeSet = new Set(before);
  const afterSet = new Set(after);

  const toSignal = (id: string): PhotoSignal => {
    const p = photoById.get(id);
    const rejected = rejectedById.get(id);
    const accepted = acceptedById.get(id);
    const operatorFeedback = rejected
      ? { category: rejected.category, reason: rejected.reason }
      : accepted
        ? { category: accepted.category, note: accepted.note }
        : null;
    if (!p) {
      return {
        id,
        room_type: null,
        aesthetic_score: null,
        quality_score: null,
        analysis_provider: null,
        discard_reason: null,
        operator_reason: rejected?.reason ?? null,
        operator_feedback: operatorFeedback,
        analysis_summary: {},
      };
    }
    return {
      id: p.id,
      room_type: p.room_type,
      aesthetic_score: p.aesthetic_score,
      quality_score: p.quality_score,
      analysis_provider: p.analysis_provider,
      discard_reason: p.discard_reason,
      operator_reason: rejected?.reason ?? null,
      operator_feedback: operatorFeedback,
      analysis_summary: {
        suggested_motion: p.analysis_json?.suggested_motion,
        motion_headroom: p.analysis_json?.motion_headroom,
        key_features: p.analysis_json?.key_features,
      },
    };
  };

  return {
    before,
    after,
    kept: after.filter((id) => beforeSet.has(id)).map(toSignal),
    added: after.filter((id) => !beforeSet.has(id)).map(toSignal),
    removed: before.filter((id) => !afterSet.has(id)).map(toSignal),
  };
}

function sortSelectionPhotos(a: PhotoSelectionCandidate, b: PhotoSelectionCandidate): number {
  const rankA = a.photo_selection_rank ?? Number.POSITIVE_INFINITY;
  const rankB = b.photo_selection_rank ?? Number.POSITIVE_INFINITY;
  if (rankA !== rankB) return rankA - rankB;
  return (b.aesthetic_score ?? -1) - (a.aesthetic_score ?? -1);
}

async function fetchPhotos(propertyId: string): Promise<PhotoSelectionCandidate[]> {
  const { data, error } = await getSupabase()
    .from('photos')
    .select('id, file_url, file_name, selected, room_type, aesthetic_score, quality_score, analysis_provider, discard_reason, analysis_json, photo_selection_rank')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: true });
  if ((error as { code?: string } | null)?.code === '42703') {
    const fallback = await getSupabase()
      .from('photos')
      .select('id, file_url, file_name, selected, room_type, aesthetic_score, quality_score, analysis_provider, discard_reason, analysis_json')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: true });
    if (fallback.error) throw new Error(`getPhotoSelectionForRun: ${fallback.error.message}`);
    return (fallback.data ?? []) as PhotoSelectionCandidate[];
  }
  if (error) throw new Error(`getPhotoSelectionForRun: ${error.message}`);
  return (data ?? []) as PhotoSelectionCandidate[];
}

export async function getPhotoSelectionForRun(runId: string): Promise<{
  selected_photo_ids: string[];
  photos: PhotoSelectionCandidate[];
}> {
  const run = await getRun(runId);
  if (!run) throw new Error(`getPhotoSelectionForRun: run not found: ${runId}`);
  const photos = await fetchPhotos(run.property_id);
  const selected_photo_ids = photos
    .filter((p) => p.selected)
    .sort(sortSelectionPhotos)
    .map((p) => p.id);
  return { selected_photo_ids, photos };
}

export async function applyPhotoSelectionForRun(
  runId: string,
  input: PhotoSelectionApproval,
): Promise<{ selected_photo_ids: string[] }> {
  const run = await getRun(runId);
  if (!run) throw new Error(`applyPhotoSelectionForRun: run not found: ${runId}`);
  if (run.stage !== 'photo_selection') {
    throw new Error(`applyPhotoSelectionForRun: run must be at photo_selection, got ${run.stage}`);
  }
  const after = input.photo_order.filter(Boolean);
  if (after.length === 0) throw new Error('photo_order must include at least one photo');
  if (new Set(after).size !== after.length) throw new Error('photo_order must not contain duplicate photo ids');

  const photos = await fetchPhotos(run.property_id);
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const unknown = after.filter((id) => !photoById.has(id));
  if (unknown.length > 0) throw new Error(`photo_order contains photos outside this property: ${unknown.join(', ')}`);

  const before = photos
    .filter((p) => p.selected)
    .sort(sortSelectionPhotos)
    .map((p) => p.id);
  const afterSet = new Set(after);
  const accepted = (input.accepted ?? [])
    .map((a) => ({
      photo_id: a.photo_id,
      category: normalizePhotoFeedbackCategory(a.category),
      note: a.note?.trim() || null,
    }))
    .filter((a) => photoById.has(a.photo_id) && afterSet.has(a.photo_id));
  const rejected = (input.rejected ?? [])
    .map((r) => ({
      photo_id: r.photo_id,
      category: normalizePhotoFeedbackCategory(r.category),
      reason: r.reason?.trim() || null,
    }))
    .filter((r) => photoById.has(r.photo_id));
  const rejectReason = new Map(rejected.map((r) => [r.photo_id, r.reason]));
  const rejectCategory = new Map(rejected.map((r) => [r.photo_id, r.category]));
  const removed = before.filter((id) => !afterSet.has(id));
  const missingReasons = removed.filter((id) => !rejectReason.get(id));
  if (missingReasons.length > 0) {
    throw new Error(`removed photos require a rejection reason: ${missingReasons.join(', ')}`);
  }
  const missingCategories = removed.filter((id) => !rejectCategory.get(id));
  if (missingCategories.length > 0) {
    throw new Error(`removed photos require a rejection category: ${missingCategories.join(', ')}`);
  }

  const db = getSupabase();
  const payload = buildPhotoSelectionEventPayload({
    before,
    after,
    photos,
    accepted,
    rejected,
  });
  const { data, error } = await db.rpc('approve_photo_selection', {
    p_run_id: runId,
    p_photo_order: after,
    p_rejected: rejected,
    p_event_payload: payload,
  });
  if (error) throw new Error(`applyPhotoSelectionForRun: ${error.message}`);

  const selected = (data as { selected_photo_ids?: unknown } | null)?.selected_photo_ids;
  return {
    selected_photo_ids: Array.isArray(selected) ? selected.map(String) : after,
  };
}
