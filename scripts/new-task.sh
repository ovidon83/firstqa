#!/usr/bin/env bash
# Create or open today's daily task file. Run from project root.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TASKS_DAILY="$PROJECT_ROOT/tasks/daily"

mkdir -p "$TASKS_DAILY"

# Today's date in YYYY-MM-DD and human-readable form
DATE_FILE="$(date "+%Y-%m-%d")"
DATE_HEADER="$(date "+%A, %B %d, %Y")"
FILE="$TASKS_DAILY/$DATE_FILE.md"

if [[ ! -f "$FILE" ]]; then
  cat > "$FILE" << EOF
# $DATE_HEADER

## Today's Focus
- [ ] 

## In Progress

## Completed ✓

## Blockers/Notes

## Tomorrow


EOF
  echo "Created $FILE"
else
  echo "Opening existing $FILE"
fi

# Open in Cursor (if available)
if command -v cursor &>/dev/null; then
  cursor "$FILE"
else
  echo "File: $FILE"
  echo "(Install Cursor CLI to open automatically)"
fi
