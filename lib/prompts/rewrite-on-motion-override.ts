// When the DA.3 validator overrides scene.camera_movement post-director,
// the original scene.prompt still names the OLD motion verb. Sending that
// prompt to a SKU selected for the NEW motion produces output where the
// SKU and prompt disagree. This module rewrites the prompt text to match
// the new motion using a deterministic template-fill — no extra LLM call,
// constant latency.
//
// Pattern: extract the subject phrase from the original prompt
// (everything after "toward / around / across / past / on / of / through
// / centered on / into the ..."), then rebuild around the new motion
// verb's canonical phrasing. Falls back to a caller-provided subject
// (typically director_intent.subject) when extraction fails, then to a
// generic safe template.

import type { CameraMovement } from "../types.js";

const MOTION_TEMPLATES: Record<
  CameraMovement,
  { format: (subject: string) => string }
> = {
  push_in: {
    format: (s) => `slow cinematic push in toward ${s}`,
  },
  orbit: {
    format: (s) => `smooth cinematic orbit around ${s}`,
  },
  parallax: {
    format: (s) => `smooth cinematic parallax across ${s}`,
  },
  dolly_left_to_right: {
    format: (s) => `smooth cinematic dolly right across ${s}`,
  },
  dolly_right_to_left: {
    format: (s) => `smooth cinematic dolly left across ${s}`,
  },
  reveal: {
    format: (s) => `smooth cinematic reveal past ${s}`,
  },
  drone_push_in: {
    format: (s) =>
      `smooth cinematic drone flying forward at rooftop height toward ${s}`,
  },
  top_down: {
    format: (s) => `smooth cinematic top down of ${s}`,
  },
  low_angle_glide: {
    format: (s) => `steady cinematic low angle glide toward ${s}`,
  },
  feature_closeup: {
    format: (s) =>
      `cinematic slow push in with shallow depth of field on ${s}, background softly blurred`,
  },
  rack_focus: {
    format: (s) => `cinematic rack focus on ${s}, static camera`,
  },
};

const SUBJECT_EXTRACTION_PATTERNS: RegExp[] = [
  / toward (the .+)$/i,
  / around (the .+)$/i,
  / across (the .+)$/i,
  / through (the .+)$/i,
  / past (the .+)$/i,
  / on (the .+?)(?:, background.*)?$/i,
  / of (the .+)$/i,
  / centered on (the .+)$/i,
  / into (the .+)$/i,
];

function extractSubject(prompt: string): string | null {
  for (const pattern of SUBJECT_EXTRACTION_PATTERNS) {
    const m = prompt.match(pattern);
    if (m && m[1]) {
      // Drop trailing "and X beyond" / ", revealing X" clauses — the
      // sanitizer also strips these, so the rewritten prompt should
      // match the cleaned form rather than re-inject banned phrasing.
      return m[1].replace(/ (?:and|, revealing) .+$/i, "").trim();
    }
  }
  return null;
}

export function rewritePromptForNewMotion(
  originalPrompt: string,
  newMotion: CameraMovement | string,
  subjectFallback?: string,
): string {
  const template = MOTION_TEMPLATES[newMotion as CameraMovement];
  if (!template) {
    // Unknown motion — no-op for safety.
    return originalPrompt;
  }
  const extracted = extractSubject(originalPrompt);
  const subject = extracted ?? subjectFallback ?? "the focal subject";
  return template.format(subject);
}
