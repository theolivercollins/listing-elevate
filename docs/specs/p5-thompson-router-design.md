# P5 — Thompson-Sampling SKU Router — Design

Last updated: 2026-04-22 (all open questions resolved by Oliver — see §11)
Owner: Oliver
Designer: Window D (Opus), 2026-04-22
Status: Design final. No code, no migrations, no router changes. Ready for P5 Session 1 (scheduled 2026-04-30).

See also:
- [2026-04-22-v1-primary-tool-and-ml-roadmap-design.md](./2026-04-22-v1-primary-tool-and-ml-roadmap-design.md) — parent roadmap, P5 section
- [2026-04-20-back-on-track-design.md](./2026-04-20-back-on-track-design.md) — Phase M.2 / static router background that P5 replaces
- [../sessions/2026-04-21-park-router.md](../sessions/2026-04-21-park-router.md) — why the static router-grid was abandoned
- [../audits/ML-AUDIT-2026-04-20.md](../audits/ML-AUDIT-2026-04-20.md) — signal-pool baseline
- [../../lib/providers/router.ts](../../lib/providers/router.ts) — current intuition-based router (edited by P1; P5 layers on top)

---

## 1. Goal + North Star mapping

**Goal.** Replace the intuition-based router in `lib/providers/router.ts` with a Thompson-sampling bandit that picks a SKU per `(room_type × camera_movement)` scene from the posterior of observed ratings. The system self-bootstraps router decisions without a manual rating grid.

**North Star mapping.**

| North Star | How Thompson delivers |
|---|---|
| **#3 — No wasted money** | Thompson concentrates spend on SKUs with higher posterior mean as evidence accumulates. Low-performing SKUs see exponentially fewer trials once their posterior drops below competitors'. Static router wastes budget on losing SKUs forever. |
| **#4 — Right SKU per bucket** | Each `(room × movement × SKU)` triple is an independent arm. Bandit's explicit objective is to converge on the best arm per bucket. Static router hard-codes one SKU per bucket based on intuition; Thompson learns per-bucket from data. |

**Why Thompson vs. the rejected static rating-grid approach.**

The static grid (parked 2026-04-22 per `sessions/2026-04-21-park-router.md`) required Oliver to hand-rate a 5-scene × 4-SKU matrix and commit a one-shot `router-table.ts`. That approach failed because:

1. **Coverage gap** — 170 rated iterations produced 0 single-SKU winners (ratings too thinly spread across SKUs, legacy data not SKU-granular). Reference: `project_router_table_aggregation.md`.
2. **Frozen signal** — once committed, the table never updates. New rating data is inert at the router layer.
3. **Manual labor** — every time a new SKU lands on Atlas, Oliver must re-seed a grid. Doesn't scale.

Thompson fixes all three:

1. **Organic signal** — consumes the rating stream V1 is already producing; no dedicated grid.
2. **Continuous learning** — posterior updates every 4h as new ratings land.
3. **Auto-onboard new SKUs** — adding a SKU is one config line; bandit cold-starts it via §3.

---

## 2. Math — Beta-Bernoulli bandit

A well-known problem; this section cites rather than derives. Listing-Elevate-specific decisions live in §3–§7.

### 2.1 Model

Each arm is a triple `(room_type, camera_movement, sku)`. For each arm, we observe a stream of Bernoulli trials:

- **Success** (`y = 1`) — iteration rated `≥ 4★` (human or weighted auto-judge; see §6).
- **Failure** (`y = 0`) — iteration rated `≤ 3★`.

Latent success probability `θ_arm ∈ [0, 1]` is unknown. Prior: `Beta(1, 1)` (uniform / Laplace). After observing `α_arm` successes and `β_arm` failures, posterior:

```
p(θ_arm | data) = Beta(α_arm + 1, β_arm + 1)
```

References: Thompson (1933); Chapelle & Li (2011), "An empirical evaluation of Thompson sampling," NeurIPS; Russo et al. (2018), "A tutorial on Thompson sampling," Foundations and Trends in ML, §3.1.

### 2.2 Action selection (Thompson sampling)

Per scene `s` with bucket `(r_s, m_s)`:

```
for each sku in enabled_skus:
    draw  θ̂_{r_s, m_s, sku}  ~  Beta(α + 1, β + 1)
sku*  =  argmax  θ̂
```

