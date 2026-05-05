# docs/archive — What's in here and why

Last updated: 2026-05-05

See also:
- [../README.md](../README.md) — top-level docs entry point
- [../HANDOFF.md](../HANDOFF.md) — current state

## Rules for this folder

- **Never delete.** If a doc becomes stale, move it here with a note explaining why and link to the canonical replacement (if any).
- **Organize by reason, not by date.** Subfolders: `superseded-docs/`, `completed-plans/`, `paused-plans/`, `forks/`.
- **Update this README** whenever you archive something new.

## Why things get archived

- **Superseded** — a newer doc replaces this one. Keep for history.
- **Completed plan** — the work shipped. Keep as an execution record.
- **Paused plan** — the design is still viable but work was deferred. Resumable.
- **Fork snapshot** — a stale copy from a side-branch working tree. Keep only the files that *differed* from main at the time of archival.

---

## Inventory

### `superseded-docs/` — replaced by newer, better-scoped docs

| Original path | Archived | Why | Replacement |
|---|---|---|---|
| `docs/API-REFERENCE.md` | 2026-04-21 | References old "ReelReady" product name, `reelready-eight.vercel.app` base URL, and Higgsfield/Luma/Runway-era API surface. API docs are out of sync with current code. | Read code under `api/` directly. Generate a fresh API reference once the product is mastered. |
| `docs/ARCHITECTURE.md` | 2026-04-21 | Written for the ReelReady name + Runway/Kling/Luma stack. Current stack is Atlas Cloud + native Kling + Shotstack. | [`../state/PROJECT-STATE.md`](../state/PROJECT-STATE.md) (Pipeline stages section) + [`../state/STACK.md`](../state/STACK.md) |
| `docs/KNOWLEDGE-BASE.md` | 2026-04-21 | Pre-Phase-2.8 context doc. Describes the product when it was ReelReady targeting brokerages at scale. | [`../README.md`](../README.md) + [`../HANDOFF.md`](../HANDOFF.md) + [`../state/PROJECT-STATE.md`](../state/PROJECT-STATE.md) |
| `docs/PIPELINE-PROMPTS.md` | 2026-04-21 | Documents the pre-DQ director + photo-analysis + QC prompts. DQ rewrote the director prompt and deleted QC. | Read `lib/prompts/*.ts` directly. |
| `docs/REDESIGN-AUDIT.md` | 2026-04-21 | 2026-04-13 pre-redesign audit of the landing. Superseded by the redesign shipping + the new-shell-landing spec. | [`../specs/2026-04-20-new-shell-landing-design.md`](../specs/2026-04-20-new-shell-landing-design.md) |
| `docs/REDESIGN-BRIEF.md` | 2026-04-21 | Brand + palette decisions doc from the redesign sprint. Decisions are now implemented in `tailwind.config.ts`. | Code + [`../specs/2026-04-20-new-shell-landing-design.md`](../specs/2026-04-20-new-shell-landing-design.md) |
| `docs/REDESIGN-STATUS.md` | 2026-04-21 | End-of-day 2026-04-14 status doc for the redesign sprint. Point-in-time snapshot, no longer current. | [`../HANDOFF.md`](../HANDOFF.md) |
| `docs/INTERIOR-LOSERS-2026-04-14.md` | 2026-04-21 | Empty rating-report output (0 winners / 0 losers). Historical script artifact only. | Re-run `scripts/losers-interior.ts` (if needed) for fresh data. |
| `docs/HIGGSFIELD-INTEGRATION.md` | 2026-04-21 | Higgsfield provider was explored then DEFERRED (2026-04-13). Atlas + native Kling replaced the need. | None. Resurrect only if Higgsfield becomes relevant again. |
| `docs/SHOTSTACK-INTEGRATION-PLAN.md` | 2026-04-21 | MVP shipped; plan became history. Post-MVP polish is on the deferred list in back-on-track plan. | [`../plans/back-on-track-plan.md`](../plans/back-on-track-plan.md) (deferred section) |
| `docs/PROMPT-LAB-PLAN.md` | 2026-04-21 | Plan for the legacy single-photo Prompt Lab. UI was retired Phase DM. Data preserved, UI gone. | [`../specs/2026-04-19-new-prompt-lab-design.md`](../specs/2026-04-19-new-prompt-lab-design.md) + [`../state/PROJECT-STATE.md`](../state/PROJECT-STATE.md) Phase 2.8 section |
| `docs/MULTI-IMAGE-CONTEXT-PLAN.md` | 2026-04-21 | Plan for cross-scene hallucination fix via text-prompt context injection. Approach evolved into end-frame pairing (Phase 2.7) + spatial grounding (paused). | [`paused-plans/2026-04-15-spatial-grounding-design.md`](./paused-plans/2026-04-15-spatial-grounding-design.md) |
| `docs/SCENE-ALLOCATION-PLAN.md` | 2026-04-21 | Proposal for dynamic clip budgeting. Current system uses static quotas that are working well enough; proposal not implemented. | Resurrect if per-room allocation becomes a quality bottleneck. |
| `ARCHITECTURE.md` (repo root) | 2026-04-21 | Root-level ReelReady architecture doc. Same problem as `docs/ARCHITECTURE.md`. | [`../state/PROJECT-STATE.md`](../state/PROJECT-STATE.md) |
| `LOVABLE_PROMPT.md` (repo root) | 2026-04-21 | Original Lovable bootstrap prompt. Product name + stack are outdated. Historical only. | None. |
| `docs/briefs/*` (8 files) → `superseded-docs/2026-04-21-windows/` | 2026-05-05 | One-shot session brief docs from the 2026-04-21 parallel-window work. All work landed on main. | [`../sessions/`](../sessions/) for session-level recaps. |
| `docs/traces/*` (3 files) → `superseded-docs/director-traces/` | 2026-05-05 | Ad-hoc director-trace dumps from Apr 21–22. Reproducible via `scripts/trace-director-prompt.ts`. | Re-run trace script. |
| `docs/audits/REGRESSION-DIFF-2026-04-21.md` → `superseded-docs/window-a-audits/` | 2026-05-05 | Window-A point-in-time regression audit. Verdict captured in [`project_legacy_lab_regression_hypothesis.md`](memory). | None. |
| `docs/audits/router-coverage-2026-04-21.md` → `superseded-docs/window-a-audits/` | 2026-05-05 | Window-A router coverage snapshot. Bucket-table state has since changed. | Re-run via `scripts/router-stats.ts` if needed. |
| `docs/audits/test-render-log-2026-04-21.md` → `superseded-docs/window-a-audits/` | 2026-05-05 | Test-render run log from Apr 21. Historical only. | None. |

