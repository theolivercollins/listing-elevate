# P3 — Image-Embedding Provider Preflight Decision

Last updated: 2026-04-22 (open questions resolved by Oliver same day)
Author: Window C (Opus, 2026-04-22)
Purpose: Pre-cook the provider decision for P3 Session 1 (2026-04-25) so that session is pure implementation.
Status: **Final.** All 5 open questions resolved (see §8). Ready for P3 Session 1 execution.

See also:
- [../specs/2026-04-22-v1-primary-tool-and-ml-roadmap-design.md](../specs/2026-04-22-v1-primary-tool-and-ml-roadmap-design.md) — P3 program spec
- [../state/STACK.md](../state/STACK.md) — current provider inventory
- [./ML-AUDIT-2026-04-20.md](./ML-AUDIT-2026-04-20.md) — ML loop audit verdict

---

## 1. Decision

**Recommendation: (b) Gemini Genai SDK multimodal embeddings — `gemini-embedding-2`, at `outputDimensionality: 768`.**

The SDK (`@google/genai ^1.50`) and credential (`GEMINI_API_KEY`) are already in the repo and in production env for `lib/providers/gemini-analyzer.ts`. Per-image cost ($0.00012) is within noise of Vertex ($0.0001) and well under half of Replicate CLIP ($0.00022), so the decision collapses to integration footprint — and Gemini is a zero-new-dependency path.

---

## 2. Side-by-side comparison