Posterior-probability-matching: each SKU is picked with probability equal to its posterior probability of being optimal. Naturally balances exploration and exploitation.

Reference: Russo et al. (2018), §3.2.

### 2.3 Dashboard statistics (derived from `α`, `β`)

| Statistic | Formula | Notes |
|---|---|---|
| Trial count | `n = α + β` | |
| Posterior mean (`expected_win_rate`) | `E[θ] = (α + 1) / (α + β + 2)` | Laplace-smoothed |
| Posterior variance | `Var[θ] = (α+1)(β+1) / [(α+β+2)² (α+β+3)]` | Shrinks as `n` grows |
| 95% credible interval | `[Q_Beta(0.025; α+0.5, β+0.5), Q_Beta(0.975; α+0.5, β+0.5)]` | **Jeffreys interval** |
| Probability optimal | Monte Carlo: sample 10k times, fraction this arm wins | Expensive; compute on-demand per bucket |

**Why Jeffreys over Wilson.** Jeffreys is the natural Bayesian interval under a `Beta(0.5, 0.5)` reference prior and has near-optimal frequentist coverage for small `n`. Wilson score intervals are frequentist-flavored; for a bandit whose state is already Beta-posterior, Jeffreys is congruent and computes from the same `α`, `β`. Reference: Brown, Cai & DasGupta (2001), "Interval estimation for a binomial proportion," Statistical Science 16(2), §4.

### 2.4 Why Bernoulli, not multinomial over `{1,2,3,4,5}`

**Success threshold locked at 4★+ (Oliver 2026-04-22).** α = count of 4★ or 5★; β = count of 1★/2★/3★. 4.5★ is not a ratable value on the integer 1–5 scale, so the binary is effectively 4★+ vs ≤3★.

Considered: model the full 1–5 rating as a categorical posterior (Dirichlet-multinomial) so we can optimize `E[rating]` instead of `P(rating ≥ 4)`.

Rejected for V1 because:
- Our rating signal is roughly bimodal (good / not good); threshold at 4★ captures ~all decision-relevant variance.
- Bernoulli math is cleaner, faster, and every Thompson tutorial ships with Beta-Bernoulli code.
- Upgrading to multinomial is a migration-free change later: store `α`, `β` derived from ratings, and add `rating_histogram jsonb` if we want to switch models.

---

## 3. Cold-start rule

**Problem.** If arms are un-trialed or under-trialed, Thompson can lock onto an early lucky arm before exploring others. The parent spec (line 432) says: "cold-start rule forces each bucket to sample all SKUs at least 3× before any exploitation."

**Rule (formalized).**

For a scene with bucket `(r, m)`:

1. Let `enabled = { sku : router_bucket_stats.enabled = true AND sku ∈ V1_ATLAS_SKUS }`.
2. Let `undertrialed = { sku ∈ enabled : trial_count(r, m, sku) < 3 }`.
3. **If `undertrialed` is non-empty:** pick uniformly at random from `undertrialed`. (Forced exploration.)
4. **Else:** run Thompson sampling across `enabled`. (Exploitation-eligible.)

### 3.1 Edge case — partially cold buckets

The common case on Day 1: some SKUs already have `n ≥ 3` from historical V1 ratings, others have `n = 0`. Rule step 3 above handles this correctly — the under-trialed ones are picked first, and only once every SKU crosses `n = 3` does the bucket enter Thompson mode.

### 3.2 Edge case — arm added mid-life

If Atlas adds a new SKU (e.g. `kling-v2-7-pro` lands next month):

1. Add the SKU to `V1_ATLAS_SKUS` + mark `enabled=true` in `router_bucket_stats` seeds.
2. The new SKU immediately has `n = 0` in every bucket.
3. Cold-start rule 3 forces the router to try it 3× per bucket before any bucket can exclude it via Thompson.

This gives new SKUs a fair shot without a separate "new-SKU exploration" mode.

### 3.3 Edge case — all-SKUs-under-trialed bucket

If the bucket is fully cold (no SKU has `n ≥ 3`), rule 3 still applies — uniform random over enabled SKUs. This naturally interleaves exploration across arms. Cost-aware alternative (not recommended for V1): weight the uniform draw by `1/price_cents` to explore cheaper SKUs first. Deferred; added complexity without clear win at V1 rating volume.

### 3.4 Why `n = 3` specifically

