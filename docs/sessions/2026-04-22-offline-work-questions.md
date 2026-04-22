# 2026-04-22 — Offline-work questions for Oliver

Oliver stepped offline ~3h to let the coordinator (Window A, Opus 1M) advance the V1/ML roadmap autonomously on branches. This doc aggregates every question raised during that time into one review-friendly list, plus a summary of what landed.

---

## TL;DR — what you can merge to main (order of suggested review)

| Branch | Status | Commits |
|---|---|---|
| `session/p5-s1-implementation-draft` | Math kernel + migration 038 + tests (all 20 passing) + refresh scaffold. Pure TypeScript, fully testable in isolation. **Highest confidence; most complete.** | `4ceb580` |
| `session/p2-s1-implementation-draft` | Migration 033 + rubric module + validator (10/10 tests passing) + Gemini provider SKELETON. Gemini API call deliberately stubbed behind TODO(p2-s1). | `171c260` |
| `session/p3-s1-implementation-draft` | Migration 034 + Gemini image-embedding wrapper SKELETON + backfill script + 7/7 tests. Binding stubbed behind TODO(p3-s1). | `255d265` |

All three branches are unmerged, unpushed. You can cherry-pick any subset. None wire into `submitLabRender` or the prod pipeline — all are additive + behind env kill-switches.

Full status docs:
- `docs/state/P5-IMPLEMENTATION-STATUS.md`
- `docs/state/P2-IMPLEMENTATION-STATUS.md`
- `docs/state/P3-IMPLEMENTATION-STATUS.md`

---

## Questions — **please answer top to bottom**

### Q-A1. Apply migrations 031 + 032 to prod Supabase? (blocks P1 Task 12 smoke)

Migrations are committed on main but NOT applied to any database:
- `031_prompt_lab_iterations_sku.sql` — adds `model_used` + `sku_source` to `prompt_lab_iterations`
- `032_cost_events_atlas_google_higgsfield.sql` — widens `cost_events.provider` CHECK to include `atlas` / `google` / `higgsfield`

Both are additive-only. Rollback is a code revert, not a migration revert.

**Options:**
1. Apply to remote prod (`vrhmaeywqsohlztoouxu`) via `npx supabase db push`. One command. Affects production.
2. Apply via Supabase Studio SQL editor — paste each file, review, run. ~2 min.
3. Skip; keep P1 backend running but Atlas cost_events silently failing the CHECK until applied.

**My recommendation: option 2.** Fastest + lowest risk. I can paste the SQL on your return.

### Q-A2. Push any of today's branches to `origin` for backup?

All work is LOCAL on this machine. If the machine blows up, today's ~9 hours of work is gone. Pushing does NOT merge — branches stay unmerged on origin, just backed up.

Branches to consider pushing:
- `main` (P1 shipped, 14 commits ahead)
- `session/p2-s1-implementation-draft` (P2 skeleton)
- `session/p3-s1-implementation-draft` (P3 skeleton)
- `session/p5-s1-implementation-draft` (P5 math module)
- `session/offline-2026-04-22-continuation` (this handoff doc)

Design branches (`session/p2-rubric-design`, `session/p3-embedding-preflight`, `session/p5-thompson-design`) — already exist locally; check if pushed.

