#!/usr/bin/env bash
# Wrapper for mcp-atlassian that reads credentials from the saved JSON file
# and passes them as command-line arguments.

CRED_FILE="$HOME/.claude/mcp-credentials/atlassian.json"

if [ ! -f "$CRED_FILE" ]; then
  echo "No Atlassian credentials found at $CRED_FILE" >&2
  exit 1
fi

EMAIL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CRED_FILE','utf-8')).email || '')")
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CRED_FILE','utf-8')).token || '')")

if [ -z "$EMAIL" ] || [ -z "$TOKEN" ]; then
  echo "Atlassian credentials incomplete (email or token missing)" >&2
  exit 1
fi

DOMAIN="https://cmtelematics.atlassian.net"

exec mcp-atlassian \
  --jira-url "$DOMAIN" \
  --jira-username "$EMAIL" \
  --jira-token "$TOKEN" \
  --confluence-url "$DOMAIN/wiki" \
  --confluence-username "$EMAIL" \
  --confluence-token "$TOKEN"
