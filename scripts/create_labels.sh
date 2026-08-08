#!/usr/bin/env bash
# scripts/create_labels.sh
# Create standard labels for Deliivo repositories using the GitHub CLI (gh).
# Run: bash scripts/create_labels.sh <owner> <repo>
# Requires: gh CLI authenticated with repo:status and repo permissions.

set -euo pipefail

OWNER=${1:-}
REPO=${2:-}

if [[ -z "$OWNER" || -z "$REPO" ]]; then
  echo "Usage: $0 <owner> <repo>"
  exit 1
fi

labels=(
  "bug:#d73a4a:Bug: unexpected behavior"
  "improvement:#0e8a16:Improvement / enhancement"
  "blocked:#5319e7:Blocked: awaiting dependency or decision"
  "ready-for-qa:#1d76db:Ready for QA"
  "priority:high:#b60205:High priority"
  "priority:medium:#d4c100:Medium priority"
  "priority:low:#0e8a16:Low priority"
  "severity:critical:#b60205:Critical severity"
  "severity:major:#fbca04:Major severity"
  "severity:minor:#0e8a16:Minor severity"
  "triage-needed:#ff7f50:Needs triage"
)

for spec in "${labels[@]}"; do
  name=${spec%%:*}
  rest=${spec#*:}
  color=${rest%%:*}
  description=${rest#*:}

  echo "Creating label: $name (color: $color)"
  if gh label view "$name" -R "$OWNER/$REPO" >/dev/null 2>&1; then
    echo "  Label $name exists — updating description/color"
    gh api --method PATCH -H "Accept: application/vnd.github+json" \
      /repos/$OWNER/$REPO/labels/"$(perl -MURI::Escape -e 'print uri_escape($ARGV[0])' "$name")" \
      -f name="$name" -f color="$color" -f description="$description"
  else
    gh label create "$name" --color "$color" --description "$description" -R "$OWNER/$REPO"
  fi
done

echo "All labels processed for $OWNER/$REPO"
