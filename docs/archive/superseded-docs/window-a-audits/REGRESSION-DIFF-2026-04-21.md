# DA.1 regression-diff — Legacy Prompt Lab → post-DA.1 pipeline

Date: 2026-04-21
Window: B (Round 2)
Branch: `session/da1-land-2026-04-21`
Total spend: **$1.22** (well under the $5 cap) — 2 Atlas renders × 60¢ + ~1¢ Gemini + ~1¢ Sonnet
Related: [`test-render-log-2026-04-21.md`](./test-render-log-2026-04-21.md), [`docs/sessions/2026-04-21-window-B-round-2.md`](../sessions/2026-04-21-window-B-round-2.md)

---

## Verdict — **NECESSARY BUT NOT SUFFICIENT**

DA.1 is wired correctly end-to-end and visibly reshapes the director's motion choice on a known-bad anchor: on the Kittiwake `1406-213` master bedroom, where every one of the 5 Legacy iterations picked `push_in` and 3/5 produced `hallucinated architecture`, the post-DA.1 pipeline picked **`parallax`** instead — directly because Gemini's `motion_headroom` analysis pointed the director at the lateral glide rather than the forward push. That's the exact mechanism DA.1 was built to create, and it fired on the exact pattern it was built to fix. What we do *not* yet have is Oliver-side rating of the DA.1 clip to confirm the hallucination is actually gone — we've shown the motion choice changed in a defensible direction, but "closed" requires eyeballing whether the parallax clip is clean. On the Kittiwake `1406-940` aerial anchor, motion_headroom came back all-true (Gemini's quirk — non-overhead aerials get `top_down=true` because the camera *could* rise further), so DA.1's ban mechanism was not load-bearing there; the DA.1 director still converged on the Legacy-5★ motion (`drone_push_in`) with an equivalent prompt, giving us evidence of non-degradation but not active-ban behavior. **Ask:** rate the two DA.1 clips below; if both clean, this is `CLOSED`.

---

## Anchor 1 — Kittiwake Dr 1406-213 master_bedroom

Photo: `https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-photos/prompt-lab/29a51ea1-0339-47e3-9666-dd8985c00b0d/1776442643204-ph1paj.jpg`
Legacy session: `215b9e04-e258-46a0-8087-7fe7963636b5`

### Why this anchor matters

All 5 Legacy iterations on this photo used `push_in`. Ratings: iter 1 **4★ `hallucinated architecture`**, iter 3 **4★ `clean motion, cinematic, hallucinated architecture`**, iter 4 **2★**, iter 5 **5★ `perfect, stayed in room, clean motion`**. The hallucination pattern was present in 3/5 iterations. The Legacy pipeline had no mechanism to steer away from `push_in` even when the renderer kept failing.

### Side-by-side

| | Legacy (iter 5, 5★) | DA.1 (this run) |
|---|---|---|
| **Camera movement** | `push_in` | **`parallax`** ← DA.1 picked different motion |
| **Prompt** | "slow cinematic straight push curving right toward the tufted wingback headboard and geometric star pendants" | "smooth cinematic parallax glide past the mirrored nightstand toward the tufted grey headboard" |
| **SKU** | kling (native) | kling-v2-6-pro (Atlas) |
| **Gemini analysis** | N/A (Claude-only analyzer era) | `camera_height=eye_level tilt=level coverage=wide_establishing` |
| **motion_headroom** | N/A | `push_in=T pull_out=T orbit=F parallax=T drone_push_in=F top_down=T` |
| **Rationale Gemini gave** | N/A | orbit=F: "bed is positioned against the wall, preventing full orbital rotation". drone_push_in=F: "interior bedroom, not suitable for drone flight". parallax=T: "moving laterally would create depth between foreground nightstand and background hallway". |
| **Gemini suggested_motion** | N/A | `parallax` — "Gliding past the mirrored nightstand creates a dynamic sense of depth toward the bed." |
| **DA.3 validator** | N/A | PASS (parallax matches motion_headroom.parallax=true) |
| **Clip** | `https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/prompt-lab/215b9e04-e258-46a0-8087-7fe7963636b5/935a4737-d5e4-41df-81eb-f93aa3732e2b.mp4` | `https://v16-kling-fdl.klingai.com/bs2/upload-ylab-stunt-sgp/muse/817540344522489950/VIDEO/20260422/e698746f501011f548607d1e63cb1358-63d03314-1a96-4485-b1f5-891a648230b1.mp4?cacheKey=ChtzZWN1cml0eS5rbGluZy5tZXRhX2VuY3J5cHQSsAGsFzSfTYs8RctpWDQtAPoSgktxD0wP9H7kkm1jNlhPzIOn45wT_NPKzjfPWbm1AF6Nt1iJqd3ueeDcVnFLdo9Xh1dbYvANHPIMS24if6qrwITtjXqTBfzLAtVgswItaQ_B06oZj8N6bFadF4_1snNkoZVs264OKfXsqKvNNnbtUVPxZ1LKjvbHKuo-zjhddMbvtx6fYtL0Rsf0t7B_1_ofDUHnKVf5HZX_mYWsMWBNJBoSyfxirU_pcpSwYh-JFVmDEt6gIiAz1z8YSpT331uHEhCOMH9F7sSzj8P_dyGOWr-q9F-ISSgFMAE&x-kcdn-pid=112781&ksSecret=4be500e6c7a71a04d9217a537828c5b7&ksTime=6a0f6420` |
| **Cost** | (Legacy; unknown in logs) | $0.60 |
| **Oliver rating** | 5★ (iter 5); also 4★ hallucinated_architecture (iter 3) | **NEEDED** |

### Observable difference

- **DA.1 changed the motion choice** from `push_in` (Legacy's sticky pick that hallucinated 60% of the time) to `parallax` (gliding past the foreground nightstand). This is not a prompt-wording difference, it's a different motion entirely.
- The parallax choice is supported by Gemini's rationale: the foreground has a clear depth object (mirrored nightstand) and the room has lateral space. Parallax is less likely to require the renderer to invent forward-depth geometry that caused the `hallucinated_architecture` tag.
- `motion_headroom.orbit=false` and `motion_headroom.drone_push_in=false` both correctly identify this as a tight interior shot.
- DA.3 validator didn't need to fire because the director picked an in-headroom motion on the first try — evidence DA.2 system-prompt changes are doing their job at planning time.

## Anchor 2 — Kittiwake Dr 1406-940 aerial

Photo: `https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-photos/prompt-lab/29a51ea1-0339-47e3-9666-dd8985c00b0d/1776442630469-38o36y.jpg`
Legacy session: `8601b93c-361d-40de-9616-24e3b88a6a00`

### Why this anchor matters

Iter 1 (2★, runway, `drone_pull_back`): `hallucinated architecture, warped geometry`. Iter 2 (4★, runway, `drone_push_in`): `clean motion, warped geometry` — boats were warped. Iter 3 (**5★**, kling, `drone_push_in`): `clean motion, cinematic, perfect`. The 5★ came from switching provider from runway → kling, not from changing motion. Original regression was that the FIRST iteration misrouted to `drone_pull_back` (requires inventing rearward neighborhood).

### Side-by-side

| | Legacy (iter 3, 5★) | DA.1 (this run) |
|---|---|---|
| **Camera movement** | `drone_push_in` | `drone_push_in` (same) |
| **Prompt** | "smooth cinematic drone flying forward at rooftop height toward the screened lanai and concrete seawall" | "smooth cinematic drone flying forward at low altitude toward the private boat dock and screened lanai" |
| **SKU** | kling (native) | kling-v2-6-pro (Atlas) |
| **motion_headroom** | N/A | `push_in=T pull_out=T orbit=T parallax=T drone_push_in=T top_down=T` — ALL TRUE |
| **Gemini quirk noted** | — | Non-overhead aerial still gets `top_down=true` because the camera *could* rise further to a true overhead. Same pattern observed in Round 1 smoke test. Non-blocking but worth tuning. |
| **DA.3 validator** | N/A | PASS (all motions in-headroom) |
| **Clip** | `https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/prompt-lab/8601b93c-361d-40de-9616-24e3b88a6a00/f76a563d-b1b3-4375-8b89-ad4ffc4821b2.mp4` | `https://v16-kling-fdl.klingai.com/bs2/upload-ylab-stunt-sgp/muse/817540344522489950/VIDEO/20260422/dbe9f959c7bb69fe8e3b27963ee834d7-1ade644b-3e8c-459a-9b31-9c919d2758d7.mp4?cacheKey=ChtzZWN1cml0eS5rbGluZy5tZXRhX2VuY3J5cHQSsAFwAqKdQRDAOgma34mOBtPgoGTnFUbiVWZhGmk4Dr9qe3JiKmwWf9jamd8iyB4yPPU7oS3WnD22j0jqBPBfJf5Kvd6KUvO5ForSB4ZNbPL1awhEl0Sxx1ndvchIXFhcEEgOxt7G793JLG3c48NuJELsqp4mFzV1RBX5xarpkLzB9dBgkrw69WwJH5cMO_kg8X7ZjJNA3AlyVIRzjn-PGrBwEjOAlsa-rNiMlvVg96QWUxoSMiIwzDkRLkXJDo0Gm30rVg5KIiBBjX-tu4RxI6me8QHTj2eu-EtUnzj379meFpLxTy3wiCgFMAE&x-kcdn-pid=112781&ksSecret=f32c276bc8e025062837b5c6659b38c9&ksTime=6a0f6387` |
| **Cost** | (Legacy; unknown) | $0.60 |
| **Oliver rating** | 5★ (iter 3) | **NEEDED** |

### Observable difference

- Equivalent motion choice. Prompts are nearly identical in structure (drone forward at altitude toward specific feature). Both name specific features; DA.1 emphasizes the boat dock whereas Legacy emphasized the seawall — both valid reads of the photo.
- Since `motion_headroom` was all-true, this case didn't test DA.1's ban mechanism — it tested whether DA.1 *degrades* the pipeline on a known-good case. Evidence: it doesn't.
- Useful negative finding: the `top_down=true` on an aerial is Gemini over-interpreting the system prompt's "could rise further" wording. Not blocking landing; worth tightening in a future analyzer prompt refinement.

## What this proves / doesn't

### Proves
- DA.1 analyzer → DA.2 director → DA.3 validator chain runs end-to-end on real photos pulled from Supabase Storage.
- Gemini's `motion_headroom` meaningfully differs across photo types (interior bedroom correctly gets `orbit=F drone_push_in=F`; aerial gets all-true).
- The DA.2 director prompt changes cause Sonnet to pick a DIFFERENT motion on the master_bedroom anchor — specifically, away from the motion Legacy picked 5/5 times that hallucinated 3/5 times.
- DA.3 validator isn't blocking legitimate choices (both renders PASS without override).
- No pipeline regression on a known-good aerial case.

### Doesn't prove (yet)
- Whether the rendered DA.1 parallax clip for the master_bedroom actually LOOKS clean (no architecture hallucination). Oliver must rate.
- Whether motion_headroom false-bans would fire correctly in production director output (not stress-tested here because DA.1 didn't need to override — the director picked in-headroom first try).
- Whether every regression anchor has a post-DA.1 fix. Only 2 scenes tested.

### Residual problems to watch

1. **Gemini `top_down=true` on non-overhead aerials** — reproduced from Round 1. Either tighten the analyzer system prompt or treat `top_down` as always-false when `camera_height=aerial` in `mapCameraMovementToHeadroomKey`. Non-blocking. (Window B carry-forward.)
2. **`mapCameraMovementToHeadroomKey('drone_push_in')` only checks `drone_push_in`** — doesn't also check `push_in`, which the director system prompt says should be conjointly true. Edge case: photo with `push_in=false, drone_push_in=true` could get drone. Fix in a follow-up (flagged in Round 1).
3. **Zero Lab→prod promotions ever happened** (per M.1 audit). DA.1 doesn't fix this. Promotion flow needs separate attention before Phase B rating session lands.

## Spend ledger

| Item | Cost |
|---|---|
| Gemini 3 Flash × 2 photos | 0.50¢ |
| Sonnet 4.6 director × 2 calls | ~0.8¢ (estimated from observed token counts) |
| Atlas kling-v2-6-pro × 2 renders × 5s | $1.20 |
| **Total** | **~$1.22** |

Budget remaining: $3.78. No further renders planned this round.
