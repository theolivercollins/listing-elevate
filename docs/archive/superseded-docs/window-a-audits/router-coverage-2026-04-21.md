# Router Coverage Audit — 2026-04-21

Generated: 2026-04-21T19:08:02.678Z  
Source: `scripts/build-router-table.ts --write`

## Interpretation

**Verdict: existing signal is NOT sufficient to build a real router table.** Of 32 (room x movement) buckets observed, **zero** have a SKU with at least 3 iterations AND a >=80% 4*+ win rate. The underlying cause is a data-shape problem, not a rating-volume problem:

- **32%** of rated iterations are SKU-identifiable (Phase 2.8 listings Lab). The remaining **68%** (legacy Lab + prod) only carry `provider` ('kling' / 'runway'), which can't pick between six Kling SKUs.
- Phase 2.8 ratings are spread thinly across up to 7 SKUs per bucket, so no single SKU accumulates the 3-iteration floor before averaging out across the grid.

A fresh rating session is unavoidable for buckets that actually matter (the quota-high rooms: kitchen, living_room, master_bedroom, exterior_front, aerial). Round 2's wiring step can still use this draft as the shape of the table once the signal exists. Meanwhile, `lib/providers/router.ts` should continue using its current intuition-based routing (documented as "pending Phase B validation").

## Summary

- Total (room x movement) buckets observed: **32**
- **WINNER** (>=3 iter, >=80% 4* on a single SKU): **0**
- **NO_WINNER** (has data, no qualifier): **32**
- **EMPTY**: **0**

### Rating signal by surface

| Surface | Rated rows | SKU-granular? |
|---|---:|---|
| Phase 2.8 listings Lab (`prompt_lab_listing_scene_iterations`) | 55 | yes (`model_used`) |
| Legacy Lab (`prompt_lab_iterations`) | 108 | no (provider only) |
| Production (`scene_ratings`) | 7 | no (provider only) |
| **Totals** | **170** | 55 of 170 (32%) |

## Winners (router table draft rows)

_No buckets passed the winner threshold with current signal._

## Full bucket coverage (grouped by room)

### aerial

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| drone_pull_back | NO_WINNER | — | — | runway:9/4, kling:1/1, unknown:1/0 |
| drone_push_in | NO_WINNER | `kling-v3-pro` (4 iter, 3/4) | kling-v2-6-pro:1/0, kling-v3-pro:4/3, kling-v2-native:1/0, kling-v3-std:1/0, kling-o3-pro:1/0, kling-v2-1-pair:1/1 | atlas:8/4, kling:5/2, runway:4/2, unknown:1/0 |
| top_down | NO_WINNER | `kling-v2-6-pro` (2 iter, 1/2) | kling-v3-pro:1/0, kling-v2-6-pro:2/1, kling-v2-native:1/0, kling-o3-pro:1/0, kling-v3-std:1/0 | atlas:5/1, kling:1/0, runway:1/0 |

### bathroom

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| dolly_left_to_right | NO_WINNER | `kling-v2-native` (1 iter, 0/1) | kling-v2-native:1/0 | kling:1/0 |
| feature_closeup | NO_WINNER | — | — | runway:1/1 |
| push_in | NO_WINNER | — | — | unknown:1/1, kling:2/2, runway:1/0 |

### bedroom

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| push_in | NO_WINNER | — | — | kling:1/1 |

### deck

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| parallax | NO_WINNER | `kling-v3-pro` (2 iter, 1/2) | kling-v2-6-pro:1/0, kling-v3-pro:2/1, kling-o3-pro:1/0, wan-2.7:1/0, kling-v3-std:1/0, kling-v2-1-pair:1/1 | atlas:6/2, unknown:1/0 |

### dining

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| low_angle_glide | NO_WINNER | — | — | kling:1/1 |
| orbit | NO_WINNER | — | — | kling:2/0 |
| push_in | NO_WINNER | — | — | kling:6/5 |

