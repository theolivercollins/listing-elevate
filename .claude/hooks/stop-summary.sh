#!/usr/bin/env bash
# Listing Elevate — Stop hook
# When a turn ends, surface anything that looks half-done so context isn't lost.
set -e
cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || exit 0

dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
unpushed=$(git log @{u}.. --oneline 2>/dev/null | wc -l | tr -d ' ')
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")

# Only print if there's something interesting
if [[ "$dirty" == "0" ]] && [[ "$unpushed" == "0" ]]; then
  exit 0
fi

echo "[Listing Elevate] turn-end status — branch=$branch uncommitted=$dirty unpushed=$unpushed"
if [[ "$dirty" != "0" ]]; then
  echo "[Listing Elevate] uncommitted files (don't lose):"
  git status --porcelain | head -10 | sed 's/^/  /'
fi
if [[ "$unpushed" != "0" ]] && [[ "$branch" =~ ^(main|staging|dev)$ ]]; then
  echo "[Listing Elevate] $unpushed unpushed commit(s) on protected branch $branch — push when ready"
fi
