# Listing Elevate — Stack Reference

Last updated: 2026-04-21

See also:
- [../HANDOFF.md](../HANDOFF.md) — current state + shipping log
- [PROJECT-STATE.md](./PROJECT-STATE.md) — authoritative project state
- [TODO.md](./TODO.md) — active backlog

## Infrastructure

| Service | Role | Notes |
|---|---|---|
| Vercel | Hosting, serverless functions, cron jobs, custom domain | `listingelevate.com` + `reelready-eight.vercel.app` |
| Supabase | Postgres, pgvector, Storage, Auth (magic link), RLS, RPCs | Project: `vrhmaeywqsohlztoouxu` |
| GitHub | Source control | Repo: `theolivercollins/reelready` |

## AI / ML

| Service | Model / Method | Usage |
|---|---|---|
| Google | Gemini 3 Flash (id `gemini-3-flash-preview`, fallback `gemini-2.5-flash`) | **Eyes** of the director (DA.1, 2026-04-21). Per-photo structured analysis emitting camera_height/tilt/frame_coverage + `motion_headroom` booleans. Wired in `lib/providers/gemini-analyzer.ts`; called from `lib/pipeline.ts::runAnalysis` (prod) and `lib/prompt-lab-listings.ts::analyzeListingPhotos` (Lab). Claude photo analyzer is the fallback. |
| Anthropic | Claude Sonnet 4.6 | **Brain** of the director — shot planning + prompt writing. Respects Gemini's motion_headroom as hard camera-movement bans (DA.2). Also handles fallback photo analysis when Gemini fails, refinement, rule mining. |
| Anthropic | Claude Haiku 4.5 (streaming SSE) | Listings Lab scene chat w/ `save_future_instruction` + `update_director_prompt` tools |
| OpenAI | text-embedding-3-small (1536 dim) | pgvector similarity retrieval (legacy Lab + prod + listings unified pool) |

NPM: `@anthropic-ai/sdk ^0.39.0`, `@google/genai ^1.50`. OpenAI called via raw fetch in `lib/embeddings.ts`.

## Video Generation Providers

| Provider | Status | Strengths | Notes |
|---|---|---|---|
| **Atlas Cloud** | Active (prod + Lab) | Aggregator exposing Kling + Seedance SKUs via one key + endpoint; supports `negative_prompt`, `cfg_scale`, `end_image`, `resolution` | Env `ATLASCLOUD_API_KEY`, `ATLAS_VIDEO_MODEL` (default **`kling-v2-6-pro`**). Kling SKUs: kling-v3-pro ($0.475/5s), kling-v3-std ($0.355/5s), kling-v2-6-pro ($0.60/5s, v1 default), kling-v2-1-pair ($0.38/5s, start-end-frame, auto-routed for paired scenes), kling-v2-master ($1.105/5s, no end-frame), kling-o3-pro ($0.475/5s). Seedance SKUs: seedance-pro-pushin (9.6¢/s, push-in/v1.1 default), **seedance-2-0-4k** (11.2¢/s, UHD 3840×2160 HEVC, added 2026-06-26). Operator SKU picker (`properties.video_model_sku`) overrides routing at RULE 0 — terminal, no failover. `lib/providers/atlas.ts::ATLAS_MODELS` is the server-side source of truth; `getOperatorVideoSkus()` returns the ordered picker list. |
| **Kling (native)** | Active (Lab listings) | Oliver's pre-paid Kling credits; $0 variable cost | Model key `kling-v2-native`. Routes via `lib/providers/kling.ts`. 402/credit-exhaustion auto-failovers to Atlas `kling-v2-master`. Cost events: `provider='kling', billing='prepaid_credits'`. Wired 2026-04-20. |
| Kling (legacy) | Active (legacy Lab + prod) | Interiors, dolly/parallax/reveal | 5-concurrent trial cap, auto-fallback to Runway |
| Runway Gen-4 Turbo | Active (legacy Lab + prod) | Exteriors, push_in/pull_out/drone | URL-based image input |
| ~~Luma Ray2~~ | **Removed 2026-05-18** | | Provider file and type-enum entries deleted; never used by production routing. Historical `cost_events` constraint still lists `'luma'` for legacy rows. |
| Higgsfield | Scaffolded, deferred permanently | | See `docs/HIGGSFIELD-INTEGRATION.md` |
| Shotstack | Active when `SHOTSTACK_API_KEY` set | Video assembly | Used by prod + legacy Lab. Listings Lab does NOT yet assemble |