### exterior_back

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| parallax | NO_WINNER | `kling-v2-master` (2 iter, 0/2) | kling-v3-pro:1/0, kling-v2-6-pro:1/0, kling-v2-master:2/0 | atlas:4/0 |

### exterior_front

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| drone_push_in | NO_WINNER | — | — | runway:1/1 |
| orbit | NO_WINNER | `kling-v2-native` (1 iter, 0/1) | kling-v2-native:1/0 | kling:1/0 |
| pull_out | NO_WINNER | — | — | runway:5/2, unknown:1/0 |
| push_in | NO_WINNER | `kling-v2-6-pro` (1 iter, 1/1) | kling-v2-6-pro:1/1, kling-v3-std:1/0, kling-v2-native:1/1, kling-v2-1-pair:1/0, kling-v3-pro:1/0 | atlas:4/1, kling:3/2, runway:5/2 |
| reveal | NO_WINNER | — | — | kling:2/2, runway:1/0 |

### kitchen

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| dolly_left_to_right | NO_WINNER | — | — | kling:3/1, unknown:1/0 |
| dolly_right_to_left | NO_WINNER | `kling-v2-native` (1 iter, 0/1) | kling-v2-native:1/0 | kling:1/0 |
| orbit | NO_WINNER | `kling-v2-master` (2 iter, 0/2) | kling-v2-master:2/0, kling-v2-6-pro:1/0, kling-v2-1-pair:1/0, kling-v3-pro:1/0 | atlas:5/0 |
| pull_out | NO_WINNER | — | — | unknown:1/0 |
| push_in | NO_WINNER | `kling-v2-native` (1 iter, 1/1) | kling-v2-native:1/1 | kling:9/6 |

### living_room

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| low_angle_glide | NO_WINNER | `kling-v3-pro` (3 iter, 0/3) | kling-v2-6-pro:1/1, kling-v3-pro:3/0, kling-v2-1-pair:1/0, kling-v3-std:1/0 | atlas:6/1, kling:2/1 |
| push_in | NO_WINNER | — | — | kling:9/6 |
| reveal | NO_WINNER | — | — | kling:1/1 |

### master_bedroom

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| pull_out | NO_WINNER | — | — | runway:1/1 |
| push_in | NO_WINNER | — | — | kling:6/5 |

### other

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| dolly_left_to_right | NO_WINNER | — | — | kling:1/0 |
| parallax | NO_WINNER | `kling-v2-native` (1 iter, 1/1) | kling-v2-native:1/1 | kling:2/1 |
| push_in | NO_WINNER | — | — | kling:8/6, unknown:3/1, runway:1/1 |

### pool

| movement | status | top SKU (iter, 4*/iter) | all SKUs in bucket | provider-level signal |
|---|---|---|---|---|
| parallax | NO_WINNER | `kling-v2-native` (1 iter, 0/1) | kling-v2-native:1/0 | kling:1/0 |
| push_in | NO_WINNER | `kling-v2-native` (1 iter, 0/1) | kling-v2-native:1/0, kling-v2-6-pro:1/0, kling-v3-pro:1/0, kling-v2-1-pair:1/0, kling-o3-pro:1/0, kling-v2-master:1/1, kling-v3-std:1/0 | kling:5/2, atlas:6/1, runway:10/7, unknown:2/0 |

## Notes

- `wan-2.7` was removed from the Atlas registry 2026-04-20 evening and is excluded from router eligibility even if it appears in the historical data.
- SKU-level winner selection only draws from Phase 2.8 iterations because legacy Lab + prod scene_ratings only store `provider`, not `model_used`.
- Provider-level columns are kept in the report so Round 2 can see structural signal (e.g. "legacy Lab says push_in × kitchen heavily favors kling") even when no SKU qualifies.
- This script is read-only and writes no new rating data. It is the automated alternative to the manual Phase B rating grid.
