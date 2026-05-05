#!/usr/bin/env bash
# Listing Elevate — SessionStart hook
# Prints a 5-line orientation so a cold session knows where it is.
set -e
cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
handoff_date=$(grep -m1 "^Last updated:" docs/HANDOFF.md 2>/dev/null | awk '{print $3}' || echo "?")
dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
worktrees=$(git worktree list 2>/dev/null | wc -l | tr -d ' ')
last_commit=$(git log -1 --format='%h %s' 2>/dev/null | cut -c1-72)

cat <<EOF
[Listing Elevate] branch=$branch  HANDOFF.md=$handoff_date  uncommitted=$dirty  worktrees=$worktrees
[Listing Elevate] last commit: $last_commit
[Listing Elevate] cold? read docs/HANDOFF.md → docs/state/PROJECT-STATE.md → docs/plans/back-on-track-plan.md
[Listing Elevate] anything off? run: pnpm run doctor
EOF
