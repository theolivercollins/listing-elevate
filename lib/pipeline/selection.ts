import type { RoomType } from "../db.js";
import type { PhotoAnalysisResult } from "../prompts/photo-analysis.js";

// Production photo-selection algorithm. Picks up to TARGET_SCENE_COUNT photos
// for a listing video. Required room types first, bonus rooms, then fills
// remaining slots by aesthetic score with a per-room cap.
//
// The same algorithm is used by the prod pipeline (runAnalysis) and by the
// Prompt Lab batch-selection endpoint — keep it here so they can't drift.

export const TARGET_SCENE_COUNT = 12;
export const MAX_PER_ROOM_TYPE = 2;

export const REQUIRED_ROOM_TYPES: RoomType[] = [
  "exterior_front",
  "kitchen",
  "living_room",
  "master_bedroom",
  "bathroom",
];

const BONUS_ROOM_TYPES: RoomType[] = ["exterior_back", "aerial"];

const ROOM_TYPE_SET = new Set<RoomType>([
  "kitchen",
  "living_room",
  "master_bedroom",
  "bedroom",
  "bathroom",
  "exterior_front",
  "exterior_back",
  "pool",
  "aerial",
  "dining",
  "hallway",
  "garage",
  "foyer",
  "office",
  "laundry",
  "closet",
  "basement",
  "deck",
  "powder_room",
  "stairs",
  "media_room",
  "gym",
  "mudroom",
  "lanai",
  "other",
]);

const STATIC_ROOM_TYPE_ADJUSTMENTS: Partial<Record<RoomType, number>> = {
  laundry: -1.75,
  mudroom: -1.35,
  closet: -2.25,
  garage: -1.75,
  hallway: -1.2,
  stairs: -1.1,
};

const POSITIVE_FEEDBACK_WEIGHTS: Record<string, number> = {
  hero_exterior: 0.5,
  primary_room: 0.45,
  feature_room: 0.4,
  necessary_coverage: 0.35,
  strong_motion_potential: 0.2,
};

const LEARNING_MIN_ADJUSTMENT = -2.5;
const LEARNING_MAX_ADJUSTMENT = 1.25;

export type SelectionStatus = "selected" | "not_selected" | "discarded";

export interface SelectionVerdict {
  status: SelectionStatus;
  /** 1-based position in the selected list; null for non-selected. */
  rank: number | null;
  /** Human-readable reason. Tells the operator WHY this photo was/wasn't picked. */
  reason: string;
}

export interface SelectionExplanation<T> {
  selected: T[];
  verdicts: Map<string, SelectionVerdict>;
  target: number;
  max_per_room: number;
  required_rooms: RoomType[];
}

export interface PhotoSelectionLearning {
  room_type_adjustments: Partial<Record<RoomType, number>>;
  event_count: number;
}

export interface SelectionOptions {
  learning?: PhotoSelectionLearning;
}

type AnalysisSubset = Pick<
  PhotoAnalysisResult,
  "room_type" | "aesthetic_score" | "suggested_discard" | "discard_reason" | "video_viable" | "motion_rationale"
>;

/**
 * Pick up to TARGET_SCENE_COUNT photos for a listing. Callers just want the
 * selected subset. For the explained version (with per-photo verdicts) use
 * selectPhotosWithExplanation.
 */
export function selectPhotos<A extends AnalysisSubset>(
  results: Array<{ photo: { id: string }; analysis: A; provider?: string }>,
  options?: SelectionOptions,
): Array<{ photo: { id: string }; analysis: A; provider?: string }> {
  const { selected } = selectPhotosWithExplanation(
    results.map((r) => ({ id: r.photo.id, original: r, analysis: r.analysis })),
    options,
  );
  return selected.map((x) => x.original);
}

/**
 * Pick up to TARGET_SCENE_COUNT photos AND attach a verdict to every input
 * explaining why it was selected / not-selected / discarded. The explainer
 * is instrumented inline rather than reverse-engineered after the fact so
 * the reasons reflect the actual decisions the algorithm made.
 */
