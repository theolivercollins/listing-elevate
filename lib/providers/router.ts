import type { RoomType, VideoProvider, CameraMovement } from "../db.js";
import type { PipelineMode } from "../types.js";
import type { IVideoProvider } from "./provider.interface.js";
import { AtlasProvider } from "./atlas.js";
import { KlingProvider } from "./kling.js";
import { RunwayProvider } from "./runway.js";
import { VeoProvider } from "./veo.js";
import { V1_ATLAS_SKUS, V1_DEFAULT_SKU, type V1AtlasSku, ATLAS_MODELS, isOperatorSkuAvailable } from "./atlas.js";
import { pickArm, type ThompsonDecision, type BucketArms } from "./thompson-router.js";

export { V1_ATLAS_SKUS, V1_DEFAULT_SKU };
export type { V1AtlasSku };

// ─── V1 RESOLVE DECISION (LAB / SINGLE-IMAGE) ────────────────────────────────

export interface ResolveDecisionInput {
  roomType: string;
  movement: string | null;
  skuOverride?: V1AtlasSku | null;
}

/**
 * resolveDecision — returns a ProviderDecision for a non-paired Lab scene
 * with an explicit Atlas SKU.
 *
 * - If `skuOverride` is provided and is a member of `V1_ATLAS_SKUS`, it is
 *   used as the modelKey.
 * - Otherwise (null, undefined, or an invalid/excluded SKU such as
 *   kling-v3-pro or kling-v2-1-pair), falls back to `V1_DEFAULT_SKU`.
 *
 * This function is the P1 deliverable for SKU-aware routing. It does NOT
 * handle paired-scene routing — use `selectProviderForScene()` for that.
 */
export function resolveDecision(input: ResolveDecisionInput): ProviderDecision {
  const override = input.skuOverride;
  const skuIsValid =
    override != null &&
    (V1_ATLAS_SKUS as readonly string[]).includes(override);
  const sku: V1AtlasSku = skuIsValid ? override : V1_DEFAULT_SKU;

  return {
    provider: "atlas",
    modelKey: sku,
    fallback: undefined,
  };
}

// ─── PROVIDER DECISION SHAPE ─────────────────────────────────────────────────
//
// Phase C.1: ProviderDecision is the structured routing result used by
// pipeline.ts and the resubmit / retry endpoints. It carries enough
// information to instantiate the provider AND pass the correct model
// override (e.g. "kling-v3-pro" for paired scenes).
//
// provider:  which backend to call
// modelKey:  for "atlas" routes — which Atlas SKU (e.g. "kling-v3-pro").
//            When absent, AtlasProvider uses the ATLAS_VIDEO_MODEL env var.
// fallback:  next decision to try if the primary errors with shouldFailover=true.
//
// Callers that only need an IVideoProvider instance can call
// buildProviderFromDecision(decision) to get one.
//
// BACKWARD COMPAT: selectProvider() still returns IVideoProvider for callers
// (prompt-lab.ts, poll-scenes.ts) that were written before this shape existed.
// New pipeline code uses selectDecision() + selectProviderForScene() which
// return ProviderDecision.

export interface ProviderDecision {
  provider: VideoProvider;            // "atlas" | "kling" | "runway" | "higgsfield"
  modelKey?: string;                   // atlas SKU key; undefined → use env default
  fallback?: ProviderDecision;
}

// ─── PRODUCTION ROUTING TABLE ────────────────────────────────────────────────
//
// Lab-parity routing: production picks the SAME SKU Prompt Lab uses by default
// (Atlas kling-v2-6-pro = V1_DEFAULT_SKU). Native Kling and Runway are kept as
// movement-specific failovers, not primaries. This closes the quality gap
// between Lab iterations and customer renders that surfaced on the 13fe5a96
// rerun (2026-05-18) — native Kling v2 looked visibly worse than the Lab-
// rendered iterations Oliver had been reviewing.
//
// Priority rules:
//
//   1. PAIRED SCENES (end_photo_id set): atlas + kling-v3-pro. Short-
//      circuits in selectProviderForScene() before movement is consulted.
//
//   2. ALL OTHER SCENES: atlas + kling-v2-6-pro (Lab default). Failover
//      branches by movement:
//        - drone / exterior (RUNWAY_MOVEMENTS) → Runway gen4_turbo
//        - interior (INTERIOR_MOVEMENTS) → native Kling (free pre-paid credits)
//        - unknown / null → no failover
//
// Failover only fires on a permanent Atlas error in the current attempt; see
// runGenerationSubmit's `excluded` tracking.