**My recommendation: push `main` + the 3 P2/P3/P5 implementation-draft branches.** Preserves work without touching production-deploy state (that's a separate Vercel deploy decision).

### Q-A3. Verify the v2-master verdict blocks anything in P2?

Task 13 subagent returned verdict **Validate-day-1** (medium confidence). The v2-master ↔ v2-6-pro motion behavior may diverge enough to need a per-SKU wrinkle in the P2 rubric. Your P2 rubric (Window B) already bakes in SKU-agnostic design.

**Question:** for P2 S1 (2026-04-23), do you want a $1.11 A/B render pair to validate v2-master equivalence? Or accept the rubric as-is and audit via the auto-judge agreement rate instead once P2 is live?

**My recommendation: skip the A/B. The auto-judge agreement rate will tell us by 2026-04-25 whether v2-master calibration is off. Save the $1.11.**

### Q-A4. Push `origin/main` to trigger a Vercel preview deploy?

Your Vercel project auto-deploys from `main`. Pushing `main` with today's 14 commits WILL fire a preview deploy (probably production per your Vercel setup — not verified). I have NOT pushed to remote per your standing "no push without permission" rule.

**Important:** the migrations are NOT yet applied. If a user hits the Lab while migrations are pending, the SKU-capture writes will fail (no `model_used` column) and cost_events writes will fail (CHECK). The UI will still load — the render button will just throw 500s until migrations land.

**My recommendation:** apply migrations FIRST (Q-A1), then push `main` (Q-A2/Q-A4). Order matters.

---

### Q-B1. P2 kill-switch default: keep `JUDGE_ENABLED=false` for the 2026-04-23 session?

P2 skeleton has the gemini-judge call gated by `JUDGE_ENABLED !== 'true'`. On 2026-04-23 you'd flip it to `true` on one test render, verify, then leave on. My default-false posture protects against accidental Gemini spend during integration. **Confirm this kill-switch approach is what you want for P2 S1.**

### Q-B2. P2 calibration pool seeding — do you want it landed today?

Window B's rubric includes a 10-example calibration pool (5 × 5★, 5 × 1★). These would be inserted into `judge_calibration_examples` as seed rows. I did NOT seed them because migration 033 isn't applied. P2 S1 can seed after applying. Alternative: I can prepare the INSERT statements as a separate commit on the P2 branch so P2 S1 has a one-line seed action. **Want the seed INSERTs pre-cooked?**

### Q-C1. P3 image-embedding backfill cost projection — verify OK?

Projected total: ~$0.03 (150 photos + 100 sessions × $0.00012/embedding). Verify at P3 S1 first call. If billing spikes 10× ($0.30 range), still fine. If spikes 100× ($3 range), pause.

**My recommendation: set a $2 ceiling for the backfill run at P3 S1 — anything above pauses and alerts.**

### Q-C2. P3 Gemini embedding API — is the SDK shape stable?

The scaffold assumes `@google/genai` SDK exposes `models.embedContent({ model: 'gemini-embedding-2', content: ..., config: { outputDimensionality: 768 } })`. The actual shape may differ — P3 S1 preflight verifies. If it's wildly different, P3 S1 becomes an SDK-exploration session before any binding. **I'm flagging in case you want me to do a quick `@google/genai` docs check before P3 S1.**

### Q-D1. P5 Beta CI uses Normal approximation — is that OK for the dashboard?

`thompson-router.ts::confidenceInterval` uses a Normal approximation of the Jeffreys interval. For n < 10 it's coarser than the true quantile. Fine for the dashboard's "roughly where's the posterior" display; inappropriate if we ever surface a strict "statistical significance" claim. **Is the approximation acceptable? Or should P5 S1 swap in an exact beta-quantile solver?**

**My recommendation: accept for V1. Swap if dashboard precision becomes user-visible (unlikely).**

### Q-D2. P5 Thompson sampling is stochastic — deterministic tests OK?

The P5 test suite uses `Math.random()` with statistical assertions ("mean > 0.8 over 1000 trials"). This means 1-in-a-billion-ish flaky test risk. `setRng(fn)` hook exists to inject deterministic RNG for production bandit audits. **Want me to retrofit the unit tests to use seeded RNG before merging P5?** (Cleaner but more code.)

---

### Q-E1. What's NEXT after you review these branches?

Given the pre-cook work, the 2026-04-23 → 04-30 sessions get significantly shorter:
- P2 S1 (2026-04-23): wire Gemini binding into existing skeleton + verify billing + seed pool. **Maybe 2h instead of 4h.**
- P3 S1 (2026-04-25): wire Gemini binding + run backfill + verify embeddings populated. **Maybe 1.5h instead of 4h.**
- P5 S1 (2026-04-30): wire `pickArm` into `resolveDecision` + run shadow-log for 24h. **Maybe 2h instead of 4h.**

If the branches look good, total remaining V1-ML-roadmap time compresses by ~30-40%.

### Q-E2. Window B reply status

You asked me to reply to Window B's 7 Qs (Q1–Q7 judge rubric). I gave the reply in-chat for you to paste. As of offline-start, I hadn't seen a "Window B is done" confirmation — they may still be integrating your answers. Verify when back: `git log --oneline session/p2-rubric-design` — if there's a second commit past their original, it's done.

### Q-E3. Task 11 (V1 trace) + Task 12 (live smoke) unfinished

- Task 11 (live V1 trace demonstrating retrieval blocks populated) — agent dispatch failed 4× to a worktree-isolation bug (loaded `fewer-permission-prompts` skill instead of my brief). Can redo in ~20 min when you're back, on a branch.
- Task 12 (live smoke render) — blocked on migrations. Covered by Q-A1.

These are the only P1 SCs not hit yet. Everything else is green.

---

## Summary of branches for review

### Branches with implementable work (review + merge decision)

```
main
├── 4a7f203 docs(plan): V1 spec + P1 plan
├── ... (11 more P1 commits)
├── 5eb7fd4 feat(p1): UI SKU selector
│   │
│   ├── session/p5-s1-implementation-draft → 4ceb580 (Thompson module, 20/20 tests)
│   ├── session/p2-s1-implementation-draft → 171c260 (judge skeleton, 10/10 tests)
│   ├── session/p3-s1-implementation-draft → 255d265 (image-embed skeleton, 7/7 tests)
│   └── session/offline-2026-04-22-continuation (this doc)
```

### Pre-cooked design branches (integration at phase-scheduled sessions)

```
session/p2-rubric-design     — final rubric v1.0 (Oliver Qs resolved)
session/p3-embedding-preflight — Gemini-768 decision (Oliver Qs resolved)
session/p5-thompson-design     — Thompson math spec (Oliver Qs resolved)
```

### Parked legacy branches (do not merge)

```
session/ledger-2026-04-21    — V2 bucket scoreboard (parked)
session/router-2026-04-21    — static router grid (superseded by P5)
session/da1-land-2026-04-21  — already merged (historical)
```

---

## Test / typecheck health at offline-session end

- **main:** 80/80 vitest passing, `tsc --noEmit` clean.
- **session/p5-s1-implementation-draft:** 100/100 vitest passing (80 inherited + 20 new), tsc clean.
- **session/p2-s1-implementation-draft:** 90/90 vitest passing (80 inherited + 10 new), tsc clean.
- **session/p3-s1-implementation-draft:** 87/87 vitest passing (80 inherited + 7 new), tsc clean.

---

## Code written by coordinator directly (in place of worktree subagents)

All 4 worktree-isolated subagent dispatches today failed to the same harness bug (the worktree isolation mode loaded the `fewer-permission-prompts` skill and ignored the prompt, reporting instead that Bash was blocked). Tasks 23/24/25/26 were completed coordinator-direct. See `docs/sessions/2026-04-22-worktree-subagent-bug.md` (if needed) for the bug pattern; the symptom is 100% reproducible: any Agent call with `isolation: "worktree"` gets hijacked to the fewer-permission-prompts skill. Workaround: do the work directly or dispatch without `isolation`.