`n = 3` is the minimum where a Beta-posterior's 95% credible interval width drops below ~0.6 (on `E[θ] = 0.5`). Below that, the arm's posterior is nearly the prior — Thompson samples are dominated by noise. At `n = 3` we begin to have actionable evidence.

**Locked at 3 (Oliver 2026-04-22).** 4 SKUs × 3 forced samples = 12 renders per new bucket, ~$0.72 at the default SKU mix. Acceptable.

**Scheduled review:** first monthly bandit audit (after P2 auto-judge pool is live) checks within-bucket variance at `n = 3`. If high variance indicates the posterior hasn't stabilized by then, raise the threshold. Flag this as a one-off scheduled review item.

Changing this threshold later is a one-line constant change (no migration).

---

## 4. Bucket sparsity fallback

**Problem.** Some buckets may never accumulate enough signal to trust Thompson at all. Example: `(game_room × rack_focus)` might see 0–2 total ratings across all SKUs in a given month. The parent spec (line 433) says: "fallback to v2.6-pro static default when bucket is sparse."

**Rule (formalized).**

For a scene with bucket `(r, m)`:

1. Let `total_trials = Σ (α + β)` over all enabled SKUs for that bucket.
2. **If `total_trials < 3`:** return `{ provider: 'atlas', modelKey: 'kling-v2-6-pro', reason: 'sparse_bucket_fallback' }`. Do not touch `router_bucket_stats`.
3. **Else:** apply cold-start rule §3, then Thompson rule §2.2.

### 4.1 Why `v2.6-pro` as the static default

Three converging signals:

- `project_kling_sku_observations.md` — Oliver's hand-rated intuition: V2.6 Pro is the best single-image SKU.
- Atlas docs — V2.6 Pro ships with "smoother motion" hint.
- `router_table_aggregation` — V2.6 Pro had the highest raw 4★+ rate across provider-level signal (though never cleared the 80%-per-SKU bar that the static grid required).

If a better default is validated later, it's a constant in `router.ts`. No migration.

### 4.2 Graceful recovery as bucket warms

When `total_trials` crosses 3, the bucket silently transitions out of fallback into cold-start or Thompson mode. No discontinuity — Thompson sampling with `n = 3` still pulls `v2.6-pro` most of the time if `v2.6-pro` is winning, just with proper posterior math instead of a hard-coded default.

### 4.3 Observability

Log every routing decision with `reason ∈ { 'thompson', 'cold_start_uniform', 'sparse_bucket_fallback', 'preference_override' }`. Dashboard `/dashboard/development/router-bandit` surfaces counts by reason. If `sparse_bucket_fallback` dominates for a bucket over 2+ weeks, Oliver can choose to either (a) force a cold-start rating session for that bucket, or (b) accept `v2.6-pro` as the stable default and stop alerting.

---

## 5. Rating update cadence

**Decision: 4-hour cron. Add a manual "refresh now" button on the dashboard as an escape hatch.**

### 5.1 Options considered

| Option | Pros | Cons |
|---|---|---|
| **4h cron** | Simple; deterministic worst-case lag; batch SQL is cheap; matches dashboard refresh cadence | Up to 4h between rating → bandit awareness |
| **On-write Postgres trigger** | Zero lag; event-driven | Hot-path write overhead (small but real); harder to test; races on concurrent writes need `FOR UPDATE` locking; trigger failures can silently corrupt counts; harder to re-run idempotently for recovery |
| **On-write app-layer hook** | Zero lag; testable in TS | Every rate-endpoint must remember to call it; divergence risk as new rate paths land (judge finalize, pairwise, rule-mining); same race concerns |
| **15-minute cron** | Lower lag than 4h | 16× the cron runs; most fire with no new ratings |

### 5.2 Why 4h cron is the right call

- **Rating cadence is slow.** Oliver rates at human cadence: maybe 10–50/day. Auto-judge (P2) adds ~80% more volume but still in the low-hundreds-per-day ballpark. A 4h lag on the posterior moves `E[θ]` by at most `1/(n+2) × max_delta`, which is <0.02 for arms with `n ≥ 50`. **Thompson is robust to this delay.**
- **System simplicity.** One scheduled job, one SQL refresh query, one timestamp to watch. No trigger debugging, no hot-path contention.
- **Cron infrastructure already exists.** `pg_cron` is already in use (see `MEMORY.md` reference to pg_cron). Adding a refresh job is a migration-free config change.
- **Manual override covers the impatient case.** Dashboard button fires the same refresh query on demand. "I just rated 20 things, let Thompson see them now" takes one click.

