# Test-render log — 2026-04-21

Last updated: 2026-04-21

See also:
- [../specs/2026-04-21-daily-engagement-design.md](../specs/2026-04-21-daily-engagement-design.md) — why this log exists

**Rule:** every test render initiated by any Round 1 window (B, C, D) appends one row below. No off-log renders. Oliver reads this file to confirm nothing is running he doesn't know about.

## Columns

| Field | Meaning |
|---|---|
| timestamp | Local time the render started |
| window | B / C / D |
| scene_id or photo_id | What was rendered |
| prompt_before | Director prompt on previous run (or N/A for first render) |
| prompt_after | Director prompt on this run |
| SKU | Model actually invoked |
| cost_cents | Recorded cost for this render |
| clip_url or task_id | Output reference |
| observation | One-sentence read on whether this render argues for or against the current hypothesis |

## Ledger

| timestamp | window | scene/photo | prompt_before | prompt_after | SKU | cost | clip/task | observation |
|---|---|---|---|---|---|---|---|---|
| 2026-04-21 19:57 UTC | B (Round 2) | kittiwake-1406-940 aerial (photo `1776442630469-38o36y.jpg`) | Legacy 5★: "smooth cinematic drone flying forward at rooftop height toward the screened lanai and concrete seawall" (kling, push_in) — also a 2★ iter on same photo with `drone_pull_back` that hallucinated a fake neighborhood | DA.1: "smooth cinematic drone flying forward at low altitude toward the private boat dock and screened lanai" (drone_push_in, same motion as Legacy 5★) | kling-v2-6-pro | 60 | task `8eaf214ccaa942ca990852d88fc28963` · clip `https://v16-kling-fdl.klingai.com/bs2/upload-ylab-stunt-sgp/muse/817540344522489950/VIDEO/20260422/dbe9f959c7bb69fe8e3b27963ee834d7-1ade644b-3e8c-459a-9b31-9c919d2758d7.mp4?cacheKey=ChtzZWN1cml0eS5rbGluZy5tZXRhX2VuY3J5cHQSsAFwAqKdQRDAOgma34mOBtPgoGTnFUbiVWZhGmk4Dr9qe3JiKmwWf9jamd8iyB4yPPU7oS3WnD22j0jqBPBfJf5Kvd6KUvO5ForSB4ZNbPL1awhEl0Sxx1ndvchIXFhcEEgOxt7G793JLG3c48NuJELsqp4mFzV1RBX5xarpkLzB9dBgkrw69WwJH5cMO_kg8X7ZjJNA3AlyVIRzjn-PGrBwEjOAlsa-rNiMlvVg96QWUxoSMiIwzDkRLkXJDo0Gm30rVg5KIiBBjX-tu4RxI6me8QHTj2eu-EtUnzj379meFpLxTy3wiCgFMAE&x-kcdn-pid=112781&ksSecret=f32c276bc8e025062837b5c6659b38c9&ksTime=6a0f6387` | motion_headroom all-true → DA.1 ban mechanism didn't engage on this photo; director still converged on the Legacy-5★-approved motion. Evidence of NON-DEGRADATION, not active ban. |
| 2026-04-21 19:58 UTC | B (Round 2) | kittiwake-1406-213 master_bedroom (photo `1776442643204-ph1paj.jpg`) | Legacy 5★ and two 4★-`hallucinated architecture` iterations ALL picked `push_in` with near-identical prompts (5/5 iterations identical motion) | DA.1 picked `parallax` — "smooth cinematic parallax glide past the mirrored nightstand toward the tufted grey headboard" | kling-v2-6-pro | 60 | task `51d501f8251b4836814d7e847c483d48` · clip `https://v16-kling-fdl.klingai.com/bs2/upload-ylab-stunt-sgp/muse/817540344522489950/VIDEO/20260422/e698746f501011f548607d1e63cb1358-63d03314-1a96-4485-b1f5-891a648230b1.mp4?cacheKey=ChtzZWN1cml0eS5rbGluZy5tZXRhX2VuY3J5cHQSsAGsFzSfTYs8RctpWDQtAPoSgktxD0wP9H7kkm1jNlhPzIOn45wT_NPKzjfPWbm1AF6Nt1iJqd3ueeDcVnFLdo9Xh1dbYvANHPIMS24if6qrwITtjXqTBfzLAtVgswItaQ_B06oZj8N6bFadF4_1snNkoZVs264OKfXsqKvNNnbtUVPxZ1LKjvbHKuo-zjhddMbvtx6fYtL0Rsf0t7B_1_ofDUHnKVf5HZX_mYWsMWBNJBoSyfxirU_pcpSwYh-JFVmDEt6gIiAz1z8YSpT331uHEhCOMH9F7sSzj8P_dyGOWr-q9F-ISSgFMAE&x-kcdn-pid=112781&ksSecret=4be500e6c7a71a04d9217a537828c5b7&ksTime=6a0f6420` | Gemini flagged `orbit=F drone_push_in=F` and suggested parallax. DA.1 **actively reshaped** motion choice away from Legacy's push_in (which produced hallucinated_architecture 3/5 times) toward parallax. Oliver rating needed to confirm hallucination actually gone. |

## Budget reminder

Round 1 combined render cap: **$20**. Each window tracks its own running total in the session log. Coordinator checks this file at consolidation time and flags any breach.
