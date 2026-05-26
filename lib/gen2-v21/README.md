# lib/gen2-v21 — V2.1 pair-picker subsystem

Spec: `docs/specs/2026-05-23-v21-pair-picker-design.md`.

Behind `GEN2_V21_ENABLED=true`. Additive to V1 pipeline. See `lib/gen2-v21/fall-through/` for the 97% room-confidence gate.

| Subdir | Owner module | Purpose |
| --- | --- | --- |
| scene-graph/ | extractor.ts | Gemini 2.5 Pro property analysis |
| candidates/ | rule-generator.ts | Deterministic pair enumeration |
| picker/ | lightgbm.ts | ML scoring; heuristic fallback before 10 labels |
| apprentice/ | labeler.ts | Gemini 2.5 Pro few-shot predicting operator |
| outcome-feedback/ | worker.ts | Async judge of rendered clips → retrains picker |
| guardrail/ | line-delta.ts | Per-clip geometric check + multi-take reroll |
| fall-through/ | router.ts | 97% gate → V1 single-image path |
| telemetry/ | audit-log.ts | Rolling accuracy + feature importance + held-out eval |

Every module imports from `lib/gen2-v21/types.ts`. Do not cross-import between subdirs without explicit reason.