### 5.3 Cron definition (spec; implementation in P5 Session 2)

```sql
-- Runs at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
SELECT cron.schedule(
  'refresh-router-bucket-stats',
  '0 */4 * * *',
  $$ SELECT refresh_router_bucket_stats(); $$
);
```

Where `refresh_router_bucket_stats()` is a SQL function (defined in migration 038) that does:

```sql
-- Pseudocode — full SQL lands in P5 Session 1 implementation
INSERT INTO router_bucket_stats (room_type, camera_movement, sku, alpha, beta, last_updated)
SELECT
  room_type, camera_movement, sku,
  SUM(CASE WHEN effective_rating >= 4 THEN weight ELSE 0 END) AS alpha,
  SUM(CASE WHEN effective_rating <  4 THEN weight ELSE 0 END) AS beta,
  now()
FROM v_unified_rated_pool_with_weights  -- defined §6
GROUP BY room_type, camera_movement, sku
ON CONFLICT (room_type, camera_movement, sku) DO UPDATE
  SET alpha = EXCLUDED.alpha,
      beta  = EXCLUDED.beta,
      last_updated = EXCLUDED.last_updated;
```

Cost per run: one full aggregation over ~a few thousand rows — <100ms at V1 scale. Negligible.

### 5.4 Why NOT on-write triggers (deeper reasoning)

In a bandit, stale priors cause exploration-over-exploitation mistakes. Our arm count is bounded (≤ ~20 room_types × ~12 movements × ~6 SKUs ≈ 1,440 buckets, most empty). Even with stale stats, the worst-case decision error is: "pick `v2.6-pro` when `v2-master` just became marginally better." That's one wasted ~$0.10 render, not a systemic quality problem. **Not worth the plumbing cost** of triggers for a system that produces tens of ratings per day.

Re-evaluate if rating volume crosses ~500/day (post-P2 auto-judge scale).

---

## 6. Rating weighting — auto-judge vs. human

**Decision (Oliver 2026-04-22): humans only at P5 launch. Judge weight gated behind `JUDGE_ALPHA_WEIGHT` env var, default `0.0`. Flip to `0.5` only after the P2 calibration audit shows ≥80% human-judge agreement on a ≥50-sample holdout. Revisit the multiplier after 2 more weeks of judge-in-loop data. Env-var switch, no migration.**

### 6.1 Why weighting matters

P2 introduces Gemini auto-judge producing structured ratings with a `confidence` field (1–5). We need to blend human + auto-judge signal into `α`, `β` without:

1. Letting auto-judge noise drown out Oliver's gold-standard signal, OR
2. Wasting the 5× throughput multiplier auto-judge provides.

Treating all ratings equally (weight = 1.0) is the first failure mode — judge drift in P2's risk section would cascade directly into the bandit. Ignoring auto-judge forever is the second failure mode — we forfeit P2's whole point.

Oliver's directive resolves this by phasing: humans-only at launch, then promote the judge to a half-vote once it's been proven against a held-out sample.

### 6.2 Weighting scheme

`JUDGE_ALPHA_WEIGHT` is a single env var. Cron refresh (§5.3) multiplies every judge rating's pseudo-count contribution by this value.

| Phase | `JUDGE_ALPHA_WEIGHT` | Judge contribution |
|---|---|---|
| P5 launch (2026-04-30) | `0.0` | Excluded — humans only feed α/β |
| Post-P2-audit pass (≥80% agreement on ≥50 samples) | `0.5` | One judge rating = half a human vote |
| Two-weeks-later re-review | TBD | Adjust up/down based on judge-in-loop data |

Per-rating effective `weight` on the `v_unified_rated_pool_with_weights` view:

| Rating source | Effective weight |
|---|---|
| Human (Oliver) | **1.0** |
| Human override of judge (Oliver corrected) | **1.0** (replaces the judge row; no double-count) |
| Judge, confidence ≥ 3 | `JUDGE_ALPHA_WEIGHT` (0.0 at launch) |
| Judge, confidence ≤ 2 | **0.0** (stat-poison; excluded regardless of env) |

Fractional weights are valid in Beta-Bernoulli as long as the posterior remains `Beta(α + 1, β + 1)` — the math generalizes from counts to weighted pseudo-counts without loss.