// Interior movements: Atlas primary, native Kling failover.
const INTERIOR_MOVEMENTS: ReadonlySet<CameraMovement> = new Set([
  "push_in",
  "orbit",
  "parallax",
  "dolly_left_to_right",
  "dolly_right_to_left",
  "reveal",
  "low_angle_glide",
  "rack_focus",
]);

// Drone / exterior / closeup movements: Atlas primary, Runway failover.
const RUNWAY_MOVEMENTS: ReadonlySet<CameraMovement> = new Set([
  "drone_push_in",
  "top_down",
  "feature_closeup",
]);

// Lab-parity primary decision — Atlas + V1_DEFAULT_SKU, used as the bottom of
// every fallback chain (last resort when everything else is excluded).
//
// FLAGGED, NOT BUMPED TO 4K (2026-06-30 Seedance-2.0-4K-default work): this
// constant drives BOTH (a) production routing for every non-paired v1-mode
// scene regardless of movement (orbit/parallax/dolly/reveal/drone/interior —
// see resolveMovementDecision below) and (b) the Lab/Thompson V1 testing
// path (resolveDecision(), V1_ATLAS_SKUS, resolveDecisionAsync's bucket
// arms), which is INTENTIONALLY restricted to Kling SKUs (policy decision
// 2026-04-21, see V1_ATLAS_SKUS comment) to keep the rating signal honest.
// Seedance has only ever been validated in this codebase for forced PUSH-IN
// framing (v1.1 mode, see forceSeedancePushInPrompt) — its behavior on
// orbit/parallax/dolly/reveal/drone movements is UNTESTED, and changing this
// constant would (1) widen V1_ATLAS_SKUS's type, (2) feed unvalidated camera
// moves to production for every v1-mode property, and (3) break Lab parity
// in a new direction (production renders a SKU Lab can't test). v1-mode is
// the legacy/customer-checkout default (api/properties/index.ts); operator
// autopilot already defaults to pipeline_mode='v1.1'
// (lib/operator-studio/ingest.ts:149), which IS now 4K via the change above.
// Bumping V1 mode to 4K is a separate, larger validation task — left as-is.
const LAB_PARITY_PRIMARY: ProviderDecision = {
  provider: "atlas",
  modelKey: V1_DEFAULT_SKU,
  fallback: undefined, // terminal
};

// ─── INTERNAL MOVEMENT-BASED DECISION FUNCTION ──────────────────────────────

/**
 * Core movement-based routing logic for production pipeline scenes.
 * Returns a ProviderDecision for an unpaired scene.
 * Does NOT handle the paired-scene rule — use selectProviderForScene() for that.
 * Does NOT set a V1 Atlas SKU — use resolveDecision() for Lab/V1 renders.
 */