Router logic (prod + legacy Lab): movement-first, room-type tiebreaker. See `lib/providers/router.ts`. Listings Lab skips the router — Atlas is the single provider, model per-iteration is user-chosen via the Generate-all modal.

## Frontend

| Tech | Version | Role |
|---|---|---|
| Vite | ^5.4 | Build tool (SWC plugin) |
| React | ^18.3 | UI framework |
| TypeScript | ^5.8 | Type system |
| Tailwind CSS | ^3.4 | Utility-first styling |
| shadcn/ui | (Radix primitives) | Component library |
| React Router DOM | ^6.30 | Client-side routing |
| Lucide React | ^1.8 | Icons |
| Recharts | ^3.8 | Dashboard charts |
| Framer Motion | ^12.38 | Animations |
| TanStack React Query | ^5.83 | Server state / data fetching |
| Sonner | ^1.7 | Toast notifications |
| Zod | ^3.25 | Schema validation |
| react-hook-form | ^7.61 | Form handling |

## Backend

| Tech | Version | Role |
|---|---|---|
| Node.js | >=20 (ESM) | Runtime |
| Vercel Serverless Functions | `@vercel/node ^5.0` | API routes + cron |
| Supabase JS | `@supabase/supabase-js ^2.49` | DB client (service_role for server, anon for client) |
| sharp | ^0.33 | Image processing |

## Database

- **PostgreSQL** via Supabase
- **pgvector** extension — HNSW indexes, cosine distance (`<=>` operator)
- **30 migrations** in `supabase/migrations/` (001–030). Latest: 028 (M.2d — `model_used` on `prompt_lab_recipes` + backfill), 029 (dropped `match_lab_iterations` RPC — M.2b cleanup), 030 (DA.1 — `photos.analysis_json` + `photos.analysis_provider` for Gemini extended analysis).

### Listings Lab tables (Phase 2.8)

| Table | Purpose |
|---|---|
| `prompt_lab_listings` | Top-level container: name, model_name, status, archived, total_cost_cents |
| `prompt_lab_listing_photos` | Uploaded photos + analysis_json + pgvector embedding |
| `prompt_lab_listing_scenes` | Director-planned shots: director_prompt, director_intent, refinement_notes, chat_messages, use_end_frame, archived |
| `prompt_lab_listing_scene_iterations` | Per-model render attempts: director_prompt snapshot, model_used, clip_url, rating, rating_reasons, archived |
| `v_rated_pool` (view, migration 023 extension) | 3-way UNION: legacy Lab iterations + prod scene_ratings + listing iterations |

### Key RPC functions

| Function | Purpose |
|---|---|
| `match_rated_examples` | Unified retrieval: pools Lab iterations + prod scene_ratings (rating >= threshold), rating-weighted cosine distance |
| `match_loser_examples` | Negative signal: pools low-rated (<=2) Lab + prod examples |
| `match_lab_recipes` | Recipe matching by embedding + room_type |
| `recipe_exists_near` | Dedup check: any active recipe within cosine distance threshold |

Legacy: `match_lab_iterations` (unused since unified embeddings shipped).

## Email (planned)

- **Resend** — not yet implemented. Intended for agent notifications on video completion.

## Environment Variables

### Required — API keys

| Variable | Provider |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic (Claude — director brain + photo-analysis fallback) |
| `GEMINI_API_KEY` | Google (Gemini 3 Flash — photo-analysis eyes, DA.1). Fallback to Claude if unset or failing. |
| `OPENAI_API_KEY` | OpenAI (embeddings) |
| `RUNWAY_API_KEY` | Runway Gen-4 |
| `KLING_ACCESS_KEY` | Kling (JWT auth) |
| `KLING_SECRET_KEY` | Kling (JWT auth) |

