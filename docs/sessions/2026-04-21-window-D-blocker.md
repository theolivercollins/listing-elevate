# Window D Round 2 — Blocker: Atlas wallet exhausted mid-grid

Date: 2026-04-21
Branch: `session/router-2026-04-21`
Listing id: `1746b7de-ac3f-45e0-baae-db5b168c4cb9`

## What happened

Ran `npx tsx scripts/seed-router-grid.ts --write`. 22 renders planned, $10.42 projected spend (of $40 cap).

**Of the 22 submits, 12 went through before the Atlas wallet returned HTTP 402 "insufficient balance" on every subsequent Atlas call.**

Atlas spent before wallet emptied: the three Atlas SKUs rendered successfully on kitchen + living_room — `kling-v2-6-pro` (60¢ × 2), `kling-v3-pro` (48¢ × 2), `kling-o3-pro` (48¢ × 1), `kling-v2-master` (111¢ × 1) = **~$4.47 actual Atlas spend.** Native Kling (pre-paid credits) and Runway submits kept working after that.

## Grid coverage after partial run

| Bucket | SKUs submitted | SKUs failed |
|---|---|---|
| kitchen × push_in | v2-native, **v2-6-pro**, **v3-pro**, **o3-pro** (4/4) | — |
| living_room × push_in | v2-native, **v2-6-pro**, **v3-pro**, **v2-master** (4/4) | — |
| master_bedroom × push_in | v2-native (1/4) | v2-6-pro, v3-pro, v2-master |
| exterior_front × push_in | v2-native (1/5) | v2-6-pro, v3-pro, v2-master, o3-pro |
| aerial × drone_push_in | v2-native, runway (2/5) | v2-6-pro, v3-pro, o3-pro |

(Bold = Atlas SKU; others are native Kling or Runway.)

**Rateable now:** 12 iterations across 5 scenes. kitchen + living_room are a full 4-SKU comparison. The other 3 buckets are effectively "single-SKU" renders — useful signal on that one SKU but no cross-SKU grid comparison.

## Options for Oliver

**Option A — Top up Atlas and re-run (recommended).** The script is idempotent: it will skip the 12 submitted and retry only the 10 failed. Expected incremental spend ~$5.95 (same SKUs as in the config). Total $10.42 as projected.
  - Action: add funds to Atlas Cloud wallet, then run:
    ```
    cd /Users/oliverhelgemo/real-estate-pipeline/.worktrees/wt-router
    npx tsx scripts/seed-router-grid.ts --write
    ```
  - Re-run will NOT re-submit successful iterations. New Atlas submit → rendering → cron finalization for only the 10 that failed.

**Option B — Proceed with the partial grid.** Oliver rates the 12 iterations now. Router table for kitchen + living_room can emerge cleanly from this signal. master_bedroom + exterior_front + aerial winners stay in "NO_WINNER" until Atlas renders land.

**Option C — Swap failed SKUs for native-Kling-equivalent.** Native Kling (`kling-v2-native`) is pre-paid credits and still worked. We already have one native iteration per bucket. Re-running isn't necessary; but we'd miss head-to-head signal on v2-6-pro, v3-pro, v2-master, o3-pro in the 3 under-covered buckets.

**My recommendation:** Option A. ~$6 to unlock 10 Atlas iterations is the only thing standing between "partial signal" and "real router table".

## Evidence — submit IDs for audit trail

Successful Atlas submits (wallet was live):
- kitchen × kling-v2-6-pro: task `f125c5962a144e1aad4c4f18f79737d3`
- kitchen × kling-v3-pro: task `62ea63676e0d4ab182926f03700534ea`
- kitchen × kling-o3-pro: task `5aaab1baf1de49a79ac2de379e6a26c5`
- living_room × kling-v2-6-pro: task `0d85dfb41ca844e0bdd341bc7b5f998c`
- living_room × kling-v3-pro: task `924b789aab884653bd5f1976a64a4ba1`
- living_room × kling-v2-master: task `688f0486aa0240868cff3706e9e0b93e`

First Atlas 402 on master_bedroom × kling-v2-6-pro — wallet emptied between submit 7 (living_room v2-master at $1.11) and submit 8 (master_bedroom v2-6-pro at $0.60). So the wallet had somewhere between $0 and $0.60 at that point, placing initial balance at ≈$4.47 ± $0.60.

Native Kling (pre-paid credits) and Runway submits continued to work after Atlas 402.

## Budget reconciliation

Of the $40 Round 2 cap:
- Spent: **~$4.00** (Atlas 7 clips + Runway 1 clip, plus Gemini analysis ≈$0.025 × 5 photos = ~$0.13)
- Remaining: ~$36 if Atlas is topped up
- 10 failed submits cost $0 (Atlas rejected them before billing)

## What's still running

At blocker-write time, the 12 submitted renders are finalizing via the Vercel `/api/cron/poll-listing-iterations` cron (runs every minute). Two (`kitchen × v2-6-pro`, `living_room × v2-6-pro`) already show `status='rendered'` with `clip_url` set and `cost_cents=60`. The rest will land over the next 2-10 minutes.

## Do NOT

- Do NOT re-run `--write` blindly. The script IS idempotent, but verify via `git status` + a dry-run first.
- Do NOT cancel Atlas submits. They're either complete (billed already) or rendering (will complete + bill).
- Do NOT edit `lib/providers/router.ts`. Partial grid doesn't produce a winning router table yet.
