# Finalize "Create Listing" — end-to-end plan

Last updated: 2026-06-01
Branch: `claude/listing-elevate-dev-plan-ZvAY5`

See also:
- [../HANDOFF.md](../HANDOFF.md) — right-now state
- [../state/PROJECT-STATE.md](../state/PROJECT-STATE.md) — authoritative state
- `lib/providers/atlas.ts`, `lib/providers/creatomate.ts`, `lib/voiceover/*`, `lib/assembly/music.ts`, `lib/pipeline.ts`

## Goal

When a user presses **Create Listing**, the pipeline produces a finished, client-ready video — clips + music + voiceover + branded overlays — with **zero human-in-the-loop**. And inside the **owner lab** (`/dashboard/development/lab`), the owner can take a listing from upload → final assembled video in one sitting.

This plan was built from a five-track investigation (2026-06-01) of the actual code + external provider capabilities. The headline: **most of the plumbing already exists** — the work is closing specific gaps, not building from scratch.

---

## Current state (ground truth, verified in code)

| Subsystem | State | Gap to "finalized" |
|---|---|---|
| **Seedance** | `seedance-pro-pushin` SKU → slug `bytedance/seedance-2.0/image-to-video`, requests `resolution:"1080p"`, source pre-cropped to 1920×1080 16:9 (`source-aspect.ts`). 1080p is the model's native ceiling. | To exceed 1080p, switch to Atlas's **upscaled** variant → **2K (2048×1080)**. One slug + one resolution-enum change. |
| **Creatomate (customer pipeline)** | `buildCreatomateTimeline` / `assembleFromTemplate` already sequence clips + **music track (track 5, 18% vol, fade in/out)** + text overlays + logo. Voiceover wired via template `Voice-Over.source` key. Works. | Music URLs are placeholders; voiceover not auto-triggered (see below). Otherwise functional. |
| **Creatomate (owner lab)** | `DirectorModal` → `assembleConcat` → `buildCreatomateConcatScript` = **clips only, no audio/overlays**. Test explicitly asserts "no music." | Lab assembly produces a silent concat. Needs music + voiceover + overlays to match the customer deliverable. |
| **ElevenLabs voiceover** | Fully wired: `eleven_multilingual_v2`, 4 voices, Sonnet script-gen, `voiceovers` bucket, migration 061, preview endpoint, Upload-form add-on UI. | (a) Model is v2, not v3. (b) `add_voiceover` flag is **set but never read by the pipeline** — narration only generates if the user manually clicks "Generate" in the form. (c) No audio tags, dated voices. |
| **Music** | Backend complete: `music_tracks` table, `selectMusicTrackForProperty()` (operator-pin → mood auto-pick → fallback), pipeline wiring → `Audio-Music.source`. | All `file_url`s are **SoundHelix smoke-test placeholders** ("REPLACE before launch"). No customer/owner-facing music controls. |

**Net:** the customer pipeline is ~90% there (placeholder music + voiceover auto-trigger are the real blockers). The owner-lab assembly is the biggest functional gap (silent concat).

---

## Work items

### WI-1 — Seedance: maximum resolution & quality (2K)

**Change:** move `seedance-pro-pushin` from 1080p native to Atlas's **Seedance 2.0 Upscaled** variant at **2K (2048×1080)**, the highest the Seedance family exposes (no Seedance variant does 4K; only Kling 3.0 / Veo 3.1 do, out of scope).

Files: `lib/providers/atlas.ts`
1. Set slug default → `bytedance/seedance-2.0/image-to-video-upscaled` (env override `SEEDANCE_ATLAS_SLUG` preserved).
2. Widen `AtlasModelDescriptor.resolution` + `AtlasSubmitBody.resolution` enum to include `"2k"`; set descriptor `resolution:"2k"`, `supportedResolutions:["2k","1080p","720p","480p"]`.
3. Atlas upscaled endpoint uses `ratio` (not `aspect_ratio`) and `resolution:"2k"` — confirm `buildAtlasRequestBody` field names against the Atlas upscaled schema; add a request-body branch if the upscaled model differs from the standard one.
4. Keep `source-aspect.ts` forcing 16:9 input (do NOT trust adaptive inference — confirmed Seedance aspect-ratio bug). Optionally bump `TARGET_W/H` to 2048×1080 so the input matches output.
5. Update `priceCentsPerSecond` (~12–13¢/s at Atlas 2K vs current 28¢ placeholder — **verify against first invoice**).

Tests: extend `atlas` resolution tests to assert `"2k"` forwarded for seedance + slug/ratio mapping. Verify one real 2K render lands and ffprobe shows 2048×1080.

**Cost note:** Atlas 2K upscaled ≈ $0.12–0.13/s — roughly *cheaper* than the current unverified 28¢/s placeholder, while higher resolution. Net likely a quality win at neutral-or-lower cost. Confirm on invoice.

### WI-2 — Owner-lab assembly: match the customer deliverable

The owner-lab `DirectorModal` "Generate" must produce a video with music + voiceover + overlays, not a silent concat — so "create a listing instantly start to finish" actually yields a finished video.

**Recommended approach:** route lab assembly through the same `buildCreatomateTimeline` (or `assembleFromTemplate`) path the customer pipeline uses, instead of `assembleConcat`.

Files: `api/admin/prompt-lab/assemble-listing.ts`, `api/admin/prompt-lab/assemble.ts`, `lib/providers/creatomate.ts`, `src/components/lab/DirectorModal.tsx`
1. Add a music-bearing concat builder (or call `buildCreatomateTimeline` with overlays optional) — emit `type:"audio"` music element on track 5 and a voiceover element on track 6 (`volume:"100%"`), mirroring `creatomate.ts:371–389`.
2. Thread a music URL (from `selectMusicTrackForProperty` or an explicit lab override) + optional voiceover URL into the assemble endpoints.
3. Re-enable the `DirectorModal` Audio tab (currently "coming soon", line ~901): genre/mood picker that maps to a music track; optional voiceover toggle.
4. Update `creatomate-concat.test.ts` expectations (it currently asserts no audio).