### Optional — additional providers

| Variable | Provider |
|---|---|
| `ATLASCLOUD_API_KEY` | Atlas Cloud (required for all video generation) |
| `ATLAS_VIDEO_MODEL` | Atlas Cloud default model (default: `kling-v2-6-pro`) |
| `SEEDANCE_4K_RESOLUTION` | Seedance 2.0 · 4K render resolution (default: `"4k"`; override for instant rollback) |
| `SEEDANCE_4K_PRICE_CENTS_PER_SECOND` | Seedance 2.0 · 4K cost in ¢/s (default: `11.2`, live-verified 2026-06-26; reconcile against first Atlas 4K invoice) |
| `SHOTSTACK_API_KEY` | Shotstack production |
| `SHOTSTACK_API_KEY_STAGE` | Shotstack staging (fallback to `SHOTSTACK_API_KEY`) |
| `HIGGSFIELD_API_KEY` | Higgsfield (deferred) |
| `HIGGSFIELD_API_SECRET` | Higgsfield (deferred) |

### Required — Supabase

| Variable | Scope |
|---|---|
| `SUPABASE_URL` | Server-side DB client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB client (admin) |
| `VITE_SUPABASE_URL` | Client-side (Vite env) |
| `VITE_SUPABASE_ANON_KEY` | Client-side (Vite env) |

### Tuning / cost

| Variable | Default | Purpose |
|---|---|---|
| `KLING_CONCURRENCY_LIMIT` | `4` | Max concurrent Kling jobs (Lab + prod) |
| `KLING_CENTS_PER_UNIT` | `0` | Cost estimate per Kling unit |
| `RUNWAY_CENTS_PER_CREDIT` | `1` | Cost estimate per Runway credit |
| `SHOTSTACK_CENTS_PER_MINUTE` | `20` | Shotstack cost per output-minute (rounded up). Ingest plan = 20¢, Create plan = 50¢. **Replaces deprecated `SHOTSTACK_CENTS_PER_RENDER=10`** (shim still honored for backward compat). Changed 2026-04-20 (CI.3). |
| `SHOTSTACK_ENV` | `stage` | `stage` or `production` |
| `GENERATION_CONCURRENCY` | `4` | Max parallel generation submits in pipeline |
| `QC_AUTO_APPROVE_ALL` | `false` | Skip QC approval (dead code path, but env checked) |
| `HIGGSFIELD_CENTS_PER_CREDIT` | `1` | Cost estimate (deferred provider) |

## Key Directories

```
api/                    Vercel serverless functions
  admin/prompt-lab/     Lab endpoints (analyze, refine, render, rate, promote, etc.)
  cron/                 poll-scenes.ts (prod), poll-lab-renders.ts (Lab)
  pipeline/             Production pipeline entrypoint
  scenes/[id]/          Scene actions (resubmit, rate, approve, skip, retry)
lib/                    Shared server-side code
  providers/            Atlas, Kling (native), Runway, Higgsfield, Shotstack, router, errors, dispatch
  prompts/              System prompts (director, photo-analysis, style-guide, resolve)
  pipeline.ts           Production orchestrator
  prompt-lab.ts         Lab core helpers
  embeddings.ts         OpenAI embedding wrapper (embedText now returns usage.costCents)
  sanitize-prompt.ts    Strip LOCKED-OFF CAMERA stability prefix variants (NEW 2026-04-20)
  refine-prompt.ts      Sonnet 4.6 prompt rewrite incorporating refinement_notes (NEW 2026-04-20)
  db.ts                 DB helpers (recordCostEvent, embedScene, computeClaudeCost, etc.)
src/                    Frontend (Vite + React)
  pages/dashboard/      Dashboard pages (PromptLab, Recipes, Proposals, etc.)
  components/           Shared UI components
supabase/migrations/    SQL migrations (001–017)
scripts/                One-shot scripts (backfills, tests)
docs/                   Project documentation
```