export function selectPhotosWithExplanation<T extends { id: string; analysis: AnalysisSubset }>(
  results: T[],
  options: SelectionOptions = {},
): SelectionExplanation<T> {
  const verdicts = new Map<string, SelectionVerdict>();

  // Pass 1 — discard photos the analyzer flagged or marked non-viable.
  for (const r of results) {
    if (r.analysis.suggested_discard) {
      verdicts.set(r.id, {
        status: "discarded",
        rank: null,
        reason: r.analysis.discard_reason ?? "Analyzer flagged for discard",
      });
    } else if (r.analysis.video_viable === false) {
      verdicts.set(r.id, {
        status: "discarded",
        rank: null,
        reason: `Not usable as video starting frame — ${r.analysis.motion_rationale ?? "no clean motion path"}`,
      });
    }
  }

  const candidates = results.filter((r) => !verdicts.has(r.id));

  // Group candidates by room type, sort each group by aesthetic desc.
  const byRoom = new Map<RoomType, T[]>();
  for (const c of candidates) {
    const list = byRoom.get(c.analysis.room_type) ?? [];
    list.push(c);
    byRoom.set(c.analysis.room_type, list);
  }
  for (const group of byRoom.values()) {
    group.sort((a, b) => b.analysis.aesthetic_score - a.analysis.aesthetic_score);
  }

  const selected: T[] = [];

  // Pass 2 — pick the top photo from each required room type.
  for (const rt of REQUIRED_ROOM_TYPES) {
    const group = byRoom.get(rt);
    if (group?.[0] && !selected.some((s) => s.analysis.room_type === rt)) {
      const winner = group[0];
      selected.push(winner);
      verdicts.set(winner.id, {
        status: "selected",
        rank: selected.length,
        reason: `Required room — ${formatRoomType(rt)} (aesthetic ${winner.analysis.aesthetic_score.toFixed(1)}/10)`,
      });
    }
  }

  // Pass 3 — bonus rooms: exterior_back and aerial if present.
  for (const rt of BONUS_ROOM_TYPES) {
    const group = byRoom.get(rt);
    if (group?.[0] && !selected.some((s) => s.analysis.room_type === rt)) {
      const winner = group[0];
      selected.push(winner);
      verdicts.set(winner.id, {
        status: "selected",
        rank: selected.length,
        reason: `Bonus room — ${formatRoomType(rt)} (aesthetic ${winner.analysis.aesthetic_score.toFixed(1)}/10)`,
      });
    }
  }

  // Pass 4 — fill remaining slots by aesthetic score with a per-room cap.
  const remaining = candidates
    .filter((c) => !selected.includes(c))
    .sort((a, b) => {
      const scoreDiff = getFillScore(b, options.learning) - getFillScore(a, options.learning);
      if (scoreDiff !== 0) return scoreDiff;
      const aestheticDiff = b.analysis.aesthetic_score - a.analysis.aesthetic_score;
      if (aestheticDiff !== 0) return aestheticDiff;
      return a.id.localeCompare(b.id);
    });

  for (const candidate of remaining) {
    const fillScore = getFillScore(candidate, options.learning);
    const adjustmentSummary = describeAdjustment(candidate.analysis.room_type, options.learning);

    if (selected.length >= TARGET_SCENE_COUNT) {
      verdicts.set(candidate.id, {
        status: "not_selected",
        rank: null,
        reason: `Scene cap of ${TARGET_SCENE_COUNT} already reached (fill score ${fillScore.toFixed(2)} from aesthetic ${candidate.analysis.aesthetic_score.toFixed(1)}/10, ${formatRoomType(candidate.analysis.room_type)}${adjustmentSummary ? `; ${adjustmentSummary}` : ""})`,
      });
      continue;
    }
    const count = selected.filter((s) => s.analysis.room_type === candidate.analysis.room_type).length;
    if (count >= MAX_PER_ROOM_TYPE) {
      const winners = selected.filter((s) => s.analysis.room_type === candidate.analysis.room_type);
      const winnerScores = winners.map((w) => w.analysis.aesthetic_score.toFixed(1)).join(", ");
      verdicts.set(candidate.id, {
        status: "not_selected",
        rank: null,
        reason: `${formatRoomType(candidate.analysis.room_type)} quota full (max ${MAX_PER_ROOM_TYPE}, already picked ${winnerScores}/10; this photo ${candidate.analysis.aesthetic_score.toFixed(1)}/10${adjustmentSummary ? `; ${adjustmentSummary}` : ""})`,
      });
      continue;
    }
    selected.push(candidate);
    verdicts.set(candidate.id, {
      status: "selected",
      rank: selected.length,
      reason: `Fill slot — fill score ${fillScore.toFixed(2)} from aesthetic ${candidate.analysis.aesthetic_score.toFixed(1)}/10, ${formatRoomType(candidate.analysis.room_type)}${adjustmentSummary ? `; ${adjustmentSummary}` : ""}`,
    });
  }

  // Final safety net: any candidate without a verdict (shouldn't happen) gets
  // a catch-all.
  for (const c of candidates) {
    if (!verdicts.has(c.id)) {
      verdicts.set(c.id, { status: "not_selected", rank: null, reason: "Not reached in fill pass" });
    }
  }

  return {
    selected,
    verdicts,
    target: TARGET_SCENE_COUNT,
    max_per_room: MAX_PER_ROOM_TYPE,
    required_rooms: REQUIRED_ROOM_TYPES,
  };
}

