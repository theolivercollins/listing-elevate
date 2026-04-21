# Rating session — router grid (Oliver)

Date: 2026-04-21
Listing id: `1746b7de-ac3f-45e0-baae-db5b168c4cb9`
Listing name: **Router Grid 2026-04-21 — 5 Quota Buckets**

## What to do

1. Start the dev server if it isn't running:
   ```
   cd /Users/oliverhelgemo/real-estate-pipeline
   npm run dev
   ```

2. Open this URL:
   **`http://localhost:5173/dashboard/development/lab/listings/1746b7de-ac3f-45e0-baae-db5b168c4cb9`**

3. You will see 5 scenes (one per bucket). Each scene has a different number of iterations because Atlas's wallet ran out mid-run — see coverage table below.

4. **Rate every iteration 1–5★** based on whether the camera move actually works for the room type. The rating-reasons modal pops on star click — tick whatever applies.

5. Estimated time: **~20 minutes** for the 12 iterations currently rendered (half the original ~22 — Atlas blocker reduced scope).

6. When done: tell Window A (the coordinator) you're done rating.

## Coverage — what you'll see

| Scene | Room × movement | Iterations to rate | Atlas blocker? |
|---|---|---:|---|
| 1 | kitchen × push_in | 4 (v2-native, v2-6-pro, v3-pro, o3-pro) | clean grid |
| 2 | living_room × push_in | 4 (v2-native, v2-6-pro, v3-pro, v2-master) | clean grid |
| 3 | master_bedroom × push_in | 1 (v2-native only) | 3 failed — need top-up |
| 4 | exterior_front × push_in | 1 (v2-native only) | 4 failed — need top-up |
| 5 | aerial × drone_push_in | 2 (v2-native, runway) | 3 failed — need top-up |

**Total iterations to rate today: 12.** Kitchen and living_room are real cross-SKU comparisons; the other 3 are single-SKU.

## Why the Atlas SKUs missed 3 buckets

Atlas Cloud wallet hit $0 after ~$4.47 in the first 2 buckets. The script is idempotent — topping up Atlas and re-running `npx tsx scripts/seed-router-grid.ts --write` (from `.worktrees/wt-router`) will submit only the 10 failed iterations. See `docs/sessions/2026-04-21-window-D-blocker.md` for full context + submit-task-id audit trail.

## What happens after you rate

Running `npx tsx scripts/build-router-table.ts --write` from the same worktree will regenerate `lib/providers/router-table.draft.ts` and `docs/audits/router-coverage-2026-04-21.md` with your new ratings. Buckets that cross the winner threshold (≥3 iter × ≥80% 4★+ on a single SKU) become real router-table rows; the rest stay NO_WINNER.

Expected emergent winners from a 4-SKU grid where one SKU is obviously best: the rule needs 3 of 4 rated ≥4★ on the same SKU. If your clear favorite gets 4★+ consistently on kitchen and living_room, those two buckets should emit winners.

## Questions while rating? → just rate

The brief explicitly says "He rates; he does not configure." If something looks broken (missing clip, wrong SKU label, wrong room_type), skip it — the coordinator fixes it in the next round.