Reference: Kuleshov & Precup (2014), "Algorithms for multi-armed bandit problems," §3.3, notes that Bayesian bandits admit weighted observations naturally via the conjugate update.

### 6.3 Why this scheme

- **Echo-chamber prevention (NS #2 > velocity).** Zero judge weight at launch means Thompson is calibrated on Oliver's gold-standard signal only. Judge is proven before it influences routing. 2026-04-22 Oliver directive.
- **0.5× cap post-audit.** One judge rating = half a vote — weaker than Oliver, strong enough to matter at scale. Anything higher risks amplifying judge biases before we've seen them stabilize over time.
- **Confidence ≥ 3 gate.** A judge saying "I'm not sure" (conf ≤ 2) is noise. Better to treat as no observation than to count it at small weight.
- **Override replaces, not augments.** When Oliver overrides a judge, the judge's row is retracted (weight 0) and Oliver's corrected rating lands at weight 1.0. No double-count.
- **Env-var, not migration.** Flipping `JUDGE_ALPHA_WEIGHT` in Vercel re-weights the whole posterior on the next cron tick (§5) or manual refresh. No migration, no deploy dance.

### 6.4 Failure mode: calibration collapse

If auto-judge systematically over-rates (all clips → 5★, conf 5), all arms' `α` grows uniformly, all arms' `β` stagnates, Thompson degenerates to "they're all equally great." Mitigations:

- **Kill switch:** set `JUDGE_ALPHA_WEIGHT=0` via env change. Next refresh (§5) re-weights the posterior to humans-only. Zero-downtime, zero-migration.
- **Monthly judge-human agreement audit** (P7 cadence). If Pearson correlation drops below 0.5 on the overlap set, pull the kill switch pending re-calibration.
- **Dashboard surfaces `judge_contribution_pct`** per bucket. If >90% of a bucket's α comes from judge, flag for human sampling (feeds P6 "Rate these first" panel).

---

## 7. A/B audit methodology (P5 Session 2)

**Goal.** Before flipping `USE_THOMPSON_ROUTER=true` for real V1 work, run a controlled A/B audit. 20 Thompson-routed vs. 20 static-routed V1 scenes. Judge-scored. Winner declared on evidence.

### 7.1 Assignment mechanism

- Draw 40 fresh scenes from ≥ 2 real listings covering the quota-high buckets (kitchen, living_room, master_bedroom, exterior_front, aerial — per `project_router_table_aggregation.md`).
- Each scene gets a deterministic assignment via `hash(scene_id + 'p5ab') mod 2`:
  - `0` → Thompson arm — route via `selectThompsonDecision()`.
  - `1` → Static arm — route via existing `resolveDecision()` (the current intuition-based router, or the spec P1 leaves in place).
- Record assignment in a new `router_ab_audit_2026-05-01` table (session-scoped; dropped after audit). Columns: `scene_id`, `arm`, `chosen_sku`, `rating`, `judge_score_json`, `notes`.

Deterministic hash assignment (vs. random) makes the audit reproducible. Oliver can re-run the audit by re-deriving assignments from scene IDs without a seed-value dance.

### 7.2 Judge-scoring procedure

- Every audit scene gets a P2 auto-judge call after render. Same rubric v1 used elsewhere.
- Oliver also human-rates **all 40** (not a sub-sample). Yes, that's 2× the audit's usual labor, but this is the call that decides if Thompson graduates toward prod. Oliver's signal is gold-standard; we don't pinch pennies on the audit.
- Judge and human ratings stored on the audit row. Either can trigger disqualification if disagreement is extreme (details below).

### 7.3 Win criterion

Oliver's existing rule for Phase B winners was `≥ 80% 4★+ on ≥ 3 iterations`. For the A/B, we need a comparable bar that accounts for N=20 per arm:

**Primary criterion — qualitative.** Oliver reviews the side-by-side audit report (`docs/audits/thompson-ab-2026-05-01.md`) and signs off: *"Thompson arm looks at least as good as static across the buckets I care about."*

**Secondary criterion — quantitative sanity check (both must hold):**

1. `mean_human_rating(thompson) ≥ mean_human_rating(static) − 0.3★` — Thompson is not materially worse on human scoring.
2. `mean_judge_score(thompson) ≥ mean_judge_score(static)` — Thompson is at least tied on auto-judge.

Note on statistical power: 20 vs. 20 with typical σ≈1★ detects a ~0.7★ difference at 80% power, p<0.05. We **cannot** require statistical significance at this N — we'd demand implausibly large effect sizes. Instead we use a non-inferiority framing: Thompson must be ≥ static within a 0.3★ margin. If Thompson is significantly *worse* than that margin, reject.

### 7.4 Disqualification conditions

Any of these halts the audit and prevents rollout:

- A Thompson-routed scene renders on a SKU not in `enabled=true` for its bucket (safety-rail failure).
- Judge-human Pearson correlation on the 40-scene set falls below 0.4 (judge is unreliable for this audit).
- A router bug causes ≥ 2 scenes to fail to render (implementation broken; fix before re-running).

### 7.5 Prod rollout threshold (locked 2026-04-22)

Audit Session 2 stops at "Thompson enabled for V1 only." Prod rollout is a separate Oliver decision. All four conditions must hold:

1. **≥ 2 weeks** of V1-only Thompson operation with no router bugs.
2. **≥ 100** human-rated Thompson-routed iterations.
3. **Thompson mean human rating ≥ static baseline by ≥ 0.2★** (measured on the ML health dashboard's rolling window).
4. **No individual bucket regressed by >0.3★** vs. its static baseline. *Added 2026-04-22 — protects against Thompson winning on average while losing badly on specific buckets. A per-bucket regression would be user-visible and is a credibility failure regardless of aggregate gains.*

Dashboard `/dashboard/development/router-bandit` must expose per-bucket Thompson-vs-static mean-rating delta so condition 4 is auditable at a glance. Any bucket breaching the 0.3★ regression threshold blocks prod rollout until that bucket recovers.

---

## 8. Feature flag + rollback

### 8.1 Flag

Environment variable `USE_THOMPSON_ROUTER`:

| Value | Behavior |
|---|---|
| `"true"` | `selectThompsonDecision()` is called for unpaired scenes. Falls through to `resolveDecision()` (static) if Thompson returns null (e.g. bandit-off bucket, or all SKUs disabled). |
| `"false"` / absent | `resolveDecision()` static router is used for every unpaired scene. No Thompson path executed. |

Paired scenes (`endPhotoId` set) bypass Thompson regardless of the flag — they remain on `kling-v2-1-pair` per RULE DQ.3 in the current `router.ts`.

### 8.2 Rollback plan

- **Flip-off:** `USE_THOMPSON_ROUTER=false` env change. Vercel redeploys automatically; next render uses static router. Zero migration work, zero data loss.
- **Data preservation:** `router_bucket_stats` + the cron job remain live when flag is off. Posterior continues to update as V1 ratings land. When we flip back on, Thompson resumes with the latest posterior — no cold-restart.
- **Rip-out (worst case):** If the whole bandit approach is abandoned, migration 038 remains applied (additive-only; table + function stay). No rollback migration needed. `lib/providers/thompson.ts` module deletion is a code-only diff.

### 8.3 Feature-flag disposition on Oliver's side

Recommend: flag defaults to `"false"` in `.env.example`. P5 Session 2's "enable for V1" is a one-environment-variable override in Oliver's local or Vercel dev environment. Prod starts at `"false"` indefinitely until Oliver's separate rollout decision (§7.5).

---

## 9. Migration number reservation

Parent roadmap's migration allocation:

| Phase | Migration(s) | Status |
|---|---|---|
| P1 (2026-04-22) | 031 | **Applied** on main (commit `f3682e7`) |
| P2 (2026-04-23 → 04-24) | 032, 033 | Reserved |
| P3 (2026-04-25 → 04-27) | 034, 035 | Reserved |
| P4 (2026-04-28 → 04-29) | 036, 037 | Reserved |
| **P5 (2026-04-30)** | **038** | **Reserved — confirmed free** |
| P6 (2026-05-02) | 039 | Reserved |

Verified `supabase/migrations/` ends at `031_prompt_lab_iterations_sku.sql` on main as of 2026-04-22. 038 is available. If P2/P3/P4 land before P5 implementation, the verification step in P5 Session 1's Open block re-confirms the next-available number (per parent spec line 126: "each phase's implementation plan reconfirms the actual number at execution time").

### 9.1 Migration 038 — schema sketch (for P5 Session 1)

```sql
-- supabase/migrations/038_router_bucket_stats.sql
CREATE TABLE router_bucket_stats (
  room_type        text NOT NULL,             -- free text, no enum; survives taxonomy drift (Q6)
  camera_movement  text NOT NULL,
  sku              text NOT NULL,
  alpha            numeric(10, 2) NOT NULL DEFAULT 0,  -- fractional weights → numeric
  beta             numeric(10, 2) NOT NULL DEFAULT 0,
  enabled          boolean NOT NULL DEFAULT true,
  last_updated     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_type, camera_movement, sku)
);

CREATE INDEX idx_router_bucket_stats_bucket ON router_bucket_stats (room_type, camera_movement);

-- Shadow log — dedicated table (Q5). One row per V1 render routing decision
-- during dry-run mode (P5 Session 1) AND live mode (P5 Session 2+).
-- Keeps prompt_lab_iterations lean; powers /dashboard/development/router-bandit
-- divergence metric + per-bucket A/B analysis.
CREATE TABLE router_shadow_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iteration_id           uuid NOT NULL REFERENCES prompt_lab_iterations(id) ON DELETE CASCADE,
  thompson_decision_json jsonb NOT NULL,   -- { sku, alpha, beta, sampled_theta, reason }
  static_decision_json   jsonb NOT NULL,   -- { sku, reason } from resolveDecision()
  divergence_reason      text,             -- null if same SKU; else 'thompson_posterior' | 'cold_start' | 'sparse_fallback' | 'preference_override'
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_router_shadow_log_iteration ON router_shadow_log (iteration_id);
CREATE INDEX idx_router_shadow_log_created   ON router_shadow_log (created_at DESC);

-- Refresh function — idempotent
CREATE OR REPLACE FUNCTION refresh_router_bucket_stats() RETURNS void LANGUAGE sql AS $$
  INSERT INTO router_bucket_stats (...) ... ON CONFLICT ... DO UPDATE ...;
$$;

-- pg_cron schedule (separate migration block or seeded via SQL after RLS)
SELECT cron.schedule('refresh-router-bucket-stats', '0 */4 * * *',
  $$ SELECT refresh_router_bucket_stats(); $$);
```

Full SQL is produced by P5 Session 1. This sketch validates the shape only.

**Taxonomy note.** `room_type` (and `camera_movement`) are `text`, not enum-checked. Rationale: taxonomy drifts (e.g. `master_bedroom → primary_bedroom` rename campaigns) would break enum-checked schemas and require blocking migrations. Runtime validation lives in application code (`lib/db.ts` type guards + the V1 render pipeline's existing `RoomType` validation). Stats rows for retired labels become orphaned harmlessly and can be cleaned by an opt-in one-off script.

---

## 10. Dashboard spec — `/dashboard/development/router-bandit`

Net-new admin dashboard page. Read-only (no mutations from UI in P5 Session 1; Oliver can disable a SKU per bucket in P5 Session 2 or later by flipping `enabled`).

### 10.1 Page layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ Router Bandit   [Refresh now]  last_updated: 2026-05-01 08:00 UTC   │
├─────────────────────────────────────────────────────────────────────┤
│ Flag: USE_THOMPSON_ROUTER = true       Thompson ↔ Static divergence │
│                                             (rolling 7d): 32%       │
├─────────────────────────────────────────────────────────────────────┤
│ Filters: [Room: all ▾]  [Movement: all ▾]  [SKU: all ▾]             │
│ Sort:    [expected_win_rate desc ▾]                                 │
├─────────────────────────────────────────────────────────────────────┤
│ bucket                      sku              n   α/β    E[θ]  95%CI │
│ ───────────────────────────────────────────────────────────────── │
│ kitchen × push_in           kling-v2-6-pro   18  14/4  0.75  [.53,.89] ★│
│ kitchen × push_in           kling-v2-master  12   7/5  0.57  [.31,.80]  │
│ kitchen × push_in           kling-v3-pro      3   1/2  0.40  [.08,.80] cold│
│ kitchen × push_in           kling-o3-pro      0   0/0  —     (cold)     │
│ living_room × orbit         ...                                          │
│ ...                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.2 Columns

| Column | Source | Notes |
|---|---|---|
| `bucket` | `room_type × camera_movement` | Grouped rows visually |
| `sku` | `router_bucket_stats.sku` | |
| `n` (trial count) | `α + β` | |
| `α/β` | `router_bucket_stats` | Human-readable raw counts |
| `E[θ]` (expected_win_rate) | `(α + 1) / (α + β + 2)` | Posterior mean |
| `95% CI` | Jeffreys interval per §2.3 | |
| `enabled` | `router_bucket_stats.enabled` | Toggle — P5 Session 2+ |
| `status tag` | Derived | `★` = bucket leader (highest `E[θ]` when Thompson-eligible), `cold` = `n < 3`, `sparse` = bucket total `< 3` |

### 10.3 Filters

- **Room** — dropdown of distinct `room_type` values.
- **Movement** — dropdown of distinct `camera_movement` values.
- **SKU** — dropdown of distinct SKUs in `V1_ATLAS_SKUS`.

### 10.4 Top-of-page metrics

- **Flag state** — `USE_THOMPSON_ROUTER` effective value (read from env).
- **Thompson↔Static divergence (rolling 7d)** — percentage of scenes where Thompson's sampled SKU differs from what the static router would have returned. Computed from `router_shadow_log` (created in migration 038 per §9.1).
- **Per-bucket Thompson-vs-static mean rating delta** — required by the prod rollout bar (§7.5 condition 4). Column per bucket row showing `Δ★ vs. static baseline`. Negative deltas >0.3★ flagged red.
- **`last_updated`** — most recent `router_bucket_stats.last_updated` timestamp.

### 10.5 Manual refresh button

Calls `POST /api/admin/router-bandit/refresh` → invokes `refresh_router_bucket_stats()`. Shows success toast with new `last_updated`. Covers the "I just rated 20 scenes, want the bandit to see them" case (§5.2).

### 10.6 Integration with existing `/dashboard/development/ml-health`

Per parent roadmap §Cross-cutting — Success dashboard, `ml-health` already surfaces "Bucket bandit state (after P5): trial count + confidence interval per bucket." The `router-bandit` page is the deep-dive; `ml-health` shows summary tiles linking to it.

---

## 11. Open questions — RESOLVED 2026-04-22

All six open questions posed in this design's first draft were resolved by Oliver on 2026-04-22. Decisions are inlined in the sections cited below; this table is preserved as the change log.

| # | Section | Decision |
|---|---|---|
| Q1 | §2.4 | Success threshold locked at **4★+**. 4.5★ isn't a ratable value on the integer 1–5 scale. |
| Q2 | §6 | Humans only at P5 launch. `JUDGE_ALPHA_WEIGHT` env var gates judge contribution: `0.0` at launch → `0.5` after P2 audit passes (≥80% agreement on ≥50-sample holdout) → revisit after 2 more weeks. Env-var switch, no migration. |
| Q3 | §7.5 | Prod rollout requires **all four**: 2 weeks + 100 iter + mean ≥ static + 0.2★ + **no bucket regressed >0.3★**. The per-bucket regression guard was added in Oliver's answer to protect against average-gain / bucket-loss credibility failures. |
| Q4 | §3.4 | Cold-start `n = 3` locked. Scheduled review at first monthly bandit audit if judge-era variance at n=3 warrants raising. |
| Q5 | §§9.1, 10.4 | Dedicated `router_shadow_log` table in migration 038. Keeps `prompt_lab_iterations` lean; per scale-first architecture invariant. |
| Q6 | §9.1 | `router_bucket_stats.room_type` is free `text`, no enum check. Runtime validation in app code. Survives taxonomy drift. |

---

## Cross-references

This design explicitly **does not** modify:

- `lib/providers/router.ts` — P1's file today.
- Any other P1 file. (See parent spec P1 deliverables list.)
- Migrations 031–037. (Allocated to earlier phases.)

This design **is a pre-cook for P5 Session 1**. Implementation plan (via `superpowers:writing-plans`) is produced at P5 execution time (2026-04-30), consuming this spec as input.

## Program-wide invariants preserved

- **Additive schema only.** Migration 038 adds one table + one function + one cron schedule. No destructive changes.
- **Reversibility.** Flag off → static router. Data preserved. No migration revert.
- **Cost-event discipline.** Every routing decision feeds the cost_events pathway via the existing provider instantiation. Thompson doesn't introduce a new cost surface.
- **No push / no deploy without explicit permission.** This spec commits locally to the worktree branch only.