function formatRoomType(rt: string): string {
  return rt.replace(/_/g, " ");
}

export function buildPhotoSelectionLearning(
  events: Array<{ payload?: unknown }>,
): PhotoSelectionLearning {
  const totals = new Map<RoomType, number>();
  let eventCount = 0;

  for (const event of events) {
    if (!isRecord(event?.payload)) continue;
    eventCount += 1;

    for (const signal of getSignals(event.payload, "removed")) {
      const roomType = parseRoomType(signal.room_type);
      if (!roomType) continue;
      if (getFeedbackCategory(signal) === "low_value_room") {
        addAdjustment(totals, roomType, -1.3);
      }
    }

    for (const signal of getSignals(event.payload, "added")) {
      const roomType = parseRoomType(signal.room_type);
      if (!roomType) continue;
      const delta = getPositiveFeedbackWeight(getFeedbackCategory(signal), "added");
      if (delta !== 0) addAdjustment(totals, roomType, delta);
    }

    for (const signal of getSignals(event.payload, "kept")) {
      const roomType = parseRoomType(signal.room_type);
      if (!roomType) continue;
      const delta = getPositiveFeedbackWeight(getFeedbackCategory(signal), "kept");
      if (delta !== 0) addAdjustment(totals, roomType, delta);
    }
  }

  const room_type_adjustments: Partial<Record<RoomType, number>> = {};
  for (const [roomType, total] of totals) {
    room_type_adjustments[roomType] = clamp(total, LEARNING_MIN_ADJUSTMENT, LEARNING_MAX_ADJUSTMENT);
  }

  return {
    room_type_adjustments,
    event_count: eventCount,
  };
}

function getFillScore(
  candidate: { analysis: Pick<AnalysisSubset, "room_type" | "aesthetic_score"> },
  learning?: PhotoSelectionLearning,
): number {
  return candidate.analysis.aesthetic_score + getTotalRoomAdjustment(candidate.analysis.room_type, learning);
}

function getTotalRoomAdjustment(roomType: RoomType, learning?: PhotoSelectionLearning): number {
  const staticAdjustment = STATIC_ROOM_TYPE_ADJUSTMENTS[roomType] ?? 0;
  const learnedAdjustment = learning?.room_type_adjustments[roomType] ?? 0;
  return staticAdjustment + learnedAdjustment;
}

function describeAdjustment(roomType: RoomType, learning?: PhotoSelectionLearning): string | null {
  const staticAdjustment = STATIC_ROOM_TYPE_ADJUSTMENTS[roomType] ?? 0;
  const learnedAdjustment = learning?.room_type_adjustments[roomType] ?? 0;
  const parts: string[] = [];

  if (staticAdjustment !== 0) {
    parts.push(`low-value room ${formatSignedNumber(staticAdjustment)}`);
  }
  if (learnedAdjustment !== 0) {
    parts.push(`selection learning ${formatSignedNumber(learnedAdjustment)}`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

function addAdjustment(map: Map<RoomType, number>, roomType: RoomType, delta: number): void {
  map.set(roomType, (map.get(roomType) ?? 0) + delta);
}

function getSignals(
  payload: Record<string, unknown>,
  key: "removed" | "added" | "kept",
): Array<{ room_type?: unknown; operator_feedback?: unknown }> {
  const raw = payload[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord);
}

function getFeedbackCategory(signal: { operator_feedback?: unknown }): string | null {
  if (!isRecord(signal.operator_feedback)) return null;
  return typeof signal.operator_feedback.category === "string"
    ? signal.operator_feedback.category
    : null;
}

function getPositiveFeedbackWeight(category: string | null, source: "added" | "kept"): number {
  if (!category) return 0;
  const base = POSITIVE_FEEDBACK_WEIGHTS[category] ?? 0;
  if (base === 0) return 0;
  return source === "added" ? base : base * 0.75;
}

function parseRoomType(value: unknown): RoomType | null {
  return typeof value === "string" && ROOM_TYPE_SET.has(value as RoomType)
    ? value as RoomType
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatSignedNumber(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
