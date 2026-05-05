# Director-Prompt Trace — listing dd552c89-98fd-4b6d-816c-1111323a208a

Last updated: 2026-04-20

See also:
- [../audits/ML-AUDIT-2026-04-20.md](../audits/ML-AUDIT-2026-04-20.md) — Phase M.1 verdict based on this trace
- [director-trace-6f508e16-096c-4a70-83cb-17b769838d61.md](./director-trace-6f508e16-096c-4a70-83cb-17b769838d61.md) — paired property trace

Generated: 2026-04-20T17:15:17.113Z

## Audit checklist

- Photos total: **10**
- Photos with embedding: **10** ✓
- Recipe matches: **5**
- Past-winner exemplars: **5**
- Past-loser exemplars: **3**
- Pool sizes: legacy Lab iters=189, prod scene_ratings=7, listing iters=15
- DIRECTOR_SYSTEM length: 22568 chars
- Director user prompt length: 19212 chars

## Notes


## Full director user message

```
Plan the shot list for this property. Apply the room-type quotas from the system prompt. Target 10-16 scenes and 30-60 seconds total duration.

Available room counts: exterior_front=1, exterior_back=1, aerial=3, kitchen=1, living_room=1, pool=2, deck=1

Photos:
  ID: 0e89700c-6c3f-4705-9ccd-82c0ba3ba97e
    file: photo_0
    room: exterior_front
    aesthetic: 8.5
    depth: high
    key_features: "white stucco facade with dark-trimmed bracketed hip roofline and terracotta barrel tiles", "tall central tower element with dark wood double French entry doors and arched transom window", "three-car white panel garage door spanning the right wing", "paver driveway in a herringbone pattern leading from foreground right to garage", "manicured green lawn foreground with tropical landscaping beds flanking the entry", "house number 519 with black wall sconces framing the garage"
    composition: Camera is positioned at street level center-right, facing the facade in a slight three-quarter angle. Foreground: lush green lawn on the left and paver driveway diagonal on the right. Midground: full facade with entry tower, garage wing, and tropical plantings. Background: clear blue sky with scattered clouds. The paver driveway acts as a strong diagonal leading line pulling from lower-right toward the entry door. → suggested_motion: push_in (push forward along the paver driveway diagonal centering on the French entry door tower)

  ID: b930c611-086d-4c72-916e-839b45103cdb
    file: photo_1
    room: exterior_back
    aesthetic: 7.8
    depth: high
    key_features: "tall royal palm tree anchoring the mid-yard with bulging bottle-shaped trunk", "concrete dock with white pilings and a wooden step-down platform at the canal edge", "boat lift with white frame and a docked motorboat visible midground", "paver walkway running along the side of a dark screen enclosure wall", "wide canal with mangrove treeline on the opposite bank and neighboring waterfront homes beyond", "manicured green lawn strip between the paver path and the seawall"
    composition: Camera is positioned at the rear corner of the house at ground level, looking diagonally toward the canal. Foreground left: dark screen enclosure wall and paver walkway create a strong diagonal leading line. Midground: lush lawn, royal palm, and dock with pilings. Background: open canal, mangroves, and neighboring properties under a vivid blue sky. Leading lines from the walkway and seawall converge toward the dock, guiding the eye naturally to the waterfront. → suggested_motion: parallax (lateral glide past the foreground royal palm reveals the full dock and canal waterfront beyond)

  ID: 78176e42-bb5b-427a-b87e-e347867b0bc6
    file: photo_2
    room: aerial
    aesthetic: 7.5
    depth: high
    key_features: "canal-front concrete seawall running the full width of the frame with two boat lifts and docked white center-console boats", "hip-roof stucco home with terracotta barrel tile and large white-frame screen enclosure over pool", "manicured green lawn sloping from the rear facade to the seawall edge", "palm-tree-lined residential waterway stretching into the neighborhood midground", "neighboring canal-front homes with screen enclosures forming a continuous waterfront row", "clear blue Florida sky with thin high clouds providing clean upper-frame contrast"
    composition: Camera is positioned at low-to-mid drone altitude over the canal, looking north-northwest toward the subject property. Foreground: tree canopy in lower-left corner and the canal surface. Midground: seawall, dual boat lifts, and rear lawn of the subject home. Background: screen-enclosed pool, main roofline, and the broader residential neighborhood receding to the horizon. Strong diagonal leading lines from the canal banks and seawall converge toward the subject property. → suggested_motion: drone_push_in (forward drone push toward the canal-front screen enclosure as the focal subject)

  ID: d85844b4-7083-4760-b22d-2ff528b2e19d
    file: photo_3
    room: kitchen
    aesthetic: 9
    depth: high
    key_features: "large dark espresso shaker-style island with thick white marble-veined quartz countertop and brushed nickel bar pulls", "three globe-style glass pendant lights with brushed nickel stems cascading over the island", "coffered ceiling with shiplap insets and recessed lighting anchoring the kitchen zone", "fully open pocket sliding glass doors revealing a screened lanai, tropical palms, and pool beyond", "undermount single-basin dark sink with matte black gooseneck faucet centered on the island", "open-plan great room with stone-clad TV wall, ceiling fan, and linen sectional visible in the background"
    composition: Camera is positioned at the far living room corner looking diagonally across the kitchen island toward the rear of the home. Foreground: the dark espresso island dominates the lower half of the frame with its quartz surface reflecting the pendant lights. Midground: the open pocket sliders and screened lanai frame a tropical outdoor view. Background: to the left, the great room's stone TV wall and sectional sofa; to the right, a dining area with a round chandelier and large picture window. Strong diagonal leading lines from the island edge and ceiling coffering pull the eye toward the outdoor opening. → suggested_motion: orbit (arc around the dark espresso island revealing the great room, outdoor sliders, and dining nook in sequence)

  ID: a3a877c9-8709-4f4c-ad5f-7b451f3eb405
    file: photo_4
    room: aerial
    aesthetic: 9
    depth: high
    key_features: "white stucco contemporary facade with dark bronze window frames and two-car garage under clay barrel-tile roof", "wide paver driveway with sunburst medallion detail leading from the street to the garage", "lush tropical front lawn flanked by mature royal palms and manicured hedges", "large tidal estuary and mangrove preserve directly behind the property", "canal waterway wrapping the left side of the lot connecting to the open bay", "neighboring canal-front community with docks and boat lifts visible to the upper left"
    composition: Camera is positioned at moderate-high altitude slightly south of the property looking northwest. The street runs diagonally across the lower third as a strong leading line. The subject house sits in the midground center with its paver driveway pointing directly at the camera. Behind the home, a sweeping tidal lagoon and dense mangrove preserve fill the upper two-thirds, providing dramatic natural depth. Neighboring homes frame left and right. → suggested_motion: drone_push_in (aerial forward push centering on the white stucco facade with the tidal estuary beyond)

  ID: ee07f1ea-6228-49cc-93ff-246c7b27e29f
    file: photo_5
    room: living_room
    aesthetic: 9
    depth: high
    key_features: "multi-panel pocket slider fully opened to screened lanai with pool and tropical treeline beyond", "painted coffered ceiling with large five-blade ceiling fan centered in the tray", "stacked-stone accent wall with large-format coastal art print and carved wood credenza beneath", "light gray sectional sofa set on herringbone-pattern area rug with mirrored marble-top coffee table", "navy blue kitchen island with round swivel bar stools and globe pendant lights to the right", "wide-plank light oak wood-look tile flooring running toward the sliders"
    composition: Camera is positioned at the rear of the great room near the dining/kitchen zone, facing the living area and open sliders. Foreground: back of the gray sectional and coffee table on the rug. Midground: the open coffered living volume with the credenza and TV wall to the left and kitchen island bar to the right. Background: fully open pocket sliders framing the screened lanai, pool, and palm-lined treeline. Strong converging perspective lines from the coffered ceiling beams and floor planks funnel the eye toward the bright outdoor opening. → suggested_motion: low_angle_glide (glide forward through the great room toward the open sliders, showcasing the coffered ceiling and pool view)

  ID: 3fc37743-e780-4b56-b8f5-76e2f83b5cec
    file: photo_6
    room: pool
    aesthetic: 8.5
    depth: high
    key_features: "rectangular lap pool with aqua blue water and paver surround in the foreground", "dark navy-frame screen enclosure with cathedral geometry overhead", "boat on a lift at the private dock framed by tall royal palms", "canal waterway and mangrove preserve visible beyond the pool barrier", "outdoor kitchen with stainless range hood and built-in grill on the right lanai", "colorful tropical potted croton plant in foreground left corner"
    composition: Camera positioned at the near end of the pool looking forward along the pool's long axis toward the canal. Foreground: paver deck and colorful potted plant at lower left. Midground: the full length of the rectangular pool. Background: dock with boat on lift, royal palms, and the canal with mangrove tree line. Screen enclosure frame creates strong converging diagonal lines leading the eye toward the waterway. Outdoor kitchen and dining area visible to the right. → suggested_motion: push_in (push forward along pool axis toward the canal dock and royal palms as the focal subject)

  ID: 9c78d77f-bc12-44a0-9b3a-fbb446287301
    file: photo_7
    room: pool
    aesthetic: 8.5
    depth: high
    key_features: "rectangular lap pool with turquoise water and teal mosaic tile waterline border", "white aluminum barrel-vault screen enclosure with dramatic ribbed ceiling geometry", "travertine paver pool deck with diagonal shadow patterns from the screen frame", "canal waterway visible through the screen with palm trees and neighboring dock", "dark-framed glass pocket slider opening to interior bedroom beyond", "decorative white heron garden sculptures and tropical potted plants at pool end"
    composition: Camera is positioned at the near corner of the pool deck facing down the length of the rectangular pool toward the canal. Foreground: travertine pavers and pool edge with mosaic tile. Midground: pool surface with reflections, the house rear facade and slider to the left. Background: screen enclosure end panel framing palms, canal, and distant homes. The barrel-vault screen ceiling ribs create powerful converging perspective lines leading the eye from camera toward the canal, delivering exceptional depth. → suggested_motion: push_in (converging screen enclosure ribs create a strong tunnel perspective guiding the camera forward toward the canal)

  ID: 4d7ab3a6-1482-438c-82f0-612ac2637b37
    file: photo_8
    room: deck
    aesthetic: 8.5
    depth: high
    key_features: "covered lanai with wood-plank ceiling and two matte black three-blade ceiling fans", "rectangular pool with turquoise water on travertine-style paver deck", "black wicker swivel lounge chairs with gray cushions and blue trellis outdoor rug", "black aluminum screen enclosure with geometric frame against clear blue sky", "private waterway dock with boat lift visible through the screen beyond the pool", "lush tropical palm tree backdrop and mangrove preserve framing the canal view"
    composition: Camera is positioned inside the covered lanai looking outward toward the pool and canal. Foreground: dark wicker coffee table with decorative bowl and blue trellis rug at lower left, wicker swivel chair at center-right. Midground: the rectangular pool bisects the frame horizontally. Background: the screen enclosure, tall palms, mangrove tree line, and dock with boat. Strong diagonal leading lines from the screen enclosure frame converge toward the tropical backdrop, creating powerful depth. → suggested_motion: parallax (lateral glide past the foreground wicker chair reveals the full pool and tropical canal beyond)

  ID: 95c9e198-7a53-46f1-81a9-324362e5b4ab
    file: photo_9
    room: aerial
    aesthetic: 8.5
    depth: high
    key_features: "canal-front rear seawall with two private composite docks and boat lifts", "screen-enclosed pool enclosure with visible blue pool water and palm landscaping", "hip-roof stucco home with tan tile roofline as primary subject amid neighboring properties", "wide navigable canal stretching left to right with intersecting waterway visible mid-frame", "lush tropical palm and foliage foreground framing the canal edge", "dense Florida waterfront neighborhood context extending to the horizon under partly cloudy sky"
    composition: Drone positioned south of the subject property at medium altitude, looking north across the canal. Foreground: dense native tree canopy at the canal's south bank. Midground: the brown seawall, dual boat docks, and green rear lawn leading to the screen enclosure. Background: subject home's hip roofline, neighboring homes, and a widening canal basin with neighborhood extending to the horizon. Strong horizontal leading lines from the seawall and canal surface pull the eye toward the home. → suggested_motion: drone_push_in (push forward at rooftop height centering on the canal-front screen enclosure and dock)

Reminders (system prompt has full detail):
- Each prompt must be ONE sentence, under 20 words, using real cinematography verbs (push in, orbit, dolly, reveal, parallax, drone push in, top down, low angle glide, feature closeup, rack focus).
- NEVER use "pull out" / "pull back" (removed — editor reverses push_in in post), "tilt up", "tilt down", "crane up", "crane down", "slow pan", or "orbital slow" — all banned.
- Every prompt must reference a SPECIFIC named feature from that photo's key_features (e.g. "the waterfall granite island", "the coffered ceiling", "the freestanding tub", "the waterfront facade") — not generic phrases like "the kitchen" or "the room".
- Do NOT describe materials, colors, or adjacent rooms in detail. One descriptor max.
- Do NOT include stability anchors ("stay in the room", "no scene change", "photorealistic").
- Consecutive scenes must use different camera_movement values.
- Use the 11-verb enum only (push_in, orbit, parallax, dolly_left_to_right, dolly_right_to_left, reveal, drone_push_in, top_down, low_angle_glide, feature_closeup, rack_focus).

Return a JSON object with this exact shape:
{
  "mood": "modern_luxury",
  "music_tag": "upbeat_elegant",
  "scenes": [
    {
      "scene_number": 1,
      "photo_id": "a1b2c3d4-e5f6-4747-8899-aabbccddeeff",
      "end_photo_id": "8ba2926c-6bd6-4204-9f4d-17dd68ea6785",
      "room_type": "exterior_front",
      "camera_movement": "drone_push_in",
      "prompt": "smooth cinematic drone flying forward at rooftop height toward the waterfront facade",
      "duration_seconds": 4,
      "provider_preference": null,
      "director_intent": {
        "room_type": "exterior_front",
        "motion": "drone_push_in",
        "subject": "waterfront facade",
        "end_subject": "front door hardware",
        "style": ["smooth", "cinematic"],
        "mood": "luxury",
        "shot_style": null,
        "foreground_element": null
      }
    },
    {
      "scene_number": 2,
      "photo_id": "f7g8h9i0-j1k2-4848-9900-bbccddeeeffg",
      "end_photo_id": null,
      "room_type": "kitchen",
      "camera_movement": "dolly_left_to_right",
      "prompt": "smooth cinematic dolly right across the waterfall granite island",
      "duration_seconds": 3.5,
      "provider_preference": null,
      "director_intent": {
        "room_type": "kitchen",
        "motion": "dolly_left_to_right",
        "subject": "waterfall granite island",
        "end_subject": null,
        "style": ["smooth", "cinematic"],
        "mood": "modern_luxury",
        "shot_style": "Detail Slider",
        "foreground_element": null
      }
    }
  ]
}

mood options: modern_luxury, warm_cozy, bright_contemporary, classic_elegant, tropical_resort
music_tag options: upbeat_elegant, calm_ambient, modern_cinematic, warm_acoustic, dramatic_orchestral

Return ONLY the JSON object, no additional text.

━━━ VALIDATED RECIPE MATCH ━━━
Archetype "exterior_front_push_in_260420_tepr" (room=exterior_front, movement=push_in, provider=runway, applied 0× before, distance 0.104).

Recipe template:
  slow cinematic straight push with strong curve centered on the arched entry portico and dark wood front door

If this photo fits the archetype, adapt the template by substituting the actual named feature from this photo's key_features. Keep the verb and structure. Deviate only if a specific key_feature makes the template awkward.
━━━ END RECIPE MATCH ━━━

━━━ PAST WINNERS ON STRUCTURALLY SIMILAR PHOTOS ━━━
These are 5 prior Lab iterations on photos whose analysis embedded close to this one, rated 4+ by the admin. They are evidence of what has worked on similar compositions. Bias toward their patterns unless the current photo's specifics argue otherwise.

  1. [5★ · exterior_front · push_in · ?]
     prompt: "slow cinematic straight push with strong curve centered on the arched entry portico and dark wood front door"
     tags: clean motion, cinematic
     note: [rerender] Same prompt, trying runway (source: iteration 10)

  2. [5★ · exterior_front · pull_out · ?]
     prompt: "steady cinematic pull out from the arched entry portico revealing the full paver driveway and facade"
     tags: clean motion, low quality

  3. [4★ · exterior_front · pull_out · runway]
     prompt: "steady cinematic pull out from the recessed front entry revealing the full herringbone paver driveway and facade"
     tags: clean motion, cinematic, low quality

  4. [5★ · aerial · drone_pull_back · ?]
     prompt: "slow cinematic drone rising backward and upward from the gray hip-roof house toward the canal waterway"
     tags: clean motion, low quality, cinematic

  5. [5★ · aerial · drone_pull_back · ?]
     prompt: "smooth cinematic drone rising backward and upward from the double front doors and arched entry portico"
     tags: cinematic, perfect, low quality
━━━ END PAST WINNERS ━━━

━━━ PAST LOSERS ON STRUCTURALLY SIMILAR PHOTOS ━━━
These are 3 prior iterations on photos that embed close to this one, rated 2★ or worse by the admin. Do NOT mirror these patterns. Steer away from their camera_movement choice, their framing, or whatever the tags/comments indicate went wrong. If your instinct leads you toward one of these patterns, pick a different verb or different framing.

  1. [1★ · exterior_front · push_in · ?]
     prompt: "steady cinematic push in toward the arched entry portico and dark wood front door"
     tags: warped geometry, hallucinated architecture
     why it failed: [rerender] Same prompt, trying kling (source: iteration 2)

  2. [2★ · exterior_front · pull_out · ?]
     prompt: "steady cinematic pull out from the arched entry portico revealing the full curved concrete driveway and facade"
     tags: wrong motion direction
     admin asked to change: should be a push in cinematic 

  3. [2★ · aerial · drone_push_in · ?]
     prompt: "smooth cinematic drone flying forward at rooftop height toward the steep-pitched stone-clad gabled facade"
     tags: wrong motion direction, too static, low quality
     admin asked to change: should be flying down near the front of the subject home with the metal roof
━━━ END PAST LOSERS ━━━
```
