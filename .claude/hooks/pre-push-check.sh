#!/usr/bin/env bash
# Listing Elevate — PreToolUse hook for `git push` safety gates.
# Reads the Bash tool input from stdin; only blocks on git push.
# Exit 0 = allow. Exit 2 = block with reason on stderr (Claude sees and explains).
set -e

# Read tool input (JSON) from stdin
input=$(cat)
command=$(echo "$input" | python3 -c "import sys, json; print(json.load(sys.stdin).get('tool_input', {}).get('command', ''))" 2>/dev/null || echo "")

# Only inspect git push commands
if [[ ! "$command" =~ git[[:space:]]+push ]]; then
  exit 0
fi

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

# Determine target branch from current HEAD (best-effort; multi-branch pushes still pass)
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# Hard block: never force-push to main or staging unless explicitly --force is missing
if [[ "$command" =~ --force ]] && [[ "$branch" =~ ^(main|staging)$ ]]; then
  echo "BLOCKED: --force push to $branch is not allowed. Use git revert + new commit instead." >&2
  exit 2
fi

# Soft gate: pushing to main requires HANDOFF.md touched in last 10 commits
if [[ "$branch" == "main" ]] && [[ "$command" =~ origin[[:space:]]+main|origin[[:space:]]*$ ]]; then
  if ! git log -10 --name-only --pretty=format: | grep -q "^docs/HANDOFF.md$"; then
    echo "BLOCKED: pushing to main without updating docs/HANDOFF.md in the last 10 commits." >&2
    echo "  Add a 'Recent shipping log' entry with date + commit SHA + what changed." >&2
    echo "  Override (not recommended): set LE_SKIP_HANDOFF_GATE=1 in the environment." >&2
    [[ "$LE_SKIP_HANDOFF_GATE" == "1" ]] && exit 0
    exit 2
  fi
fi

exit 0
