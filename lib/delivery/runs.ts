import { getSupabase } from '../client.js';
import { canAdvance, isDeliveryStage, type DeliveryStage } from './state.js';
import type { DeliveryRunRow, ListingDetails, MlEventRow, MlEventType, SceneVariantRow, DeliveryVideoType } from '../types/operator-studio.js';

const ML_EVENT_TYPES: readonly MlEventType[] = [
  'reorder', 'regenerate', 'variant_override', 'script_edit',
  'voice_choice', 'music_choice', 'rating', 'comment', 'details_edit',
  'music_feedback',
];

export async function createRun(input: {
  property_id: string;
  client_id: string | null;
  video_type: DeliveryVideoType;
  duration_seconds: number | null;
}): Promise<DeliveryRunRow> {
  const { data, error } = await getSupabase()
    .from('delivery_runs')
    .insert({ ...input, stage: 'intake' })
    .select('*')
    .single();
  if (error) throw new Error(`createRun: ${error.message}`);
  return data as DeliveryRunRow;
}

export async function getRun(runId: string): Promise<DeliveryRunRow | null> {
  const { data, error } = await getSupabase().from('delivery_runs').select('*').eq('id', runId).maybeSingle();
  if (error) throw new Error(`getRun: ${error.message}`);
  return (data as DeliveryRunRow | null) ?? null;
}

/**
 * Returns the most-recent non-delivered run for a property, or most-recent overall.
 * delivery_runs has a PARTIAL unique index on (property_id, video_type) WHERE stage <> 'delivered',
 * so there may be multiple rows per property.
 */
export async function getRunByProperty(propertyId: string): Promise<DeliveryRunRow | null> {
  // Prefer most-recent non-delivered run
  const { data: active, error: e1 } = await getSupabase()
    .from('delivery_runs')
    .select('*')
    .eq('property_id', propertyId)
    .neq('stage', 'delivered')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e1) throw new Error(`getRunByProperty: ${e1.message}`);
  if (active) return active as DeliveryRunRow;

  // Fall back to most-recent delivered
  const { data: delivered, error: e2 } = await getSupabase()
    .from('delivery_runs')
    .select('*')
    .eq('property_id', propertyId)
    .eq('stage', 'delivered')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e2) throw new Error(`getRunByProperty: ${e2.message}`);
  return (delivered as DeliveryRunRow | null) ?? null;
}

export async function getVariantsForRun(runId: string): Promise<SceneVariantRow[]> {
  const { data, error } = await getSupabase()
    .from('scene_variants').select('*').eq('delivery_run_id', runId).order('created_at', { ascending: true });
  if (error) throw new Error(`getVariantsForRun: ${error.message}`);
  return (data ?? []) as SceneVariantRow[];
}

/**
 * Scene ids on this property that are PAIRED (end_photo_id set — start+end-
 * frame interpolation). The delivery GET bundle exposes these so Checkpoint A
 * can offer the paired-only regenerate model picker (kling-v3-pro default /
 * seedance-pair opt-in) without a second round trip.
 */
export async function getPairedSceneIds(propertyId: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from('scenes')
    .select('id')
    .eq('property_id', propertyId)
    .not('end_photo_id', 'is', null);
  if (error) throw new Error(`getPairedSceneIds: ${error.message}`);
  return (data ?? []).map((r) => (r as { id: string }).id);
}

export async function getEventsForRun(runId: string): Promise<MlEventRow[]> {
  const { data, error } = await getSupabase()
    .from('ml_events').select('*').eq('run_id', runId).order('created_at', { ascending: false });
  if (error) throw new Error(`getEventsForRun: ${error.message}`);
  return (data ?? []) as MlEventRow[];
}

/** Patch arbitrary run columns (listing_details, scripts, choices…). Always bumps updated_at. */
export async function updateRun(runId: string, patch: Partial<DeliveryRunRow>): Promise<DeliveryRunRow> {
  const { data, error } = await getSupabase()
    .from('delivery_runs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId)
    .select('*')
    .single();
  if (error) throw new Error(`updateRun: ${error.message}`);
  return data as DeliveryRunRow;
}

/** Single-step stage advance, guarded by the pure state machine. Clears error.
 *  Uses a compare-and-swap UPDATE (WHERE id = runId AND stage = from) to prevent
 *  silent double-advance races between the stepper UI and cron actors. */
export async function advanceRun(runId: string, to: string): Promise<DeliveryRunRow> {
  if (!isDeliveryStage(to)) throw new Error(`advanceRun: '${to}' is not a delivery stage`);
  const run = await getRun(runId);
  if (!run) throw new Error(`advanceRun: run not found: ${runId}`);
  const from = run.stage as DeliveryStage;
  if (!canAdvance(from, to)) {
    throw new Error(`advanceRun: illegal transition ${from} -> ${to}`);
  }
  const { data, error } = await getSupabase()
    .from('delivery_runs')
    .update({ stage: to, error: null, updated_at: new Date().toISOString() })
    .eq('id', runId)
    .eq('stage', from)
    .select()
    .maybeSingle();
  if (error) throw new Error(`advanceRun: ${error.message}`);
  if (!data) throw new Error(`advanceRun: stage moved (expected ${from})`);
  return data as DeliveryRunRow;
}

/** Stage failed: keep the pointer, surface the error for per-stage retry UI. */
export async function setRunError(runId: string, message: string): Promise<DeliveryRunRow> {
  return updateRun(runId, { error: message } as Partial<DeliveryRunRow>);
}

/** Retry = clear the error; the caller re-fires the stage's side effect. */
export async function clearRunError(runId: string): Promise<DeliveryRunRow> {
  return updateRun(runId, { error: null } as Partial<DeliveryRunRow>);
}

export async function recordMlEvent(
  runId: string,
  eventType: MlEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!ML_EVENT_TYPES.includes(eventType)) {
    throw new Error(`recordMlEvent: unknown event_type '${eventType}'`);
  }
  const { error } = await getSupabase().from('ml_events').insert({ run_id: runId, event_type: eventType, payload });
  if (error) throw new Error(`recordMlEvent: ${error.message}`);
}

/** Whole-column REPLACE of listing_details (no merge) — callers must send the full field set. Used by PATCH + scrape. */
export async function setListingDetails(
  runId: string,
  details: ListingDetails,
): Promise<DeliveryRunRow> {
  return updateRun(runId, { listing_details: details } as Partial<DeliveryRunRow>);
}