### `completed-plans/` — plans whose work shipped

| Original path | Archived | Why | Reference |
|---|---|---|---|
| `docs/superpowers/plans/2026-04-15-unified-embeddings.md` | 2026-04-21 | Status COMPLETE — unified `match_rated_examples` RPC shipped, scenes embed on insert, historical rated scenes backfilled. | [`../state/PROJECT-STATE.md`](../state/PROJECT-STATE.md) |
| `docs/superpowers/plans/2026-04-19-phase2.7-atlas-end-frame.md` | 2026-04-21 | Shipped — Atlas Cloud is the Lab's default provider with end-frame support. | [`../state/PROJECT-STATE.md`](../state/PROJECT-STATE.md) Phase 2.8 section |
| `docs/superpowers/plans/2026-04-19-phase2.8-new-prompt-lab.md` | 2026-04-21 | Shipped — multi-photo listings Lab is the canonical Lab surface. | [`../state/PROJECT-STATE.md`](../state/PROJECT-STATE.md) |
| `docs/superpowers/plans/2026-04-20-phase-a-spine-and-m1-trace.md` | 2026-04-21 | Shipped — Phase A (Lab UX spine) + Phase M.1 (trace audit) both landed 2026-04-20. | [`../audits/ML-AUDIT-2026-04-20.md`](../audits/ML-AUDIT-2026-04-20.md) + [`../state/PROJECT-STATE.md`](../state/PROJECT-STATE.md) |

### `paused-plans/` — designs deferred, resumable

| Original path | Archived | Why | Resume signal |
|---|---|---|---|
| `docs/superpowers/specs/2026-04-15-spatial-grounding-design.md` | 2026-04-21 | PAUSED 2026-04-15. The spatial-grounding half (camera pose, depth zones, motion viability) is shelved pending head-to-head model outcomes. | When hallucinated-geometry losers in Phase B show a pattern the current prompt rules can't fix. |
| `docs/superpowers/plans/2026-04-15-spatial-grounding.md` | 2026-04-21 | Implementation plan for the above. Note: the unified-embeddings half was extracted and shipped separately. | Tied to the design above. Re-produce a spatial-only plan when resuming. |
| `docs/superpowers/plans/2026-04-19-phase1-rubric-judge.md` | 2026-04-21 | Claude rubric judge for auto-rating Lab iterations. Paused — back-on-track phases supersede. | When Phase B completes and autonomous iteration becomes the priority. |
| `docs/superpowers/plans/2026-04-19-phase2-knowledge-map.md` | 2026-04-21 | Visual 14×12 (room × movement) knowledge map dashboard. Paused — not needed until autonomous iterator lands. | Same as rubric judge. |
| `docs/superpowers/plans/2026-04-19-phase2.6-reverse-assembly.md` | 2026-04-21 | `reverse_in_assembly` flag + Cloudinary reverse URL wrap. Paused — Shotstack polish is post-mastery. | After Phase C + router-table + first real deliveries. |
| `docs/superpowers/plans/2026-04-20-new-shell-landing.md` | 2026-04-21 | `/v2` marketing landing implementation plan. Paused until back-on-track mastery ships. | After Phase B. |

### `forks/` — snapshots from stale side-branch working trees

Not real forks — three working copies of the same GitHub repo on disk, each on a different branch. `docs/` in the two non-`main` clones drifted from `main`. Only files that *differed* from the main-branch canonical are preserved here.

| Source clone | Branch | Files snapshotted | Why |
|---|---|---|---|
| `/Users/oliverhelgemo/real-estate-pipeline-finances` | `finances-tab` | `PROJECT-STATE.md`, `TODO.md`, `REDESIGN-STATUS.md`, `HIGGSFIELD-INTEGRATION.md` | Branch has finances-tab work that never landed on `main`; docs there describe the state of `finances-tab` at its latest commit (`66135be`). Kept as historical record in case `finances-tab` gets resurrected. |
| `/Users/oliverhelgemo/real-estate-pipeline-ui` | `ui-redesign` | `TODO.md`, `REDESIGN-STATUS.md` | Branch is older than `main` by ~10 days. Other fork docs matched main exactly; only these two differed. |

**Do NOT push to either of these clones.** They are read-only snapshots from `main`'s perspective.

---

## If you're archiving a new doc

1. `git mv old/path docs/archive/<subfolder>/filename.md` (preserves history)
2. Add a row to the relevant table above with: original path, date archived, why, replacement pointer.
3. If the archived doc had inbound links from living docs, update those links OR add a note in the destination doc explaining the pointer has moved.
4. Commit the move in the same commit as the table update so the archive README never goes out of sync with the filesystem.
