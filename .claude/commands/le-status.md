---
description: One-shot session orientation — runs pnpm run doctor + git status + last 5 commits + promotion lineage for current branch.
---

Run a one-shot session orientation for Listing Elevate. Execute these in parallel where possible:

1. `pnpm run doctor` — full health check
2. `git status --short` — uncommitted changes
3. `git log --oneline -5` — recent commits
4. `git log --oneline origin/main..HEAD` if not on main, else `git log --oneline -10` — promotion lineage / what's ahead of main on this branch

After running, summarize in plain text (1 short paragraph): what branch you're on, what's pending, what's the next gate before push (HANDOFF.md update? migration to apply? doc archive needed?).

Do NOT take any action — this is read-only orientation.