function resolveMovementDecision(
  _roomType: RoomType,
  movement: CameraMovement | null,
  preference: VideoProvider | null,
  excluded: VideoProvider[],
): ProviderDecision {
  // Scene-level preference honours admin overrides and Lab provider picks
  // without routing through the table.
  if (preference && !excluded.includes(preference)) {
    return {
      provider: preference,
      fallback: excluded.length === 0 ? LAB_PARITY_PRIMARY : undefined,
    };
  }

  // Compute the movement-specific failover (Runway for drone niche, native
  // Kling for interior efficiency). Skipped if that provider already failed
  // this attempt or there's no natural failover for the movement.
  const drone = !!movement && RUNWAY_MOVEMENTS.has(movement);
  const interior = !!movement && INTERIOR_MOVEMENTS.has(movement);
  let movementFailover: ProviderDecision | undefined;
  if (drone && !excluded.includes("runway")) {
    movementFailover = { provider: "runway", fallback: undefined };
  } else if (interior && !excluded.includes("kling")) {
    movementFailover = { provider: "kling", fallback: undefined };
  }

  // Lab parity: Atlas kling-v2-6-pro primary for everything.
  if (!excluded.includes("atlas")) {
    return {
      provider: "atlas",
      modelKey: V1_DEFAULT_SKU,
      fallback: movementFailover,
    };
  }

  // Atlas already failed this attempt — fall through to movement-specific
  // provider as primary, or last-resort Atlas if no failover is available.
  return movementFailover ?? LAB_PARITY_PRIMARY;
}

// ─── PROVIDER INSTANTIATION ─────────────────────────────────────────────────
//
// Converts a ProviderDecision into an IVideoProvider instance.
// modelKey is NOT injected into the provider constructor — instead it is
// forwarded via GenerateClipParams.modelOverride at call time. AtlasProvider
// already handles modelOverride via its resolveModel() method.

