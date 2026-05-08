#!/usr/bin/env bash
# Listing Elevate — Stop hook
# When a turn ends, surface anything that looks half-done so context isn't lost.
# Also: warn if today's commits aren't memorialized in HANDOFF / sessions —
# the failure mode that almost ate the 2026-05-05 judge-calibration session.
set -e
cd "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || exit 0

dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
unpushed=$(git log @{u}.. --oneline 2>/dev/null | wc -l | tr -d ' ')
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")

# --- session-memorialization check (always runs) ---
today=$(date +%Y-%m-%d)
commits_today=$(git log --since="$today 00:00" --until="tomorrow 00:00" --all --format="%h" 2>/dev/null | wc -l | tr -d ' ')
session_note_today=""
if compgen -G "docs/sessions/${today}-*.md" >/dev/null 2>&1; then
  session_note_today="yes"
fi
handoff_today=""
if git log --since="$today 00:00" --until="tomorrow 00:00" --all --name-only --pretty=format: 2>/dev/null | grep -qx "docs/HANDOFF.md"; then
  handoff_today="yes"
fi

session_note_missing="no"
if [[ "$commits_today" != "0" ]] && [[ -z "$session_note_today" ]] && [[ -z "$handoff_today" ]]; then
  session_note_missing="yes"
fi

# Only quiet exit if EVERYTHING is fine
if [[ "$dirty" == "0" ]] && [[ "$unpushed" == "0" ]] && [[ "$session_note_missing" == "no" ]]; then
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
if [[ "$session_note_missing" == "yes" ]]; then
  echo "[Listing Elevate] WARN: ${commits_today} commit(s) today but no docs/sessions/${today}-*.md and no HANDOFF.md change today."
  echo "[Listing Elevate]       Future-you (and future-Claude) won't see this work via the cold-entry read order."
  echo "[Listing Elevate]       Quick fix: write docs/sessions/${today}-<topic>.md and append an entry to HANDOFF.md."
fi
