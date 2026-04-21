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
| _(first row goes here)_ | | | | | | | | |

## Budget reminder

Round 1 combined render cap: **$20**. Each window tracks its own running total in the session log. Coordinator checks this file at consolidation time and flags any breach.
| 2026-04-21 20:16:22 | D | kitchen × push_in (scene=d694461b) | N/A | Slow cinematic push into the kitchen island, following the granite countertop toward the window light. | kling-v2-native | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:24 | D | kitchen × push_in (scene=d694461b) | N/A | Slow cinematic push into the kitchen island, following the granite countertop toward the window light. | kling-v2-6-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:25 | D | kitchen × push_in (scene=d694461b) | N/A | LOCKED-OFF CAMERA on a gimbal-stabilized Steadicam rig. Smooth motorized dolly motion only. Zero camera shake, zero handheld jitter, tripod- | kling-v3-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:25 | D | kitchen × push_in (scene=d694461b) | N/A | Slow cinematic push into the kitchen island, following the granite countertop toward the window light. | kling-o3-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:26 | D | living_room × push_in (scene=fe6f3289) | N/A | Smooth push-in toward the fireplace feature wall, past the sofa, revealing the coffered ceiling. | kling-v2-native | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:27 | D | living_room × push_in (scene=fe6f3289) | N/A | Smooth push-in toward the fireplace feature wall, past the sofa, revealing the coffered ceiling. | kling-v2-6-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:27 | D | living_room × push_in (scene=fe6f3289) | N/A | LOCKED-OFF CAMERA on a gimbal-stabilized Steadicam rig. Smooth motorized dolly motion only. Zero camera shake, zero handheld jitter, tripod- | kling-v3-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:28 | D | living_room × push_in (scene=fe6f3289) | N/A | Smooth push-in toward the fireplace feature wall, past the sofa, revealing the coffered ceiling. | kling-v2-master | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:28 | D | master_bedroom × push_in (scene=20e1fec1) | N/A | Slow cinematic push toward the upholstered headboard, past the bench, centering on the bedroom window. | kling-v2-native | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:29 | D | master_bedroom × push_in (scene=20e1fec1) | N/A | Slow cinematic push toward the upholstered headboard, past the bench, centering on the bedroom window. | kling-v2-6-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:29 | D | master_bedroom × push_in (scene=20e1fec1) | N/A | LOCKED-OFF CAMERA on a gimbal-stabilized Steadicam rig. Smooth motorized dolly motion only. Zero camera shake, zero handheld jitter, tripod- | kling-v3-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:30 | D | master_bedroom × push_in (scene=20e1fec1) | N/A | Slow cinematic push toward the upholstered headboard, past the bench, centering on the bedroom window. | kling-v2-master | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:30 | D | exterior_front × push_in (scene=ca9f264b) | N/A | Smooth push toward the front entry, past the landscaped walkway, revealing the double-height facade. | kling-v2-native | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:31 | D | exterior_front × push_in (scene=ca9f264b) | N/A | Smooth push toward the front entry, past the landscaped walkway, revealing the double-height facade. | kling-v2-6-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:32 | D | exterior_front × push_in (scene=ca9f264b) | N/A | LOCKED-OFF CAMERA on a gimbal-stabilized Steadicam rig. Smooth motorized dolly motion only. Zero camera shake, zero handheld jitter, tripod- | kling-v3-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:32 | D | exterior_front × push_in (scene=ca9f264b) | N/A | Smooth push toward the front entry, past the landscaped walkway, revealing the double-height facade. | kling-v2-master | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:33 | D | exterior_front × push_in (scene=ca9f264b) | N/A | Smooth push toward the front entry, past the landscaped walkway, revealing the double-height facade. | kling-o3-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:33 | D | aerial × drone_push_in (scene=2274aead) | N/A | Aerial drone push forward over the driveway, descending gently toward the roofline, revealing the property layout. | kling-v2-native | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:34 | D | aerial × drone_push_in (scene=2274aead) | N/A | Aerial drone push forward over the driveway, descending gently toward the roofline, revealing the property layout. | kling-v2-6-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:35 | D | aerial × drone_push_in (scene=2274aead) | N/A | LOCKED-OFF CAMERA on a gimbal-stabilized Steadicam rig. Smooth motorized dolly motion only. Zero camera shake, zero handheld jitter, tripod- | kling-v3-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:35 | D | aerial × drone_push_in (scene=2274aead) | N/A | Aerial drone push forward over the driveway, descending gently toward the roofline, revealing the property layout. | kling-o3-pro | 0 | submitting | router-grid seed render; pre-submit log row |
| 2026-04-21 20:16:35 | D | aerial × drone_push_in (scene=2274aead) | N/A | Aerial drone push forward over the driveway, descending gently toward the roofline, revealing the property layout. | runway | 0 | submitting | router-grid seed render; pre-submit log row |