export function buildProviderFromDecision(decision: ProviderDecision): IVideoProvider {
  switch (decision.provider) {
    case "atlas":
      // Cost-attribution fix (2026-06-26): pass the SKU to the constructor so
      // this.model is the actual rendered SKU from the start. Without this,
      // checkStatus() (which may run on a NEW provider instance in the poll loop,
      // pipeline.ts ~1387) would read the env-default price instead of the
      // decision's SKU price. Defense-in-depth alongside the generateClip fix.
      return new AtlasProvider(decision.modelKey);
    case "kling":
      return new KlingProvider();
    case "runway":
      return new RunwayProvider();
    case "veo":
      // Lane B (2026-05-26): Veo 3.1 Preview — Premium 4K SKU.
      // Routes direct to the Gemini API; does NOT go through Atlas.
      return new VeoProvider();
    default:
      // higgsfield / unknown — fall back to Atlas (always available).
      return new AtlasProvider();
  }
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/**
 * selectDecision — returns a ProviderDecision for an unpaired scene.
 * Used by pipeline.ts, resubmit.ts, and retry.ts after Phase C.1.
 * For paired scenes use selectProviderForScene().
 */
export function selectDecision(
  roomType: RoomType,
  movement: CameraMovement | null,
  preference: VideoProvider | null,
  excluded: VideoProvider[] = [],
): ProviderDecision {
  return resolveMovementDecision(roomType, movement, preference, excluded);
}

/**
 * selectProviderForScene — routing entry point for runGenerationSubmit.
 *
 * Routing priority:
 *   0. EXPLICIT OPERATOR SKU OVERRIDE (`skuOverride`) — terminal, no failover.
 *      Fires only when the key is registered in ATLAS_MODELS, listed as
 *      available in the operator picker, and atlas is not excluded.
 *   1. PAIRED SCENES (DQ.3) — always atlas + kling-v3-pro (1080p; no 4K
 *      paired SKU exists yet — see DQ.3 comment below).
 *   2. v1.1 mode — atlas + seedance-2-0-4k (native 4K, default since
 *      2026-06-30) with seedance-pro-pushin / V1 Atlas fallback.
 *   3. Movement-based routing table (v1 default — still 1080p, see
 *      LAB_PARITY_PRIMARY comment for why this was NOT bumped to 4K here).
 *
 * @param scene.endPhotoId  end_photo_id from the scene row
 * @param scene.movement    CameraMovement for the scene
 * @param scene.roomType    RoomType for the scene
 * @param scene.preference  VideoProvider preference from the scene row
 * @param excluded          Providers already tried in this submission attempt
 * @param mode              Pipeline mode ("v1" | "v1.1")
 * @param skuOverride       Operator's explicit Atlas SKU choice (null = Automatic)
 */
export function selectProviderForScene(
  scene: {
    endPhotoId: string | null | undefined;
    movement: CameraMovement | null;
    roomType: RoomType;
    preference: VideoProvider | null;
  },
  excluded: VideoProvider[] = [],
  mode: PipelineMode = "v1",
  skuOverride: string | null = null,
): ProviderDecision {
  // RULE 0 (OPERATOR SKU OVERRIDE): explicit operator choice takes precedence over
  // every routing rule. Terminal — no failover so the operator's intent is respected.
  // Guard: key must be registered in ATLAS_MODELS AND listed as available in the
  // operator picker, AND atlas must not already be excluded mid-failover.
  if (skuOverride && ATLAS_MODELS[skuOverride] && isOperatorSkuAvailable(skuOverride) && !excluded.includes("atlas")) {
    return { provider: "atlas", modelKey: skuOverride, fallback: undefined }; // explicit operator choice — terminal, no failover
  }

  // RULE DQ.3: Paired scenes ALWAYS use atlas + kling-v3-pro (Kling 3.0 Pro,
  // endFrameField "end_image" — upgraded from kling-v2-1-pair 2026-06-10).
  // This rule wins over pipeline_mode — v1.1 never replaces the paired path.
  // If atlas itself is excluded, fall through to the movement table
  // as best-effort (better to try something than nothing).
  //
  // FLAGGED — NO 4K PAIRED PATH EXISTS (2026-06-30): kling-v3-pro is 1080p
  // only. seedance-2-0-4k cannot serve here — its descriptor has
  // endFrameField: null (same as seedance-pro-pushin), so it cannot accept
  // an end-frame/last_image. The opt-in `seedance-pair` SKU DOES take an end
  // frame (last_image) but is only registered at 1080p-SR — there is no
  // `seedance-pair-4k` entry in ATLAS_MODELS today. Paired scenes stay at
  // 1080p until a 4K-capable end-frame SKU is verified against the live
  // Atlas catalog and added.
  if (scene.endPhotoId && !excluded.includes("atlas")) {
    return {
      provider: "atlas",
      modelKey: "kling-v3-pro",
      fallback: undefined, // terminal — no fallback preserves paired semantics
    };
  }

  // v1.1 — Seedance push-in for every non-paired scene, routed through
  // Atlas (Seedance is hosted as an Atlas SKU; no separate provider).
  //
  // DEFAULT BUMPED TO 4K (2026-06-30, Oliver directive — "videos don't look
  // 4K"): seedance-2-0-4k is the SAME underlying model/slug as
  // seedance-pro-pushin (bytedance/seedance-2.0/image-to-video) — only the
  // `resolution` input differs ("4k" vs "1080p-SR", see ATLAS_MODELS). Push-in
  // compatibility is CONFIRMED, not assumed: `shouldForcePushIn()` gates the
  // forced push-in prompt on (pipelineMode, endPhotoId), never on SKU string,
  // and `isSeedancePushInSku()` already recognized 'seedance-2-0-4k' (added
  // 2026-06-26 in anticipation of exactly this swap) so pipeline.ts's
  // SKU-based push-in check (the `isSeedancePushInSku(decision.modelKey)`
  // branch used by resubmit/retry) also fires correctly. No prompt-path
  // changes were needed for this default move.
  //
  // Operator SKU overrides (RULE 0 above) still win — an operator can still
  // pick seedance-pro-pushin (1080p) or any other SKU explicitly.
  //
  // Fallback chain on a permanent Atlas error: 4K → 1080p Seedance push-in →
  // V1 Atlas default (Kling). Skips entirely when atlas is already excluded
  // mid-failover — there's no other home for Seedance.
  if (mode === "v1.1" && !excluded.includes("atlas")) {
    return {
      provider: "atlas",
      modelKey: "seedance-2-0-4k",
      fallback: {
        provider: "atlas",
        modelKey: "seedance-pro-pushin",
        fallback: {
          provider: "atlas",
          modelKey: V1_DEFAULT_SKU,
          fallback: undefined,
        },
      },
    };
  }

  return resolveMovementDecision(scene.roomType, scene.movement, scene.preference, excluded);
}

// ─── SEEDANCE PROMPT NORMALIZATION ───────────────────────────────────────────
//
// Seedance under v1.1 only ever does push-in. The scene's stored prompt may
// contain orbit/parallax/tilt language carried over from the v1 prompt grader
// — strip that and prepend a stable push-in directive at render time. The
// stored scene.prompt is NOT mutated; this is render-time only so the audit
// trail in the DB stays human-authored.

// Determiner guard (negative lookbehind, placed verb-adjacent): a real
// camera-MOVEMENT instruction is clause-leading ("drone flying forward…",
// "slow orbit around…", "gliding past…"). A movement WORD living inside a
// director-chosen SUBJECT noun is preceded by a determiner ("the gliding glass
// doors", "on the descending staircase", "a porch swing", "close-up of the
// pan"). The lookbehind MUST sit immediately before the verb alternation, not
// at the outer boundary — the optional leading adverb group consumes its own
// trailing space ((?:adverb\s+)?) so that, with no adverb, the determiner+space
// abuts the verb and (?<!\bthe\s)(?<!\ba\s)(?<!\ban\s) blocks the match. Put at
// the outer boundary the guard is defeated by the \s* loophole (the match
// anchors on the space before the verb, so "the " never sits adjacent). This
// keeps the subject for the optical strip downstream while still nuking genuine
// clause-leading movement. JS/Node supports fixed-width lookbehind.
const MOVEMENT_VERB_PATTERN =
  /\b(?:(?:slow(?:ly)?|smoothly|gently|gracefully|subtle|wide|tight|fast|quick(?:ly)?)\s+)?(?<!\bthe\s)(?<!\ba\s)(?<!\ban\s)(?:orbit(?:s|ing)?|rotate(?:s|d|ing)?|tilt(?:s|ed|ing)?|pan(?:s|ned|ning)?|parallax(?:es|ed|ing)?|swing(?:s|ing)?|sweep(?:s|ing)?|dolly\s+out|pull(?:s|ing)?\s+back|pull\s+away|fly(?:s|ing)?\s+through|fly\s+over|fly\s+around|circle(?:s|d|ing)?|spin(?:s|ning)?|crane(?:s|d|ing)?(?:\s+up|\s+down)?|truck(?:s|ed|ing)?|whip(?:s|ped|ping)?\s+pan|drone|aerial|glid(?:e|es|ing)|descend(?:s|ing)?|ascend(?:s|ing)?|tracking)\b[^.;]*[.;]?/gi;

// ─── FOCAL-FIXATION STRIP ────────────────────────────────────────────────────
//
// Focal-fixation phrases fight a push-in by locking the model onto a single
// fixture instead of dollying into the room. These appear in feature_closeup
// prompts ("shallow depth of field on the vanity fixture, background softly
// blurred") and survive MOVEMENT_VERB_PATTERN because they have no movement
// verb. We strip the OPTICAL prefix only — subject nouns are preserved.
//
// Subject-preservation rule:
//   "shallow depth of field on the X"  → strip the DoF clause; keep "the X"
//   "close-up of/on the X"             → strip the close-up+prep; keep "the X"
//   "focused on the X"                 → strip "focused on"; keep "the X"
//   "background softly blurred" / "blurred background" → drop entirely (no noun)
//   "bokeh from/of/around the X"  → strip the optical word + connector; keep "the X"
//   "macro (detail/shot/push) of/toward the X" → strip optical word; keep "the X"
//
// Each replacement is applied in order. The final cleanup pass removes stray
// leading/trailing punctuation artefacts.

export function stripMovementVerbs(prompt: string): string {
  return prompt.replace(MOVEMENT_VERB_PATTERN, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * stripFocalFixation — removes optical-framing language that contradicts a
 * push-in (shallow DoF on a fixture, background blurred, close-up, macro,
 * bokeh, "focused on the X"). Subject nouns are preserved; only the
 * camera/optical framing words are removed.
 *
 * Applied at render-time inside forceSeedancePushInPrompt; scene.prompt in
 * the DB is never mutated.
 */
export function stripFocalFixation(prompt: string): string {
  let s = prompt;

  // 1. "cinematic" as a bare style prefix (e.g. "cinematic slow push in with …")
  //    — strip it only when followed by another optical qualifier; "cinematic"
  //    alone is kept. Handled implicitly by the patterns below which already
  //    strip "with shallow depth of field …", leaving "cinematic slow push in".

  // 2. "(with) shallow depth of field (on)"  — strip prefix, keep subject noun.
  //    Before: "with shallow depth of field on the vanity fixture,"
  //    After:  "the vanity fixture,"
  s = s.replace(/\bwith\s+shallow\s+depth\s+of\s+field\s+on\s+/gi, "");
  s = s.replace(/\bshallow\s+depth\s+of\s+field\s+on\s+/gi, "");
  // Standalone "(with) shallow depth of field" with no following object.
  s = s.replace(/[,;]?\s*\bwith\s+shallow\s+depth\s+of\s+field\b[,;.]?\s*/gi, " ");
  s = s.replace(/[,;]?\s*\bshallow\s+depth\s+of\s+field\b[,;.]?\s*/gi, " ");

  // 3. "(with) depth of field" standalone.
  s = s.replace(/[,;]?\s*\bwith\s+depth\s+of\s+field\b[,;.]?\s*/gi, " ");
  s = s.replace(/[,;]?\s*\bdepth\s+of\s+field\b[,;.]?\s*/gi, " ");

  // 4. "(extreme) close-up of/on the X" — strip prefix+prep, keep "the X".
  s = s.replace(/\b(?:extreme\s+)?close-?up\s+(?:of|on)\s+/gi, "");
  // "(extreme) close-up" standalone (no object noun follows directly).
  s = s.replace(/[,;.]?\s*\b(?:extreme\s+)?close-?up\b[,;.]?\s*/gi, " ");

  // 5. "focused on the X" → keep "the X" (drop "focused on ").
  s = s.replace(/\bfocus(?:ed)?\s+on\s+(?=the\s)/gi, "");
  // "focused on [anything without 'the']" — drop the whole phrase.
  s = s.replace(/\bfocus(?:ed)?\s+on\s+\S+(?:\s+\S+){0,4}[,;.]?\s*/gi, " ");

  // 6. Background-blurred phrases — drop entirely (no subject noun).
  s = s.replace(/[,;.]?\s*\bbackground\s+(?:is\s+)?(?:softly\s+)?blurred\b[,;.]?\s*/gi, " ");
  s = s.replace(/[,;.]?\s*(?:softly\s+)?blurred\s+background\b[,;.]?\s*/gi, " ");

  // 7. Bokeh / macro — SURGICAL optical-word removal, subject noun preserved.
  //    These are OPTICAL framing (a modifier on a director-chosen subject), NOT
  //    camera movement, so we must NOT consume the clause to the next period —
  //    that deletes the subject. Strip the optical word + its leading connector
  //    ("bokeh from the X" → "the X"; "macro detail of the X" → "the X") and
  //    fall back to a bare-word strip when no connector follows.
  //    Before (whole-clause bug): "Macro push toward the faucet, water beading
  //    on the basin" → "" (faucet + basin GONE).
  //    After (surgical):          "push toward the faucet, water beading on the
  //    basin" (subject preserved).
  s = s.replace(/\bmacro\s+(?:detail|shot|push|view|close-?up)\s+(?:of|toward|on)?\s*/gi, "");
  s = s.replace(/\bmacro\b\s*/gi, "");
  s = s.replace(/\bbokeh\s+(?:from|of|around|surrounds?|surrounding)\s+/gi, "");
  s = s.replace(/\bbokeh\b\s*/gi, "");

  // ── Cleanup ──────────────────────────────────────────────────────────────
  // Remove stray leading "with" / "and" / commas left by the strips above.
  s = s.replace(/^\s*(?:with|and)\s+/i, "");
  // Orphan leading style-adjective left dangling on an article after its
  // optical qualifier was stripped. e.g. "Cinematic close-up of the wine
  // fridge" → close-up+of removed → "Cinematic the wine fridge" → drop the
  // orphan "Cinematic" → "the wine fridge". Restricted to known cinematography
  // style words so we never eat a real subject noun.
  s = s.replace(/^\s*(?:cinematic|dramatic|moody|soft|sharp|crisp|tight|wide)\s+(?=(?:the|a|an)\s)/i, "");
  // Remove dangling "toward the ." / "toward it." artifacts.
  s = s.replace(/\btoward\s+(?:the\s+)?[.,;]\s*/gi, "");
  // Collapse a lost comma that now abuts another article/clause: ", the X"
  // following an article-led head reads as a fused list — keep it, but drop a
  // comma immediately before end-of-string and collapse comma-space-comma runs.
  s = s.replace(/\s*,\s*(?=,)/g, "");
  // Collapse double spaces; trim.
  s = s.replace(/\s{2,}/g, " ").trim();
  // Strip a leading comma/semicolon.
  s = s.replace(/^[,;]\s*/, "");
  // Strip a dangling trailing comma/semicolon left by an end-of-string strip
  // (e.g. "Cinematic the wine fridge," → "Cinematic the wine fridge").
  s = s.replace(/\s*[,;]+\s*$/, "");

  return s;
}

const SEEDANCE_PUSHIN_PREAMBLE =
  "Slow, steady push in toward the room. Camera moves smoothly forward on a fixed dolly. No tilt, no rotation, no parallax, no orbit.";

export function forceSeedancePushInPrompt(originalPrompt: string): string {
  const stripped = stripFocalFixation(stripMovementVerbs(originalPrompt));
  if (!stripped) return SEEDANCE_PUSHIN_PREAMBLE;
  return `${SEEDANCE_PUSHIN_PREAMBLE} ${stripped}`;
}

/**
 * shouldForcePushIn — returns true when the scene must receive the push-in
 * prompt override at render time. Gate is on the SCENE, not the chosen
 * provider/SKU, so retries that failover to native Kling (or any other model)
 * are still forced to push-in as long as the pipeline and scene qualify.
 *
 * Paired scenes (end_photo_id set) are intentional transitions on kling-v3-pro
 * and are always exempt.
 */
export function shouldForcePushIn(
  pipelineMode: string,
  endPhotoId: string | null | undefined,
): boolean {
  return pipelineMode === "v1.1" && !endPhotoId;
}

/**
 * isSeedancePushInSku — true when `modelKey` is a Seedance push-in SKU.
 *
 * Use this instead of comparing directly to the string 'seedance-pro-pushin'
 * so that 'seedance-2-0-4k' (and any future Seedance push-in variants) are
 * covered automatically. Both SKUs share the same push-in prompt preamble and
 * neither sends an end-frame (endFrameField: null).
 *
 * NOTE: pipeline.ts gates push-in via `shouldForcePushIn(pipelineMode, endPhotoId)`
 * (mode-based, not SKU-based). When routing through the skuOverride path at a
 * mode other than v1.1, callers that want the push-in prompt for seedance-2-0-4k
 * must check `isSeedancePushInSku(decision.modelKey)` at their call site.
 */
export function isSeedancePushInSku(modelKey: string | null | undefined): boolean {
  return modelKey === "seedance-pro-pushin" || modelKey === "seedance-2-0-4k";
}

/**
 * selectProvider — BACKWARD-COMPATIBLE wrapper that returns an IVideoProvider
 * instance directly. Kept for callers that were written before Phase C.1
 * introduced ProviderDecision (prompt-lab.ts, poll-scenes.ts).
 *
 * New code should use selectDecision() or selectProviderForScene() + buildProviderFromDecision()
 * to access the modelKey and fallback chain.
 */
export function selectProvider(
  roomType: RoomType,
  movement: CameraMovement | null,
  preference: VideoProvider | null,
  excluded: VideoProvider[] = [],
): IVideoProvider {
  const decision = resolveMovementDecision(roomType, movement, preference, excluded);
  return buildProviderFromDecision(decision);
}

// ─── ASYNC THOMPSON ROUTING ──────────────────────────────────────────────────
//
// resolveDecisionAsync — wraps resolveDecision with an optional Thompson-
// sampling layer. Controlled by USE_THOMPSON_ROUTER=true env flag.
//
// The synchronous resolveDecision is always called first so that staticSku is
// unconditionally available for shadow-log writes (A/B comparison).

/**
 * Load bucket arms from router_bucket_stats for a given (roomType, movement)
 * bucket. Returns null on any error or if the bucket has no V1 SKU arms.
 */
async function loadBucketArms(
  roomType: string,
  movement: string | null,
): Promise<BucketArms | null> {
  if (!movement) return null;
  try {
    const { getSupabase } = await import("../client.js");
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("router_bucket_stats")
      .select("sku, alpha, beta, enabled, trial_count")
      .eq("room_type", roomType)
      .eq("camera_movement", movement);
    if (error || !data || data.length === 0) return null;

    // Filter to V1 SKUs only — any other SKU in DB (e.g. kling-v2-1-pair) is ignored.
    const validSkus = V1_ATLAS_SKUS as readonly string[];
    const arms = (
      data as Array<{
        sku: string;
        alpha: string | number;
        beta: string | number;
        enabled: boolean;
        trial_count: number;
      }>
    )
      .filter((row) => validSkus.includes(row.sku))
      .map((row) => ({
        sku: row.sku as V1AtlasSku,
        alpha: Number(row.alpha),
        beta: Number(row.beta),
        enabled: row.enabled,
        trial_count: row.trial_count,
      }));

    if (arms.length === 0) return null;

    return {
      room_type: roomType,
      camera_movement: movement,
      arms,
    };
  } catch {
    return null;
  }
}

/**
 * resolveDecisionAsync — async variant of resolveDecision that optionally
 * applies Thompson sampling when USE_THOMPSON_ROUTER=true.
 *
 * Always returns `staticSku` (from the synchronous path) so callers can
 * write shadow-log rows for A/B comparison regardless of the flag state.
 *
 * Does NOT replace resolveDecision — old callers continue to work unchanged.
 */
export async function resolveDecisionAsync(input: ResolveDecisionInput): Promise<{
  decision: ProviderDecision;
  thompson?: ThompsonDecision;
  staticSku: V1AtlasSku;
}> {
  const staticDecision = resolveDecision(input);
  const staticSku = staticDecision.modelKey as V1AtlasSku;

  if (process.env.USE_THOMPSON_ROUTER !== "true") {
    return { decision: staticDecision, staticSku };
  }

  const bucketArms = await loadBucketArms(input.roomType, input.movement);
  if (!bucketArms) {
    return { decision: staticDecision, staticSku };
  }

  const thompson = pickArm(bucketArms, V1_DEFAULT_SKU);
  return {
    decision: { provider: "atlas", modelKey: thompson.sku, fallback: undefined },
    thompson,
    staticSku,
  };
}

// ─── ENABLED PROVIDERS ───────────────────────────────────────────────────────
//
// Returns providers with credentials configured in the environment.
// The pipeline uses this to size the maxFailovers budget.

export function getEnabledProviders(): VideoProvider[] {
  const enabled: VideoProvider[] = [];
  if (process.env.ATLASCLOUD_API_KEY) enabled.push("atlas");
  if (process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY) enabled.push("kling");
  if (process.env.RUNWAY_API_KEY) enabled.push("runway");
  // Lane B (2026-05-26): Veo uses the same GEMINI_API_KEY as the photo
  // analyzer. No extra credential — just gate on key presence.
  if (process.env.GEMINI_API_KEY) enabled.push("veo");
  return enabled;
}
