# Archived dashboard pages

Moved here as part of the 2026-05-13 admin dashboard redesign (Stage 5 of `docs/specs/2026-05-13-admin-dashboard-redesign-design.md`).

| File | Why archived | Redirect target |
|---|---|---|
| Settings.tsx | 5-week-old mock with no wired CRUD | `/dashboard` |
| Learning.tsx | Orphaned — never routed in App.tsx | (no redirect — never reachable) |
| Logs.tsx | Folded into System Status' Pipeline logs panel | `/dashboard/dev/system-status` |
| PromptProposals.tsx | Cut per Oliver IA — ledger-driven proposals still mineable via cron | `/dashboard/dev` |
| RatingLedger.tsx | Cut per Oliver IA — rating data still flows into `scene_ratings` | `/dashboard/dev/system-status` |
| LabListings.tsx | Multi-photo V2 lab — PromptLab.tsx covers daily-driver | `/dashboard/dev/prompt-lab` |
| LabListingNew.tsx | Child of LabListings | (via LabListings redirect) |
| LabListingDetail.tsx | Child of LabListings | (via LabListings redirect) |

Restore by `git mv`-ing back to `src/pages/dashboard/` and re-registering the route in `App.tsx`. Components remain functional — they were simply un-wired from routing.