| Option | Dim | Auth | Cost per 1k imgs | Latency / img | SDK already in repo? | Rate limits |
|---|---|---|---|---|---|---|
| (a) Vertex AI `multimodalembedding@001` | 128 / 256 / 512 / **1408** (default 1408) | ADC / GCP service account (new) | **~$0.10** ($0.0001/image) | Not published; community ~0.5–1.5s; validate at P3 Session 1 | ❌ `@google-cloud/aiplatform` — not installed | 120–600 RPM per region |
| (b) Gemini `gemini-embedding-2` via `@google/genai` | 128–3072 flexible (default 3072, recommended 768 / 1536 / 3072; Matryoshka auto-normalized) | API key (`GEMINI_API_KEY` — **already in prod env**) | **~$0.12** ($0.45 / 1M input tokens → ~$0.00012/image per Google's own per-image conversion) | Same base64-inline path as `gemini-analyzer.ts`; measured ~1–2 s warm in that code | ✅ `@google/genai ^1.50` — already a dep, already imported in `lib/providers/gemini-analyzer.ts` | Not published on pricing page; tier-based via AI Studio |
| (c) Replicate `andreasjansson/clip-features` (CLIP ViT-L/14) | **768** (fixed) | Replicate API token (new env var) | **~$0.22** ($0.00022/prediction on T4; ~$0.000225/sec × ~1s) | ~1 s warm; 3–10 s cold-start unless Deployments kept warm | ❌ `replicate` npm — not installed | Not documented on public pricing page |

Sources (accessed 2026-04-22):

- Vertex `multimodalembedding@001` dims + SDK + auth: [docs.cloud.google.com — Get multimodal embeddings](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings)
- Vertex pricing per image ($0.0001): aggregated via Google Cloud pricing calculator references; confirmed in Google Cloud pricing list. (Not exposed on the consolidated pricing page we fetched — validate at P3 Session 1 preflight before committing a service account.)
- Gemini Embedding 2 multimodal support + dims: [ai.google.dev — Gemini Embedding 2 preview model](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2-preview), [ai.google.dev — Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
- Gemini pricing — text $0.20 / 1M, image $0.45 / 1M (~$0.00012/image): [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) (paid tier; free tier is $0)
- Replicate hardware pricing (T4 $0.000225/sec): [replicate.com/pricing](https://replicate.com/pricing)
- Replicate CLIP features (ViT-L/14, T4, ~1s run, ~$0.00022/prediction): [replicate.com/andreasjansson/clip-features](https://replicate.com/andreasjansson/clip-features)

Note: Vertex per-image price ($0.0001) is the commonly-cited figure but was not surfaced on the consolidated 2026 Google Cloud pricing page when fetched. Resolved as moot per §8 Q5 — we're not picking Vertex.

---

## 3. Cost model

### One-time backfill — ~150 V1 photos (existing Phase 2.8 listing photos + prod scenes to date)

| Option | Per-image | Total backfill |
|---|---|---|
| (a) Vertex | $0.0001 | **$0.015** |
| (b) Gemini | $0.00012 | **$0.018** |
| (c) Replicate CLIP | $0.00022 | **$0.033** |

All three are ~2 orders of magnitude under the $3 P3 Session 1 backfill budget.

### Recurring — per new V1 session going forward

Typical pace (post-P1): Oliver generates ~10–30 V1 iterations/day; each iteration has one source photo that needs embedding once (session-scoped). Assume ~50 new photos/week upper bound.

| Option | 50 imgs/wk | 200 imgs/mo | 2,400 imgs/yr |
|---|---|---|---|
| (a) Vertex | $0.005/wk | $0.02/mo | $0.24/yr |
| (b) Gemini | $0.006/wk | $0.024/mo | $0.29/yr |
| (c) Replicate | $0.011/wk | $0.044/mo | $0.53/yr |

Recurring cost is rounding-error regardless of provider. Cost is not the deciding axis.

### Fusion query cost (retrieval time)

Retrieval reads the stored image embedding from pgvector — zero API calls, zero cost. The only query-time API call is the text embedding for the query scene (already done today via `lib/embeddings.ts`). **P3 adds no per-query embedding API cost.**

---

## 4. Risks + mitigations

### R1 — Provider changes embedding behavior or deprecates endpoint

- **Gemini** `gemini-embedding-2` is "stable (GA)" per the Apr 2026 pricing page but "preview" per the model page — status is in transition. Embedding spaces are explicitly documented as **incompatible** across model versions (Google: "you cannot directly compare embeddings generated by one model with embeddings generated by the other"). A forced model version bump means re-embedding the entire pool.
- **Vertex** `multimodalembedding@001` is the longest-lived, most-stable of the three (available since 2023). Lowest risk of forced deprecation.
- **Replicate CLIP** is a pinned checkpoint (ViT-L/14); effectively immune to behavior drift. Risk is Replicate-the-service availability.

**Mitigation:** keep abstraction provider-agnostic (see §5). If Gemini forces a v3 bump, the migration is `scripts/reembed-image-pool.ts` + provider swap — one-day effort.

### R2 — Rate-limit starvation during backfill

- Vertex: 120–600 RPM per region. 150 photos fits easily; no throttling risk.
- Gemini: not published on the rate-limits page; AI Studio tier-dependent. For ~150 photos with ~1 call/s, no tier we'd be on would choke.
- Replicate: not published; Deployments mitigate.

**Mitigation:** `scripts/backfill-image-embeddings.ts` uses a simple `p-limit` concurrency cap (4–8), same pattern as existing analyzer backfills. Failures retry with exponential backoff.

### R3 — Dim mismatch on later provider swap

- Migration 034 bakes in a specific vector dimension (`vector(NNN)`). Swapping providers with a different native dim requires either a new migration (`photos.image_embedding_v2`) or re-embed + truncate/pad.
- Choosing **768** aligns with CLIP-L native dim and is cleanly addressable by Gemini's Matryoshka output. Vertex doesn't support 768 natively (128/256/512/1408) — a forced switch to Vertex means migrating to 512 (closest supported smaller dim; accept quality loss) or 1408 (full re-embed + schema migration).

**Mitigation:** document the swap-path in §4's R1 response. 768 is a reasonable compromise, not a cross-provider universal.

### R4 — Cold-start latency (Replicate only)

Replicate's 3–10s cold-start would be painful for any online path. P3 Session 1's only online use is the backfill script (batch — cold-start amortized over N photos). Future online embeddings (new session photo uploads) would feel the 3–10s hit.

**Mitigation:** not relevant for the chosen option. If we fall back to Replicate, use Deployments.

### R5 — GCP billing / service-account sprawl (Vertex only)

The repo currently has no GCP service-account on Vercel. Adding one means:
- A new JSON credential env var (multi-line handling on Vercel)
- A GCP project with billing enabled
- ADC scoping that is safe for our Vercel serverless environment

This is a real operational cost that bites on the Vertex path and does not bite on the Gemini or Replicate paths. Not technically hard, but not trivial either.

**Mitigation:** not relevant for the chosen option.

### R6 — Aggregation semantics on Gemini multimodal embeddings

Google's own docs: *"Submitting multiple parts (for example, text and an image) within a single content entry produces one aggregated embedding for all modalities."* For our use case we want a **pure image embedding**, so the call must pass only the `inlineData` image part and no text. Confirmed feasible; just a call-construction rule.

**Mitigation:** enforce in `lib/embeddings-image.ts` — image-only parts, assert `contents.length === 1` with only an `inlineData` block.

---

## 5. Integration sketch — `lib/embeddings-image.ts`

Not production code. Reference skeleton, ~40 lines, to show shape + where `cost_event` fires. Mirrors `lib/providers/gemini-analyzer.ts` pattern (base64 inline fetch, single-model primary, GoogleGenAI client).

```ts
// lib/embeddings-image.ts
import { GoogleGenAI } from "@google/genai";
import { recordCostEvent } from "./db.js";

const MODEL = "gemini-embedding-2";
const OUTPUT_DIM = 768;
const COST_CENTS_PER_IMAGE = 0.012; // $0.00012/image per Gemini pricing 2026-04-22

export interface ImageEmbeddingResult {
  vector: number[];
  model: string;
  dim: number;
  usage: { costCents: number };
}

export async function embedImage(imageUrl: string, opts?: {
  surface?: "lab" | "prod" | "backfill"; // maps to metadata.surface
  photoId?: string;                      // maps to metadata.photo_id
}): Promise<ImageEmbeddingResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  // Fetch + base64 (same pattern as gemini-analyzer.ts fetchImage)
  const { base64, mimeType } = await fetchImageAsBase64(imageUrl);

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.embedContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: base64 } }] }],
    config: { outputDimensionality: OUTPUT_DIM },
  });

  const vector = res.embeddings?.[0]?.values;
  if (!vector) throw new Error("Gemini returned no embedding vector");

  // Cost event fires here, always — even on a retry path, once per successful call.
  // Uses the existing stage='analysis' enum (no migration) with metadata.subtype
  // for per-feature breakdowns — same pattern as DA.1 photo-eyes and P1 Lab renders.
  await recordCostEvent({
    stage: "analysis",
    provider: "google",
    model: MODEL,
    cost_cents: COST_CENTS_PER_IMAGE,
    metadata: {
      subtype: "image_embedding",
      surface: opts?.surface ?? "lab",  // 'lab' | 'prod' | 'backfill'
      photo_id: opts?.photoId ?? null,
      dim: OUTPUT_DIM,
    },
  });

  return { vector, model: MODEL, dim: OUTPUT_DIM, usage: { costCents: COST_CENTS_PER_IMAGE } };
}

// Provider-agnostic boundary: downstream code only sees `embedImage`.
// To swap to Vertex or Replicate, replace the body of this file — callers unchanged.
// Export a `safe` variant matching embedTextSafe in lib/embeddings.ts for Lab graceful-degrade paths.
```

Key shape properties:
- Single export that hides provider. RPC updates in P3 Session 1 (`match_rated_examples` variants + new fused ranker) call nothing from this file directly — they read `photos.image_embedding` off the DB.
- `cost_event` fires inside the wrapper so every code path gets a ledger row (backfill, live-session embed, retry-after-null). Consistent with cost-tracking first-class policy.
- `outputDimensionality: 768` is explicit and configurable via a constant at top. Changing dim requires (a) updating this constant AND (b) a schema migration — deliberately coupled to prevent drift.

---

## 6. Migration number reservation

**Migration 034 is free and reserved for P3 Session 1.** Confirmed against `supabase/migrations/` and cross-confirmed against parallel worker branches (Window D on P5 confirmed 038 free; 034/035/038 all clean):

- 030 — `photo_camera_state` (DA.1, applied 2026-04-21)
- 031 — `prompt_lab_iterations_sku` (P1, shipping on main today 2026-04-22)
- 032 — reserved by P2 Session 1 for `prompt_lab_iterations_judge` (2026-04-23)
- 033 — reserved by P2 Session 2 for `judge_calibration_examples` (2026-04-24)
- **034 — reserved for P3 Session 1: `photos.image_embedding vector(768)` + `prompt_lab_sessions.image_embedding vector(768)` + HNSW indexes on both**
- 035 — reserved by P3 Session 2 for `iterations_tsvector` (hybrid retrieval)
- 036 — reserved by P4 Session 1 for `prompt_lab_session_analysis`
- 037 — reserved by P4 Session 1 for `unified_rated_pool_view`
- 038 — reserved by P5 Session 1 for `router_bucket_stats` (Thompson bandit)

Dimension (`vector(768)`) is baked into the migration and must match `OUTPUT_DIM` in `lib/embeddings-image.ts`. Change one, change the other — enforce via a review-time check in P3 Session 1 implementation plan.

Include `CREATE INDEX ... USING hnsw (image_embedding vector_cosine_ops)` on both columns, matching the text-embedding index pattern from prior migrations.

---

## 7. Fusion-weight methodology (not the final weights)

The P3 spec pins initial weights at `w_text=0.4, w_image=0.6`. This audit does **not** pick final weights — that's a Session 1 deliverable. What it specifies is the *methodology* for P3 Session 1 to validate them:

### Step 1 — Build a small labeled test set

Pool source: existing rated Lab iterations with photo embeddings (post-backfill). Pick 10 query scenes where Oliver has clear intuition about which 5 exemplars *should* retrieve as "most similar useful neighbor." These become the gold labels.

- Scope queries to a single (room_type × camera_movement) bucket each, to isolate the fusion-weight effect from retrieval-pool scope.
- Include at least 3 scenes where text signal and visual signal would disagree (e.g. identical room_type + movement but visually very different photos — dim kitchen vs bright kitchen).

### Step 2 — Grid-search three candidate weight ratios

Run the retrieval RPC with three fusion weightings against the 10-query test set:

| Candidate | w_text | w_image | Rationale |
|---|---|---|---|
| A | 0.4 | 0.6 | Spec default — image-heavy |
| B | 0.5 | 0.5 | Balanced — neutral prior |
| C | 0.3 | 0.7 | Visually-dominant — Oliver's exoskeleton intuition |

For each candidate, compute:
- **Precision@5** — of top-5 retrieved, how many match Oliver's gold set?
- **Bucket-consistency** — does top-5 stay within the expected (room × movement) bucket?
- **Diversity check** — any near-duplicate top-3 that a human would dedup?

### Step 3 — Pick the winner; document reasoning

Commit the test-set queries, the three-candidate scores, and the chosen weight to `docs/audits/retrieval-fusion-2026-04-25.md` (already required by P3 Session 1). Tune via env var `RETRIEVAL_FUSION_W_TEXT` / `_W_IMAGE` so production can swap without a deploy.

### Guardrail

The methodology deliberately does NOT pretend to have enough data for a statistically-rigorous sweep. 10 queries is a sanity sweep, not a proof. The P4 phase will re-run this with the P2 auto-judge pool as ground truth on 50+ scenes — that is the real validation.

---

## 8. Open questions — resolved by Oliver (2026-04-22)

All five resolved the same day the audit was written. Decisions recorded inline below; P3 Session 1 executes against these.

### Q1 — Dim lock-in: **768 confirmed**

Text and image live in separate columns; fusion happens at score level (weighted hybrid), not via embedding concatenation, so matching OpenAI's 1536 buys nothing. 512 was only relevant if we had picked CLIP on Replicate. 768 is the correct middle ground: ~half the storage of 1536, HNSW index stays fast at scale, and signal-loss vs Gemini's native 3072 is empirically minor for visual-similarity tasks. **Migration 034 uses `vector(768)`. No further debate.**

### Q2 — Gemini billing tier for embeddings: **defer to P3 Session 1 preflight**

Not a doc-time blocker. First Gemini embedding call at P3 Session 1 kickoff will either succeed (billing OK) or 403 with a clear error. Backfill budget is $3; even a 2× surprise is absorbed. Existing `GEMINI_API_KEY` is known to work for vision analysis via `lib/providers/gemini-analyzer.ts` (DA.1 ship). The embeddings endpoint may or may not be on the same billing SKU — verify at first call, not at doc time.

### Q3 — `cost_event` shape: **match existing pattern, no schema change**

Do NOT introduce a new `scope` column or a new `stage` enum value. Use the existing pattern already codified for photo analysis:

```
stage       = 'analysis'                      // existing enum value; extending would need a migration we don't need
provider    = 'google'
model       = 'gemini-embedding-2'
metadata.subtype = 'image_embedding'
metadata.surface = 'lab' | 'prod' | 'backfill'
metadata.photo_id = <uuid>
metadata.dim = 768
```

Dashboard queries filter on `metadata.subtype` for per-feature spend breakdowns. Same approach as P1 Task 10 (Lab render cost_events use `metadata.surface='lab'`, no new schema). §5 integration sketch now reflects this shape.

### Q4 — Provider abstraction form factor: **single-file, defer interface (YAGNI)**

Single-file `lib/embeddings-image.ts` wrapping Gemini directly. Refactor into a proper `ImageEmbeddingProvider` interface (matching `lib/providers/provider.interface.ts`) only when a second provider actually exists. P3 Session 1 writes the single-provider version. No multi-implementation scaffolding today.

### Q5 — Vertex pricing uncertainty: **moot (we're on Gemini)**

See §9 "Historical alternatives" below for the 1-line note. Not a blocker.

---

## 9. Historical alternatives (one-line notes)

For future reference if provider ever flips:

- **Vertex `multimodalembedding@001`:** commonly-cited $0.0001/image was not surfaced on the consolidated Google Cloud 2026 pricing page during this audit; validate before committing a GCP service-account setup if plan ever flips. Per-region RPM 120–600, native dims 128/256/512/1408.
- **Replicate CLIP ViT-L/14 (`andreasjansson/clip-features`):** fixed 768-dim, ~$0.00022/prediction on T4, ~1s warm / 3–10s cold-start. Most-stable pinned checkpoint of the three; least convenient (new SDK + API token + cold-start risk).

---

## Summary for coordinator

- **Recommendation:** Gemini `gemini-embedding-2` via `@google/genai`, `outputDimensionality: 768`. All 5 open questions resolved by Oliver 2026-04-22.
- **Rationale:** Zero new SDKs, zero new env vars, cost parity with Vertex, clean integration pattern already proven by `gemini-analyzer.ts`.
- **Migration 034 reservation:** `photos.image_embedding vector(768)` + `prompt_lab_sessions.image_embedding vector(768)` + HNSW cosine indexes. 035 / 036 / 037 / 038 also reserved across P3 Session 2 / P4 / P5.
- **`cost_event` shape:** `stage='analysis'`, `provider='google'`, `metadata.subtype='image_embedding'`, `metadata.surface`, `metadata.photo_id`, `metadata.dim`. No schema change.
- **Abstraction:** single-file `lib/embeddings-image.ts`. No interface scaffolding until a second provider exists.
- **Fusion weights:** spec-default `w_text=0.4, w_image=0.6` as starting point; validated via 10-query test in Session 1, committed to `docs/audits/retrieval-fusion-2026-04-25.md`.
- **Must NOT do in P3 Session 1 preflight (30-min callout in spec):** call the actual endpoint. That's Session 1's implementation job. This audit is docs-only.