### WI-3 — ElevenLabs v3 + auto-trigger + more human

**3a. Upgrade to v3.** `eleven_v3` is GA on the public API (since ~Feb 2026), the most human/expressive model.
Files: `lib/voiceover/generate-audio.ts`, `lib/voiceover/generate-script.ts`, `lib/voiceover/voices.ts`
- `MODEL_ID` → `eleven_v3`. Add `style: 0.30` + `use_speaker_boost: true` to `voice_settings` (keep `stability: 0.5`, `similarity_boost: 0.75` — "Natural" zone). Set `output_format: "mp3_44100_128"`.
- Script-gen prompt: emit warm real-estate **audio tags** inline (`[warmly]`, `[pause]`, `[softly]`, `[enthusiastically]`) — and only those (no dramatic/character tags). Keep scripts < 3,000 chars (v3 hard limit; our 60s budget ≈ 900 chars, fine).
- Refresh the voice catalog toward higher-quality narration voices (e.g. George `JBFqnCBsd6RMkjVDRZzb` warm/authoritative; verify live via `GET /v1/voices` since legacy premade voices sunset 2026-12-31). Keep a fallback to `eleven_multilingual_v2` for the low-latency preview path if v3 latency hurts UX.
- v3 has no WebSocket; non-streaming `POST /v1/text-to-speech/{voice_id}` is correct for our offline pipeline (already what we do).

**3b. Auto-trigger from the order.** The real bug: `add_voiceover=true` never causes the pipeline to generate narration. In `runPipeline`/assembly, if `add_voiceover && !voiceover_url`, generate script (from MLS/Compass description already on the property) → TTS → store `voiceover_url` before assembly. Then ensure the Creatomate code-generated timeline (not just the template path) carries a voiceover audio element (track 6) so narration plays regardless of which assembly path runs.

Files: `lib/pipeline.ts` (assembly step), `lib/voiceover/*`, `lib/providers/creatomate.ts` (add voiceover track to `buildCreatomateTimeline`).

### WI-4 — Music: pick a source & replace placeholders

The `music_tracks` table + selection + pipeline wiring exist; only real audio is missing. **Recommendation: Option C — ElevenLabs Music API** (self-serve, GA since Aug 2025, commercial-clear for client deliverables, ~$0.37 per 45s, same vendor we already bill for TTS). See the 3-sentence verdict in HANDOFF / chat.

Two viable implementations (decide with Oliver):
- **C-pure:** generate a unique track per video at assembly time (`POST /v1/music`, 30–60s, prompt by package mood) → upload to storage → use as `music.url`. Max uniqueness, ~$0.37/video, adds ~10–30s async latency.
- **C-pooled (cost-saver, recommended default):** pre-generate ~5–10 tracks per mood via ElevenLabs Music **once**, store in `music_tracks` (replacing SoundHelix rows), keep the existing `selectMusicTrackForProperty` logic untouched. Near-zero per-video cost, no added latency, same legal clarity. Refresh the pool periodically.

If we ever want to avoid vendor concentration, the Option-B fallback is **Loudly** (self-serve API, explicit Pro-tier sublicense-to-clients, perpetual per-track license — confirm survives subscription lapse).

Option A (owner uploads + genre tagging) is the lowest ongoing cost and is a natural *complement* — the C-pooled approach can reuse an Option-A-style admin upload/tag UI to manage the pool.

Files: `lib/assembly/music.ts`, `supabase/migrations/NNN_music_real_tracks.sql` (replace placeholder rows), optional new `lib/providers/elevenlabs-music.ts`, optional admin music-manager UI + genre tagging.

---

## Sequencing

1. **WI-3b (voiceover auto-trigger)** + **WI-4 (real music)** — these are the two things blocking the *customer* "Create Listing" from shipping a complete video. Highest leverage.
2. **WI-3a (v3 upgrade)** — quality bump, low risk, isolated to `lib/voiceover/*`.
3. **WI-1 (Seedance 2K)** — isolated to `lib/providers/atlas.ts`; verify cost on invoice.
4. **WI-2 (owner-lab assembly)** — larger UI + assembly change; do once the audio building blocks (WI-3, WI-4) exist so the lab can reuse them.

Each WI: superpowers loop — write tests (TDD) → implement → `pnpm run build` + headless mount check (per the blank-screen lesson) → `/code-review` → cascade `feat/* → dev → staging → main` via PR.

## Decisions (locked 2026-06-01)

- **Music:** **Option C-pooled** — pre-generate a per-mood ElevenLabs Music pool into `music_tracks`, reuse via existing selection logic. **C-pure (unique track per video) is a planned future enhancement**, not built now.
- **Build order:** plan order below — WI-3b + WI-4 first (customer-path blockers), then WI-3a (v3), WI-1 (Seedance 2K), WI-2 (owner-lab assembly).
- **Seedance 2K:** proceed to the upscaled 2K variant; verify per-second cost against the first Atlas invoice.

## Cost snapshot (per finished video, est.)

- Seedance 2K: ~$0.12–0.13/s × clip-seconds (was 28¢/s placeholder — likely *lower*).
- ElevenLabs v3 voiceover: ~900 chars ≈ <1k credits ≈ a few cents.
- Music (C-pooled): ~$0 amortized; (C-pure): ~$0.37/video.
- Creatomate assembly: per existing `CREATOMATE_CENTS_PER_MINUTE` (76¢/min).
</content>
</invoke>
